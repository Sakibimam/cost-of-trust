import { decodePaymentSignatureHeader, encodePaymentRequiredHeader } from "../agents/node_modules/@x402/core/dist/esm/http/index.mjs";
import { x402Facilitator } from "../agents/node_modules/@x402/core/dist/esm/facilitator/index.mjs";
import { toFacilitatorCardanoSigner } from "../agents/node_modules/@x402/cardano/dist/esm/index.mjs";
import { decodeCardanoTransactionBytes } from "../agents/node_modules/@x402/cardano/dist/esm/index.mjs";
import { ExactCardanoScheme } from "../agents/node_modules/@x402/cardano/dist/esm/exact/facilitator/index.mjs";
import { priceInstantRisk } from "./pricing";
import { verifyGate } from "./verify";

const port = Number(process.env.PORT ?? 4190);
const payTo = process.env.PAY_TO ?? "";
const router = process.env.ROUTER_URL ?? "http://127.0.0.1:8787";
const koios = process.env.KOIOS_URL ?? "https://preprod.koios.rest/api/v1";
const mode = process.env.INSTANT_MODE === "false" ? "confirmed" : "instant";
const signer = toFacilitatorCardanoSigner({ network: "cardano:preprod", provider: { koios: { baseUrl: koios, token: process.env.KAIOS_KEY }, requestTimeoutMs: 120_000 }, awaitConfirmation: true });
const mempoolSigner = { ...signer, async submitTransaction(signed: string, network: string) { void network; const response = await fetch(`${koios}/submittx`, { method: "POST", headers: { authorization: `Bearer ${process.env.KAIOS_KEY ?? ""}`, "content-type": "application/cbor" }, body: decodeCardanoTransactionBytes(signed) }); const raw = await response.text(); if (!response.ok) throw new Error(`Koios submittx returned ${response.status}: ${raw.slice(0, 300)}`); let body: unknown; try { body = JSON.parse(raw); } catch { body = raw; } const hash = Array.isArray(body) ? (body[0] as { tx_hash?: string })?.tx_hash : (body as { tx_hash?: string })?.tx_hash ?? (typeof body === "string" ? body.replaceAll('"', '').trim() : ""); if (!hash) throw new Error(`Koios submittx omitted tx hash: ${raw.slice(0, 300)}`); return { txHash: hash, status: "mempool" as const }; } };
Object.assign(mempoolSigner, { async getTransactionEvidence(txHash: string) { const response = await fetch(`${koios}/tx_status`, { method: "POST", headers: { authorization: `Bearer ${process.env.KAIOS_KEY ?? ""}`, "content-type": "application/json" }, body: JSON.stringify({ _tx_hashes: [txHash] }) }); if (!response.ok) throw new Error(`Koios tx_status returned ${response.status}`); const row = (await response.json() as Array<{ num_confirmations?: number }>)[0]; if (!row) return { status: "unknown" as const, confirmations: -2 }; const confirmations = row.num_confirmations ?? 0; return { status: confirmations >= 1 ? "confirmed" as const : "mempool" as const, confirmations }; } });
const facilitator = new x402Facilitator();
facilitator.register("cardano:preprod", new ExactCardanoScheme(mempoolSigner, { acceptMempool: true, confirmationTimeoutMs: mode === "confirmed" ? 120_000 : 2_000, confirmationPollMs: 500 }));

type Req = { amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra: Record<string, unknown> };
const baseAmount = () => BigInt(process.env.AMOUNT_LOVELACE ?? "1000000");
const requirements = async (taskId: string): Promise<Req> => {
  const amount = baseAmount();
  const risk = await routerRisk(amount);
  const price = priceInstantRisk({ payerTxCount: 1, priorConflicts: 0, inputConfirmations: 0, amountLovelace: amount, inputUnspent: true, mempoolConflict: false, observedSuccesses: risk.observedSuccesses, observedFailures: risk.observedFailures, routerPLoss: risk.pLoss, marginLovelace: BigInt(process.env.INSTANT_MARGIN_LOVELACE ?? "10000") });
  return { amount: String(amount + price.feeLovelace), asset: "lovelace", payTo, maxTimeoutSeconds: 600, extra: { assetTransferMethod: "default", confirmationPolicy: { l1Confirmations: mode === "instant" ? -1 : 0 }, costOfTrust: { taskId } } };
};
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item), { status, headers: { "content-type": "application/json", ...headers } });

async function routerRisk(amountLovelace: bigint): Promise<{ pLoss: number; observedSuccesses: number; observedFailures: number }> {
  const response = await fetch(`${router}/best-route`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: "instant x402 settlement", serviceType: "cardano_x402_instant", deadline: new Date(Date.now() + 600_000).toISOString(), downstreamLossAda: Number(amountLovelace) / 1_000_000, candidateSellers: [process.env.ROUTER_SELLER ?? "seller-b"], riskAversion: 0, constraints: { allowRedundancy: false } }) });
  if (!response.ok) throw new Error(`router quote failed ${response.status}`);
  const body = await response.json() as { routes?: Array<{ pLoss?: number }> };
  const pLoss = body.routes?.[0]?.pLoss;
  if (typeof pLoss !== "number") throw new Error("router quote omitted pLoss");
  const sellers = await fetch(`${router}/sellers`);
  if (!sellers.ok) throw new Error(`router sellers failed ${sellers.status}`);
  const seller = (await sellers.json() as Array<{ id: string; successes: number; failures: number }>).find((item) => item.id === (process.env.ROUTER_SELLER ?? "seller-b"));
  if (!seller) throw new Error("router seller record missing");
  return { pLoss, observedSuccesses: seller.successes, observedFailures: seller.failures };
}

async function readRiskSignals(nonce: string): Promise<{ payerTxCount: number; inputConfirmations: number; mempoolConflict: boolean; inputUnspent: boolean }> {
  const [txHash] = nonce.split("#");
  if (!/^[0-9a-f]{64}$/i.test(txHash)) throw new Error("payment nonce is not a valid UTxO reference");
  const headers = { authorization: `Bearer ${process.env.KAIOS_KEY ?? ""}`, "content-type": "application/json" };
  const statusResponse = await fetch(`${koios}/tx_status`, { method: "POST", headers, body: JSON.stringify({ _tx_hashes: [txHash] }) });
  if (!statusResponse.ok) throw new Error(`Koios tx_status returned ${statusResponse.status}`);
  const status = (await statusResponse.json() as Array<{ num_confirmations?: number }>)[0];
  const txResponse = await fetch(`${koios}/tx_info`, { method: "POST", headers, body: JSON.stringify({ _tx_hashes: [txHash] }) });
  if (!txResponse.ok) throw new Error(`Koios tx_info returned ${txResponse.status}`);
  const tx = (await txResponse.json() as Array<{ outputs?: Array<{ address?: string; output_index?: number }> }>)[0];
  const outputIndex = Number(nonce.split("#")[1]);
  const payerAddress = tx?.outputs?.[outputIndex]?.address;
  if (!payerAddress) throw new Error("payment input address unavailable");
  const historyResponse = await fetch(`${koios}/address_txs`, { method: "POST", headers, body: JSON.stringify({ _addresses: [payerAddress] }) });
  if (!historyResponse.ok) throw new Error(`Koios address_txs returned ${historyResponse.status}`);
  const history = await historyResponse.json() as unknown[];
  const mempoolResponse = await fetch(`${koios}/mempool_info`, { method: "POST", headers, body: JSON.stringify({ _input_refs: [nonce] }) });
  if (!mempoolResponse.ok) throw new Error(`Koios mempool_info returned ${mempoolResponse.status}`);
  const mempool = await mempoolResponse.json() as unknown[];
  return { payerTxCount: history.length, inputConfirmations: status?.num_confirmations ?? 0, mempoolConflict: mempool.length > 1, inputUnspent: await unspent(nonce) };
}

export function validatePaidPayment(input: { inputUnspent: boolean; amountLovelace: bigint; expectedAmountLovelace: bigint; payTo: string; expectedPayTo: string; signatureValid: boolean }): void {
  verifyGate(input);
}

async function unspent(nonce: string): Promise<boolean> {
  const response = await fetch(`${koios}/utxo_info`, { method: "POST", headers: { authorization: `Bearer ${process.env.KAIOS_KEY ?? ""}`, "content-type": "application/json" }, body: JSON.stringify({ _utxo_refs: [nonce] }) });
  if (!response.ok) throw new Error(`Koios utxo_info returned ${response.status}`);
  const rows = await response.json() as Array<{ is_spent?: boolean }>;
  return rows.length > 0 && rows[0]?.is_spent !== true;
}

async function settle(header: string, req: Req, taskId: string) {
  const payment = decodePaymentSignatureHeader(header);
  const verified = await facilitator.verify(payment as never, { x402Version: 2, scheme: "exact", network: "cardano:preprod", amount: req.amount, asset: "lovelace", payTo: req.payTo, maxTimeoutSeconds: req.maxTimeoutSeconds, extra: req.extra } as never);
  if (!verified.isValid) throw new Error(`payment rejected: ${verified.invalidReason ?? "invalid"}`);
  const payload = payment.payload as { nonce?: string };
  if (!payload.nonce) throw new Error("payment nonce missing");
  const signals = await readRiskSignals(payload.nonce);
  validatePaidPayment({ inputUnspent: signals.inputUnspent, amountLovelace: BigInt(req.amount), expectedAmountLovelace: BigInt(req.amount), payTo: req.payTo, expectedPayTo: payTo, signatureValid: verified.isValid });
  const quote = await routerRisk(baseAmount());
  const price = priceInstantRisk({ ...signals, amountLovelace: baseAmount(), observedSuccesses: quote.observedSuccesses, observedFailures: quote.observedFailures, routerPLoss: quote.pLoss, marginLovelace: BigInt(process.env.INSTANT_MARGIN_LOVELACE ?? "10000") });
  if (mode === "instant" && !price.serveInstant) return { fallback: true, price };
  const settled = await facilitator.settle(payment as never, { x402Version: 2, scheme: "exact", network: "cardano:preprod", amount: req.amount, asset: "lovelace", payTo: req.payTo, maxTimeoutSeconds: req.maxTimeoutSeconds, extra: req.extra } as never);
  if (!settled.success) throw new Error(`settlement pending: ${settled.errorReason ?? "unknown"}: ${settled.errorMessage ?? ""}`);
  return { paymentTx: settled.transaction, price, mode, taskId };
}

if (!process.env.INSTANT_TEST) Bun.serve({ port, async fetch(request) {
  try {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, mode });
    if (request.method !== "POST" || url.pathname !== "/paid") return json({ error: "not found" }, 404);
    const body = await request.json() as { taskId?: string };
    const taskId = body.taskId ?? crypto.randomUUID();
    const req = await requirements(taskId);
    const header = request.headers.get("payment-signature");
    if (!header) return new Response(JSON.stringify({ x402Version: 2, accepts: [{ scheme: "exact", network: "cardano:preprod", ...req }] }), { status: 402, headers: { "content-type": "application/json", "PAYMENT-REQUIRED": encodePaymentRequiredHeader({ x402Version: 2, resource: { url: request.url }, accepts: [{ scheme: "exact", network: "cardano:preprod", ...req }] } as never) } });
    const result = await settle(header, req, taskId);
    return json({ accepted: true, ...result });
  } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
} });

if (!process.env.INSTANT_TEST) console.log(JSON.stringify({ port, mode, payTo: Boolean(payTo) }));
