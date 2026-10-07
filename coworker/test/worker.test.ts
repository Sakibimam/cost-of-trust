import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failedResult, loadJournal, saveJournal, type InFlightTask } from "../src/worker.ts";

test("worker journal persists an in-flight payment across reload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trust-check-worker-"));
  const path = join(directory, "journal.json");
  const task: InFlightTask = { id: "task-1", input: "check asset1test", payment: { data: { blockchainIdentifier: "payment-1" } }, runningPosted: true };
  try {
    await saveJournal([task], path);
    assert.deepEqual(await loadJournal(path), [task]);
    assert.match(await readFile(path, "utf8"), /payment-1/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("worker failure result gives an in-flight escrow a submit-result path", () => {
  assert.match(failedResult("task-1", new Error("report failed")), /could not complete task task-1: report failed/);
});

test("paid task: the first RUNNING event carries the escrow terms", async () => {
  const { processTask } = await import("../src/worker.ts");
  const saved = { ...process.env };
  Object.assign(process.env, { ENABLE_MPS_PAYMENTS: "true", MPS_URL: "http://mps.test/api/v1", SOKOSUMI_API_URL: "http://soko.test/v1", WORKER_STATE_FILE: `/tmp/worker-order-${process.pid}.json` });
  const real = globalThis.fetch;
  const events: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("http://mps.test") && url.endsWith("/payment")) return Response.json({ data: { blockchainIdentifier: "bid-1", RequestedFunds: [] } });
    if (url.includes("/events")) { events.push(JSON.parse(String(init?.body))); return Response.json({ data: { id: "e" } }); }
    throw new Error("stop after RUNNING");
  }) as typeof fetch;
  try {
    const task = { id: "t1", input: JSON.stringify({ agentIdentifier: "asset1h6lypyuwtgjqjf9wd4wmg53pgk7gtv08nk40pn", taskValueAtRiskAda: 5, task: "x" }), payment: null, runningPosted: false };
    await processTask(task, [task]).catch(() => undefined);
    const running = events.find((event) => event.status === "RUNNING");
    assert.ok(running, "a RUNNING event was posted");
    assert.ok(running.masumiPayment, "RUNNING carries masumiPayment");
  } finally { globalThis.fetch = real; process.env = saved; }
});

test("a task whose escrow the payment service no longer knows is closed, not left to crash the worker", async () => {
  const { processTask } = await import("../src/worker.ts");
  const saved = { ...process.env };
  Object.assign(process.env, { ENABLE_MPS_PAYMENTS: "true", MPS_URL: "http://mps.test/api/v1", SOKOSUMI_API_URL: "http://soko.test/v1", WORKER_STATE_FILE: `/tmp/worker-stale-${process.pid}.json` });
  const real = globalThis.fetch;
  const events: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("http://mps.test")) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    if (url.includes("/events")) { events.push(JSON.parse(String(init?.body))); return Response.json({ data: { id: "e" } }); }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  try {
    const task = { id: "t-stale", input: JSON.stringify({ agentIdentifier: "asset1h6lypyuwtgjqjf9wd4wmg53pgk7gtv08nk40pn", taskValueAtRiskAda: 5, task: "x" }), payment: { data: { blockchainIdentifier: "gone" } }, runningPosted: true };
    const journal = [task];
    await processTask(task, journal);
    assert.equal(journal.length, 0, "journal entry removed");
    assert.ok(events.some((event) => event.status === "FAILED"), "FAILED posted");
  } finally { globalThis.fetch = real; process.env = saved; }
});
