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
