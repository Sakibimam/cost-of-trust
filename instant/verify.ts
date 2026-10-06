export type VerifyInput = { inputUnspent: boolean; amountLovelace: bigint; expectedAmountLovelace: bigint; payTo: string; expectedPayTo: string; signatureValid: boolean };

export function verifyGate(input: VerifyInput): void {
  if (!input.signatureValid) throw new Error("signature invalid");
  if (!input.inputUnspent) throw new Error("input already spent");
  if (input.amountLovelace !== input.expectedAmountLovelace) throw new Error("amount mismatch");
  if (input.payTo !== input.expectedPayTo) throw new Error("payTo mismatch");
}
