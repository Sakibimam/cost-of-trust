import { priceInstantRisk } from "./pricing";
import { verifyGate } from "./verify";

const base = { payerTxCount: 4, priorConflicts: 0, inputConfirmations: 3, amountLovelace: 1_000_000n, inputUnspent: true, mempoolConflict: false, observedSuccesses: 2, observedFailures: 0, routerPLoss: 0.1, marginLovelace: 10_000n };
if (priceInstantRisk(base).pLoss <= 0) throw new Error("pricing produced no risk");
verifyGate({ inputUnspent: true, amountLovelace: 1n, expectedAmountLovelace: 1n, payTo: "a", expectedPayTo: "a", signatureValid: true });
let rejected = false;
try { verifyGate({ inputUnspent: false, amountLovelace: 1n, expectedAmountLovelace: 1n, payTo: "a", expectedPayTo: "a", signatureValid: true }); } catch { rejected = true; }
if (!rejected) throw new Error("spent input was accepted");
const risky = priceInstantRisk({ ...base, routerPLoss: 0.99, marginLovelace: 0n });
if (risky.serveInstant) throw new Error("high-risk payment was served instantly");
if (risky.feeLovelace <= 0n) throw new Error("risk fee was not charged");
process.env.INSTANT_TEST = "true";
const { validatePaidPayment } = await import("./seller");
validatePaidPayment({ inputUnspent: true, amountLovelace: 2n, expectedAmountLovelace: 2n, payTo: "a", expectedPayTo: "a", signatureValid: true });
let serverPathRejected = false;
try { validatePaidPayment({ inputUnspent: true, amountLovelace: 2n, expectedAmountLovelace: 3n, payTo: "a", expectedPayTo: "a", signatureValid: true }); } catch { serverPathRejected = true; }
if (!serverPathRejected) throw new Error("server payment path accepted an amount mismatch");
console.log("instant tests pass: pricing and spent-input gate");
