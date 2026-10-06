import test from "node:test";
import assert from "node:assert/strict";
import { createReport } from "../src/report.ts";

test("report rejects missing identifier and negative risk", async () => {
  await assert.rejects(() => createReport({ agentIdentifier: "", taskValueAtRiskAda: 1 }));
  await assert.rejects(() => createReport({ agentIdentifier: "x", taskValueAtRiskAda: -1 }));
});
