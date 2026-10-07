export type RiskSignals = {
  payerTxCount: number;
  priorConflicts: number;
  inputConfirmations: number;
  amountLovelace: bigint;
  inputUnspent: boolean;
  mempoolConflict: boolean;
};

export type PriceInput = RiskSignals & {
  observedSuccesses: number;
  observedFailures: number;
  routerPLoss: number;
  marginLovelace: bigint;
};

export type Price = { pLoss: number; feeLovelace: bigint; serveInstant: boolean; reason: string };

export function priceInstantRisk(input: PriceInput): Price {
  if (!input.inputUnspent || input.mempoolConflict) return { pLoss: 1, feeLovelace: input.amountLovelace + input.marginLovelace, serveInstant: false, reason: "input already spent or conflicting transaction observed" };
  if (!Number.isFinite(input.routerPLoss) || input.routerPLoss < 0 || input.routerPLoss > 1) throw new Error("routerPLoss must be between 0 and 1");
  const alpha = 2 + input.observedFailures;
  const beta = 8 + input.observedSuccesses;
  const measured = alpha / (alpha + beta);
  const historyPenalty = input.payerTxCount === 0 ? 0.05 : Math.min(input.priorConflicts / Math.max(input.payerTxCount, 1) * 0.5, 0.25);
  const ageDiscount = Math.min(input.inputConfirmations / 20, 0.1);
  const pLoss = Math.min(0.999, Math.max(0.001, (measured + input.routerPLoss) / 2 + historyPenalty - ageDiscount));
  const feeLovelace = BigInt(Math.ceil(Number(input.amountLovelace) * pLoss)) + input.marginLovelace;
  const maxInstantPLoss = Number(process.env.MAX_INSTANT_PLOSS ?? 0.2);
  return { pLoss, feeLovelace, serveInstant: feeLovelace <= input.amountLovelace && pLoss <= maxInstantPLoss, reason: `measured Beta risk plus router risk, payer history, and input age; instant threshold ${maxInstantPLoss}` };
}
