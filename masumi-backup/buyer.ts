import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReport, decide } from "../coworker/src/report.ts";
import { evaluateRoutes, type Seller } from "../router/src/routes.ts";
import underwriter from "../router/underwriter.json" with { type: "json" };
import { shouldHireBackup } from "./checkpoint.ts";

const mode = process.argv[2] === "stall" ? "stall" : "healthy";
const mps = process.env.MPS_URL ?? "http://127.0.0.1:3012/api/v1";
const token = process.env.MPS_API_TOKEN;
const primaryId = process.env.MASUMI_PRIMARY_ID;
const backupId = process.env.MASUMI_BACKUP_ID;
const priceAsset = process.env.MASUMI_PRICE_ASSET ?? "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d";
if (!token || !primaryId || !backupId) throw new Error("MPS_API_TOKEN, MASUMI_PRIMARY_ID, and MASUMI_BACKUP_ID are required");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const nowIso = () => new Date().toISOString();
const mpsJson = async (path: string, body?: Record<string, unknown>) => { const response = await fetch(`${mps}${path}${body ? "" : ""}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", token }, ...(body ? { body: JSON.stringify(body) } : {}) }); const json = await response.json() as any; if (!response.ok) throw new Error(`MPS ${response.status}: ${JSON.stringify(json).slice(0, 700)}`); return json.data ?? json; };
const idOf = (payment: any) => String(payment.blockchainIdentifier ?? payment.data?.blockchainIdentifier);
const stateOf = async (identifier: string) => { try { return await mpsJson("/purchase/resolve-blockchain-identifier", { network: "Preprod", blockchainIdentifier: identifier, includeHistory: "true" }); } catch (error) { if (error instanceof Error && error.message.includes("Purchase not found")) return null; throw error; } };
const wait = async (identifier: string, predicate: (value: any) => boolean, timeout: number) => { const end = Date.now() + timeout; let last: any; while (Date.now() < end) { last = await stateOf(identifier); if (last && predicate(last)) return last; await new Promise((resolve) => setTimeout(resolve, 4_000)); } throw new Error(`timeout waiting for ${identifier.slice(0, 12)} state; last=${last?.onChainState ?? "not found"}`); };
const txs = (data: any) => [...(data.TransactionHistory ?? []), ...(data.CurrentTransaction ? [data.CurrentTransaction] : [])].filter((tx: any) => tx?.txHash).map((tx: any) => ({ txHash: tx.txHash, state: tx.newOnChainState, status: tx.status }));
const recordTxStatuses = async (records: any[]) => { for (const record of records) { const response = await fetch("https://preprod.koios.rest/api/v1/tx_status", { method: "POST", headers: { "content-type": "application/json", ...(process.env.KAIOS_KEY ? { authorization: `Bearer ${process.env.KAIOS_KEY}` } : {}) }, body: JSON.stringify({ _tx_hashes: [record.txHash] }) }); record.koios = response.ok ? (await response.json())[0] : { status: `HTTP ${response.status}` }; } };
const start = async (url: string) => { const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com/" }) }); if (!response.ok) throw new Error(`agent start ${response.status}: ${await response.text()}`); return await response.json() as any; };
const purchasePayload = (payment: any, agentIdentifier: string) => ({ network: "Preprod", paymentSourceType: "Web3CardanoV2", supportedPaymentSourceIndex: 0, blockchainIdentifier: idOf(payment), sellerVkey: payment.sellerVkey ?? payment.SmartContractWallet?.walletVkey, agentIdentifier, inputHash: sha256(JSON.stringify(input)), Amounts: [{ amount: process.env.MASUMI_PRICE_AMOUNT ?? "1000000", unit: priceAsset }], payByTime: payment.payByTime, submitResultTime: payment.submitResultTime, unlockTime: payment.unlockTime, externalDisputeUnlockTime: payment.externalDisputeUnlockTime, identifierFromPurchaser: payment.identifierFromPurchaser });

await mkdir("agents/runs", { recursive: true });
const startedAt = nowIso();
const run: any = { mode, startedAt, buyerDeadline: new Date(Date.now() + 20 * 60_000).toISOString(), records: [], primary: { agentIdentifier: primaryId }, backup: { agentIdentifier: backupId } };
const record = (step: string, detail: any) => { run.records.push({ at: nowIso(), step, ...detail }); };
const input = { url: "https://example.com/" };
const report = await createReport({ agentIdentifier: primaryId, taskValueAtRiskAda: 1, deadlineMinutes: 10, riskAversion: 0.9, sharedInfrastructure: false });
const primarySeller: Seller = { id: primaryId, name: "Masumi Backup Primary", priceAda: 0, provider: "localhost", payTo: "mps", endpoint: "", successes: 0, failures: mode === "stall" ? 1 : 0, evidence: [] };
const backupSeller: Seller = { ...primarySeller, id: backupId, name: "Masumi Backup Fallback", failures: 0 };
const route = evaluateRoutes({ downstreamLossAda: 1, candidateSellers: [primarySeller, backupSeller], constraints: { allowRedundancy: true }, underwriter, riskAversion: 0.9, sharedInfrastructure: false });
record("trust_check_decision", { recommendation: decide(report.facts, 1, report.input), reportRecommendation: report.recommendation, selectedRoute: route.selectedRoute, selectedSellers: route.selectedSellers });
const primaryJob = await start(process.env.PRIMARY_URL ?? "http://127.0.0.1:4511/start_job");
const primaryPayment = primaryJob.payment.data ?? primaryJob.payment;
record("primary_payment_request", { blockchainIdentifier: idOf(primaryPayment), submitResultTime: primaryPayment.submitResultTime, unlockTime: primaryPayment.unlockTime });
const primaryPurchase = await mpsJson("/purchase", purchasePayload(primaryPayment, primaryId));
record("primary_escrow_lock_requested", { purchaseId: primaryPurchase.id, blockchainIdentifier: idOf(primaryPurchase), txs: txs(primaryPurchase) });
const primaryIdValue = idOf(primaryPurchase);
const checkpointAt = Date.now() + (Number(process.env.CHECKPOINT_MS ?? 120_000));
let primaryState: any;
try { primaryState = await wait(primaryIdValue, (value) => Boolean(value.resultHash || value.onChainState === "ResultSubmitted"), Math.max(1, checkpointAt - Date.now())); } catch { primaryState = null; }
if (Date.now() < checkpointAt) await new Promise((resolve) => setTimeout(resolve, checkpointAt - Date.now()));
const hireBackup = shouldHireBackup(primaryState, checkpointAt);
record("buyer_checkpoint", { checkpointAt: new Date(checkpointAt).toISOString(), primaryResultArrivedAt: primaryState?.onChainStateOrResultLastChangedAt ?? null, hireBackup });
if (!hireBackup) { record("primary_result_delivered", { resultHash: primaryState.resultHash, resultArrivedAt: nowIso() }); }
else {
  const backupJob = await start(process.env.BACKUP_URL ?? "http://127.0.0.1:4512/start_job");
  const backupPayment = backupJob.payment.data ?? backupJob.payment;
  const backupPurchase = await mpsJson("/purchase", purchasePayload(backupPayment, backupId));
  record("backup_escrow_lock_requested", { purchaseId: backupPurchase.id, blockchainIdentifier: idOf(backupPurchase), txs: txs(backupPurchase) });
  const backupState = await wait(idOf(backupPurchase), (value) => Boolean(value.resultHash || value.onChainState === "ResultSubmitted"), 600_000);
  record("backup_result_submitted", { resultHash: backupState.resultHash, resultArrivedAt: nowIso(), txs: txs(backupState) });
  try { const collected = await wait(idOf(backupPurchase), (value) => value.onChainState === "Withdrawn", 1_200_000); record("backup_collection", { state: collected.onChainState, txs: txs(collected) }); } catch (error) { record("backup_collection_pending", { error: error instanceof Error ? error.message : String(error) }); }
  try { const refunded = await wait(primaryIdValue, (value) => value.onChainState === "RefundWithdrawn", 2_700_000); record("primary_refund", { state: refunded.onChainState, refundTime: nowIso(), txs: txs(refunded) }); } catch (error) { record("primary_refund_pending", { error: error instanceof Error ? error.message : String(error), refundExpectedAfter: primaryPayment.unlockTime }); }
}
run.finishedAt = nowIso(); run.primary.txTotal = run.records.find((entry: any) => entry.step === "primary_escrow_lock_requested")?.txs ?? []; run.backup.txTotal = run.records.find((entry: any) => entry.step === "backup_escrow_lock_requested")?.txs ?? [];
const file = `agents/runs/${startedAt.replaceAll(":", "-").replaceAll(".", "-")}-masumi-backup-${mode}.json`; await recordTxStatuses([...run.primary.txTotal, ...run.backup.txTotal, ...run.records.flatMap((entry: any) => entry.txs ?? [])]); await writeFile(file, `${JSON.stringify(run, null, 2)}\n`); console.log(JSON.stringify({ file, mode, primary: primaryId, backup: backupId, paid: run.records.filter((entry: any) => /escrow_lock_requested/.test(entry.step)).length }));
