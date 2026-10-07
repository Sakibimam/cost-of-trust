import assert from "node:assert/strict";
import { decideFromHistory, decisionHistory, type Outcome } from "./run.ts";

const outcomes: Outcome[] = [
  { txHash: "a", at: 1, outcome: "paid", policyId: "p", unit: "u" },
  { txHash: "b", at: 2, outcome: "paid", policyId: "p", unit: "u" },
  { txHash: "c", at: 3, outcome: "paid", policyId: "p", unit: "u" },
  { txHash: "d", at: 4, outcome: "paid", policyId: "p", unit: "u" },
  { txHash: "e", at: 5, outcome: "paid", policyId: "p", unit: "u" },
  { txHash: "f", at: 6, outcome: "disputed", policyId: "p", unit: "u" },
];

assert.equal(decideFromHistory(decisionHistory(outcomes, 5)), "hire");
assert.equal(decideFromHistory(decisionHistory(outcomes, 6)), "skip");
assert.equal(decisionHistory(outcomes, 5).length, 5);
console.log("future-outcome guard: pass");
