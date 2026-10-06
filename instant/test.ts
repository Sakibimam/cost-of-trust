import { priceInstantRisk } from "./pricing";
import { verifyGate } from "./verify";

const base = { payerTxCount: 4, priorConflicts: 0, inputConfirmations: 3, amountLovelace: 1_000_000n, inputUnspent: true, mempoolConflict: false, observedSuccesses: 2, observedFailures: 0, routerPLoss: 0.1, marginLovelace: 10_000n };
if (priceInstantRisk(base).pLoss <= 0) throw new Error("pricing produced no risk");
verifyGate({ inputUnspent: true, amountLovelace: 1n, expectedAmountLovelace: 1n, payTo: "a", expectedPayTo: "a", signatureValid: true });
let rejected = false;
try { verifyGate({ inputUnspent: false, amountLovelace: 1n, expectedAmountLovelace: 1n, payTo: "a", expectedPayTo: "a", signatureValid: true }); } catch { rejected = true; }
if (!rejected) throw new Error("spent input was accepted");
console.log("instant tests pass: pricing and spent-input gate");
