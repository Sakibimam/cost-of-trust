import { readFile, writeFile } from "node:fs/promises";
import { env, loadEnv } from "./config.ts";
import { createReport, renderReportMarkdown } from "./report.ts";
import { createPayment, submitResult, waitForPayment } from "./payment.ts";
import { parseTaskInput, USAGE_RESULT } from "./task-input.ts";
loadEnv();

const core = (path: string, init: RequestInit = {}) => fetch(`${env("SOKOSUMI_API_URL", "https://api.preprod.sokosumi.com/v1")}${path}`, {
  ...init,
  headers: { authorization: `Bearer ${env("SOKOSUMI_COWORKER_API_KEY")}`, "content-type": "application/json", ...(init.headers ?? {}) },
  signal: AbortSignal.timeout(20_000),
});

async function taskEvent(taskId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await core(`/tasks/${encodeURIComponent(taskId)}/events`, { method: "POST", body: JSON.stringify(body) });
  const payload = await response.json() as { data?: Record<string, unknown>; message?: string };
  if (!response.ok || !payload.data) throw new Error(`Sokosumi event HTTP ${response.status}: ${payload.message ?? "invalid response"}`);
  return payload.data;
}

type Payment = Record<string, unknown>;
export type InFlightTask = { id: string; input: string; payment: Payment | null; runningPosted: boolean };

const statePath = () => env("WORKER_STATE_FILE", "/tmp/trust-check-worker-state.json");

export async function loadJournal(path = statePath()): Promise<InFlightTask[]> {
  try { return JSON.parse(await readFile(path, "utf8")) as InFlightTask[]; } catch { return []; }
}

export async function saveJournal(tasks: InFlightTask[], path = statePath()): Promise<void> {
  await writeFile(path, `${JSON.stringify(tasks, null, 2)}\n`, { mode: 0o600 });
}

export function failedResult(taskId: string, error: unknown): string {
  const message = error instanceof Error ? error.message : "request failed";
  return `Trust Check could not complete task ${taskId}: ${message}`;
}

async function markRunning(task: InFlightTask): Promise<void> {
  if (task.runningPosted) return;
  try { await taskEvent(task.id, task.payment ? { status: "RUNNING", masumiPayment: task.payment.data ?? task.payment } : { status: "RUNNING" }); }
  catch (error) { if (!(error instanceof Error && /HTTP 422/.test(error.message))) throw error; }
  task.runningPosted = true;
}

export async function processTask(task: InFlightTask, journal: InFlightTask[]): Promise<void> {
  try {
    const reportInput = parseTaskInput(task.input);
    // Sokosumi accepts one RUNNING event, so the escrow terms must exist before it is posted.
    if (reportInput && env("ENABLE_MPS_PAYMENTS") === "true" && !task.payment) { task.payment = await createPayment(task.input); await saveJournal(journal); }
    await markRunning(task);
    await saveJournal(journal);
    if (!reportInput) { await taskEvent(task.id, { status: "COMPLETED", comment: USAGE_RESULT }); journal.splice(journal.indexOf(task), 1); await saveJournal(journal); return; }
    if (task.payment) await waitForPayment(task.payment);
    const report = await createReport(reportInput);
    const result = renderReportMarkdown(report);
    await writeFile(`result-${task.id}.txt`, result);
    if (task.payment) { await submitResult(task.payment, result); await waitForPayment(task.payment, 20 * 60_000, ["ResultSubmitted", "WithdrawAuthorized", "Withdrawn", "DisputedWithdrawn"]); }
    await taskEvent(task.id, { status: "COMPLETED", comment: result });
    journal.splice(journal.indexOf(task), 1); await saveJournal(journal);
  } catch (error) {
    const message = failedResult(task.id, error);
    // If the failure result cannot be submitted (e.g. the payment service no longer knows the escrow), Masumi refunds the buyer after unlock; still close the task.
    let escrowNote = "No escrow was collected.";
    if (task.payment) {
      try {
        await submitResult(task.payment, message);
        await waitForPayment(task.payment, 20 * 60_000, ["ResultSubmitted", "WithdrawAuthorized", "Withdrawn", "DisputedWithdrawn"]);
        escrowNote = "Escrow was submitted through the failure result path.";
      } catch (submitError) { escrowNote = `The escrow refunds to the buyer after unlock (${submitError instanceof Error ? submitError.message : "submit failed"}).`; }
    }
    try { await taskEvent(task.id, { status: "FAILED", comment: `${message}. ${escrowNote}` }); }
    catch (eventError) { console.error(`Task ${task.id} FAILED event not posted: ${eventError instanceof Error ? eventError.message : eventError}`); }
    finally { journal.splice(journal.indexOf(task), 1); await saveJournal(journal); }
    console.error(`Task ${task.id} failed: ${message}`);
  }
}

export async function once(): Promise<void> {
  const coworker = env("SOKOSUMI_COWORKER_ID"); if (!coworker) throw new Error("SOKOSUMI_COWORKER_ID is required");
  const journal = await loadJournal();
  for (const task of [...journal]) await processTask(task, journal);
  const response = await core("/tasks?scope=owned");
  if (!response.ok) throw new Error(`Sokosumi task list HTTP ${response.status}`);
  const parsed = await response.json() as Array<Record<string, unknown>> | { tasks?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> };
  const tasks = Array.isArray(parsed) ? parsed : parsed.tasks ?? parsed.data ?? [];
  for (const task of tasks.filter((item) => item.status === "READY" && item.coworkerId === coworker && !journal.some((entry) => entry.id === String(item.id)))) {
    const id = String(task.id);
    const input = typeof task.description === "string" ? task.description : String(task.input ?? "");
    const entry: InFlightTask = { id, input, payment: null, runningPosted: false };
    journal.push(entry); await saveJournal(journal); await processTask(entry, journal);
  }
}

if (process.argv[1]?.endsWith("/worker.ts")) {
  // A failed poll must never stop the worker: log it and poll again.
  const tick = () => once().catch((error) => console.error(error instanceof Error ? error.message : error));
  void tick(); setInterval(tick, Number(env("POLL_SECONDS", "60")) * 1000);
}
