import { createHash } from "node:crypto";

// Hires the registered ADA-priced backup agent through MPS escrow. Called at the buyer checkpoint when the primary has no result.
const mps = process.env.MPS_URL ?? "http://127.0.0.1:3012/api/v1";
const token = process.env.MPS_API_TOKEN!;
const backupId = process.env.MASUMI_BACKUP_ID!;
const input = { url: "https://example.com/" };
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const mpsPost = async (path: string, body: unknown) => { const r = await fetch(`${mps}${path}`, { method: "POST", headers: { "content-type": "application/json", token }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) }); const j = await r.json() as any; if (!r.ok) throw new Error(`MPS ${r.status}: ${JSON.stringify(j).slice(0, 500)}`); return j.data ?? j; };
const log = (step: string, detail: object = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), step, ...detail }));
const job = await (await fetch(process.env.BACKUP_URL ?? "http://127.0.0.1:4512/start_job", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) })).json() as any;
const pay = job.payment.data ?? job.payment;
log("backup_payment_request", { blockchainIdentifier: pay.blockchainIdentifier, requestedFunds: pay.RequestedFunds, submitResultTime: pay.submitResultTime, unlockTime: pay.unlockTime });
const purchase = await mpsPost("/purchase", { network: "Preprod", paymentSourceType: "Web3CardanoV2", supportedPaymentSourceIndex: 0, blockchainIdentifier: pay.blockchainIdentifier, sellerVkey: pay.sellerVkey ?? pay.SmartContractWallet?.walletVkey, agentIdentifier: backupId, inputHash: sha256(JSON.stringify(input)), Amounts: pay.RequestedFunds.map((f: any) => ({ amount: f.amount, unit: f.unit })), payByTime: pay.payByTime, submitResultTime: pay.submitResultTime, unlockTime: pay.unlockTime, externalDisputeUnlockTime: pay.externalDisputeUnlockTime, identifierFromPurchaser: pay.identifierFromPurchaser });
log("backup_escrow_lock_requested", { purchaseId: purchase.id, blockchainIdentifier: purchase.blockchainIdentifier });
