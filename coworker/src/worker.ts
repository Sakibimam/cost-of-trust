import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { env, loadEnv } from "./config.ts";
import { createReport } from "./report.ts";
import { createPayment, submitResult, waitForPayment } from "./payment.ts";
import { parseTaskInput, USAGE_RESULT } from "./task-input.ts";
loadEnv();

const run = (args: string[]) => new Promise<string>((resolve, reject) => {
  const child = spawn("sokosumi", ["--preprod", ...args, "--json"], { env: process.env });
  let out = "", err = ""; child.stdout.on("data", (x) => out += x); child.stderr.on("data", (x) => err += x);
  child.on("close", (code) => code === 0 ? resolve(out) : reject(new Error(err || `sokosumi exited ${code}`)));
});

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

async function once(): Promise<void> {
  const coworker = env("SOKOSUMI_COWORKER_ID"); if (!coworker) throw new Error("SOKOSUMI_COWORKER_ID is required");
  const raw = await run(["tasks", "list", "--scope", "owned"]);
  const parsed = JSON.parse(raw) as Array<Record<string, unknown>> | { tasks?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> };
  const tasks = Array.isArray(parsed) ? parsed : parsed.tasks ?? parsed.data ?? [];
  for (const task of tasks.filter((item) => item.status === "READY" && item.coworkerId === coworker)) {
    const id = String(task.id);
    const input = typeof task.description === "string" ? task.description : String(task.input ?? "");
    try {
      await taskEvent(id, { status: "RUNNING" });
      const reportInput = parseTaskInput(input);
      if (!reportInput) { await taskEvent(id, { status: "COMPLETED", comment: USAGE_RESULT }); continue; }
      const paid = env("ENABLE_MPS_PAYMENTS") === "true";
      const payment = paid ? await createPayment(input) : null;
      if (payment) { await taskEvent(id, { status: "RUNNING", masumiPayment: payment.data ?? payment }); await waitForPayment(payment); }
      const report = await createReport(reportInput);
      const file = `result-${id}.txt`; await writeFile(file, JSON.stringify(report, null, 2));
      const result = await readFile(file, "utf8");
      if (payment) { await submitResult(payment, result); await waitForPayment(payment, 20 * 60_000, ["ResultSubmitted", "WithdrawAuthorized", "Withdrawn", "DisputedWithdrawn"]); }
      await taskEvent(id, { status: "COMPLETED", comment: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      try { await taskEvent(id, { status: "FAILED", comment: `Trust Check could not complete this task: ${message}` }); } catch (eventError) { console.error(`Task ${id} could not be marked FAILED: ${eventError instanceof Error ? eventError.message : "request failed"}`); }
      console.error(`Task ${id} failed: ${message}`);
    }
  }
}

async function main(): Promise<void> { await once(); setInterval(() => once().catch((error) => console.error(error.message)), Number(env("POLL_SECONDS", "60")) * 1000); }
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
