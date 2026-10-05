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

export function buildBody(termsHash: string, decision: Decision, coverageTxHash: string, coverageIndex: number): Uint8Array {
  const clean = (value: string, name: string) => {
    if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${name} must be 32-byte hex`);
    return Uint8Array.from(value.match(/../g)!.map((x) => parseInt(x, 16)));
  };
  if (!Number.isInteger(coverageIndex) || coverageIndex < 0 || coverageIndex > 0xffff) throw new Error("coverage index out of range");
  const body = new Uint8Array(67);
  body.set(clean(termsHash, "terms hash"), 0);
  body[32] = DECISION_BYTE[decision];
  body.set(clean(coverageTxHash, "coverage tx hash"), 33);
  body[65] = coverageIndex >> 8;
  body[66] = coverageIndex & 0xff;
  return body;
}
