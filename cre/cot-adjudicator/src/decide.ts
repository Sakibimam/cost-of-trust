export type Decision = "SUCCESS" | "FAILURE" | "INCONCLUSIVE";
export const DECISION_BYTE: Record<Decision, number> = { SUCCESS: 0, FAILURE: 1, INCONCLUSIVE: 2 };

export type AdjudicationFacts = {
  coverageLockTime: number;
  decideBy: number;
  expiry: number;
  now: number;
  blocksInWindow: number;
  spend?: {
    txHash: string;
    blockTime: number;
    paysBeneficiary: boolean;
    signedBySponsor: boolean;
    kind: "claim" | "forfeit" | "other";
  };
};

export type DecisionResult = { decision: Decision; reason: string };

export function decide(facts: AdjudicationFacts): DecisionResult {
  if (facts.coverageLockTime >= facts.expiry) return { decision: "INCONCLUSIVE", reason: "expiry-passed-at-coverage-lock" };
  if (facts.blocksInWindow === 0) return { decision: "INCONCLUSIVE", reason: "chain-halt-in-decision-window" };
  if (facts.spend?.kind === "forfeit" && facts.spend.signedBySponsor) return { decision: "FAILURE", reason: "buyer-signed-forfeit" };
  if (facts.spend?.kind === "claim" && facts.spend.paysBeneficiary && facts.spend.blockTime < facts.expiry) {
    return { decision: "SUCCESS", reason: "claimed-before-expiry" };
  }
  if (!facts.spend && facts.now >= facts.expiry) return { decision: "FAILURE", reason: "unspent-after-expiry" };
  if (facts.spend && facts.spend.blockTime >= facts.expiry) return { decision: "FAILURE", reason: "spent-after-expiry" };
  if (facts.now >= facts.decideBy) return { decision: "FAILURE", reason: "unresolved-at-decide-by" };
  return { decision: "INCONCLUSIVE", reason: "claim-state-not-final" };
}

// 101-byte report body: terms_hash(32) | decision(1) | coverage_tx(32) | coverage_idx(2 BE) | task_tx(32) | task_idx(2 BE).
// The coverage validator only settles SUCCESS (0) and FAILURE (1), so INCONCLUSIVE has no body.
export function buildBody(termsHash: string, decision: Decision, coverageTxHash: string, coverageIndex: number, taskTxHash: string, taskIndex: number): Uint8Array {
  if (decision === "INCONCLUSIVE") throw new Error("INCONCLUSIVE is never settleable on chain");
  const clean = (value: string, name: string) => {
    if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${name} must be 32-byte hex`);
    return Uint8Array.from(value.match(/../g)!.map((x) => parseInt(x, 16)));
  };
  const index16 = (value: number, name: string) => { if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error(`${name} out of range`); };
  index16(coverageIndex, "coverage index");
  index16(taskIndex, "task index");
  const body = new Uint8Array(101);
  body.set(clean(termsHash, "terms hash"), 0);
  body[32] = DECISION_BYTE[decision];
  body.set(clean(coverageTxHash, "coverage tx hash"), 33);
  body[65] = coverageIndex >> 8;
  body[66] = coverageIndex & 0xff;
  body.set(clean(taskTxHash, "task tx hash"), 67);
  body[99] = taskIndex >> 8;
  body[100] = taskIndex & 0xff;
  return body;
}
