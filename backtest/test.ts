import assert from "node:assert/strict";
import { decideFromHistory, decisionHistory, skippedJobCost, type Agent, type Outcome } from "./run.ts";

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

const mostlySuccessful: Agent = {
  id: "target", policyId: "capability", unit: "target", name: "target", priceAda: 0, provider: "test",
  outcomes: [...outcomes.slice(0, 5),
    { txHash: "f", at: 6, outcome: "refunded", policyId: "p", unit: "u" },
    { txHash: "g", at: 7, outcome: "paid", policyId: "p", unit: "u" },
    { txHash: "h", at: 8, outcome: "paid", policyId: "p", unit: "u" }], firstAt: 1, lastAt: 8,
};
const decisions = mostlySuccessful.outcomes.slice(5);
const skipCost = decisions.reduce((sum, current) => sum + skippedJobCost(mostlySuccessful, [mostlySuccessful], current, 100), 0);
const hireCost = decisions.filter((current) => current.outcome !== "paid").length * 100;
assert.equal(hireCost, 100);
assert.equal(skipCost, 300);
assert.ok(skipCost > hireCost);
console.log("skip accounting guard: pass");
