import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calibratedPrior, decideFromHistory, decisionHistory, skippedJobCost, walkForwardHistory, type Agent, type Outcome } from "./run.ts";

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

const split = walkForwardHistory(outcomes, 6);
assert.deepEqual(split.map((item) => item.txHash), ["a", "b", "c", "d", "e"]);
assert.equal(split.some((item) => item.at >= 6), false);
console.log("held-out walk-forward guard: pass");

const implementation = readFileSync(new URL("./run.ts", import.meta.url), "utf8");
assert.match(implementation, /import \{ decideCapabilityRoute/);
assert.match(implementation, /decideCapabilityRoute\(\{/);
console.log("product decision function coupling: pass");

const calibrationAgent: Agent = { ...mostlySuccessful, outcomes: [
  { txHash: "train-paid", at: 1, outcome: "paid", policyId: "p", unit: "u" },
  { txHash: "train-fail", at: 2, outcome: "refunded", policyId: "p", unit: "u" },
  { txHash: "heldout-fail", at: 20, outcome: "refunded", policyId: "p", unit: "u" },
  { txHash: "heldout-fail-2", at: 21, outcome: "refunded", policyId: "p", unit: "u" },
], firstAt: 1, lastAt: 21 };
const prior = calibratedPrior([calibrationAgent], 10);
assert.equal(prior.observations, 2);
assert.equal(prior.failureRate, 0.5);
console.log("held-out calibration guard: pass");
