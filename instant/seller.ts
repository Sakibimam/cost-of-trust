import { decodePaymentSignatureHeader, encodePaymentRequiredHeader } from "../agents/node_modules/@x402/core/dist/esm/http/index.mjs";
import { x402Facilitator } from "../agents/node_modules/@x402/core/dist/esm/facilitator/index.mjs";
import { toFacilitatorCardanoSigner } from "../agents/node_modules/@x402/cardano/dist/esm/index.mjs";
import { decodeCardanoTransactionBytes } from "../agents/node_modules/@x402/cardano/dist/esm/index.mjs";
import { ExactCardanoScheme } from "../agents/node_modules/@x402/cardano/dist/esm/exact/facilitator/index.mjs";
import { priceInstantRisk } from "./pricing";

const port = Number(process.env.PORT ?? 4190);
const payTo = process.env.PAY_TO ?? "";
const router = process.env.ROUTER_URL ?? "http://127.0.0.1:8787";
const koios = process.env.KOIOS_URL ?? "https://preprod.koios.rest/api/v1";
const mode = process.env.INSTANT_MODE === "false" ? "confirmed" : "instant";
const signer = toFacilitatorCardanoSigner({ network: "cardano:preprod", provider: { koios: { baseUrl: koios, token: process.env.KAIOS_KEY }, requestTimeoutMs: 120_000 }, awaitConfirmation: true });
const mempoolSigner = { ...signer, async submitTransaction(signed: string, network: string) { void network; const response = await fetch(`${koios}/submittx`, { method: "POST", headers: { authorization: `Bearer ${process.env.KAIOS_KEY ?? ""}`, "content-type": "application/cbor" }, body: decodeCardanoTransactionBytes(signed) }); const raw = await response.text(); if (!response.ok) throw new Error(`Koios submittx returned ${response.status}: ${raw.slice(0, 300)}`); let body: unknown; try { body = JSON.parse(raw); } catch { body = raw; } const hash = Array.isArray(body) ? (body[0] as { tx_hash?: string })?.tx_hash : (body as { tx_hash?: string })?.tx_hash ?? (typeof body === "string" ? body.replaceAll('"', '').trim() : ""); if (!hash) throw new Error(`Koios submittx omitted tx hash: ${raw.slice(0, 300)}`); return { txHash: hash, status: "mempool" as const }; } };
const facilitator = new x402Facilitator();
facilitator.register("cardano:preprod", new ExactCardanoScheme(mempoolSigner, { acceptMempool: true, confirmationTimeoutMs: mode === "confirmed" ? 120_000 : 2_000, confirmationPollMs: 500 }));

type Req = { amount: string; asset: string; payTo: string; maxTimeoutSeconds: number; extra: Record<string, unknown> };
const requirements = (taskId: string): Req => ({ amount: process.env.AMOUNT_LOVELACE ?? "1000000", asset: "lovelace", payTo, maxTimeoutSeconds: 600, extra: { assetTransferMethod: "default", confirmationPolicy: { l1Confirmations: mode === "instant" ? -1 : 0 }, costOfTrust: { taskId } } });
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item), { status, headers: { "content-type": "application/json", ...headers } });

async function routerRisk(amountLovelace: bigint): Promise<number> {
  const response = await fetch(`${router}/best-route`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: "instant x402 settlement", serviceType: "cardano_x402_instant", deadline: new Date(Date.now() + 600_000).toISOString(), downstreamLossAda: Number(amountLovelace) / 1_000_000, candidateSellers: [process.env.ROUTER_SELLER ?? "seller-b"], riskAversion: 0, constraints: { allowRedundancy: false } }) });
  if (!response.ok) throw new Error(`router quote failed ${response.status}`);
  const body = await response.json() as { routes?: Array<{ pLoss?: number }> };
  const pLoss = body.routes?.[0]?.pLoss;
  if (typeof pLoss !== "number") throw new Error("router quote omitted pLoss");
  return pLoss;
}

async function unspent(nonce: string): Promise<boolean> {
  const response = await fetch(`${koios}/utxo_info`, { method: "POST", headers: { authorization: `Bearer ${process.env.KAIOS_KEY ?? ""}`, "content-type": "application/json" }, body: JSON.stringify({ _utxo_refs: [nonce] }) });
  if (!response.ok) throw new Error(`Koios utxo_info returned ${response.status}`);
  const rows = await response.json() as unknown[];
  return rows.length > 0;
}

async function settle(header: string, req: Req, taskId: string) {
  const payment = decodePaymentSignatureHeader(header);
  const verified = await facilitator.verify(payment as never, { x402Version: 2, scheme: "exact", network: "cardano:preprod", amount: req.amount, asset: "lovelace", payTo: req.payTo, maxTimeoutSeconds: req.maxTimeoutSeconds, extra: req.extra } as never);
  if (!verified.isValid) throw new Error(`payment rejected: ${verified.invalidReason ?? "invalid"}`);
  const payload = payment.payload as { nonce?: string };
  if (!payload.nonce || !(await unspent(payload.nonce))) throw new Error("input already spent");
  const quote = await routerRisk(BigInt(req.amount));
  const price = priceInstantRisk({ payerTxCount: 1, priorConflicts: 0, inputConfirmations: 0, amountLovelace: BigInt(req.amount), inputUnspent: true, mempoolConflict: false, observedSuccesses: 0, observedFailures: 0, routerPLoss: quote, marginLovelace: BigInt(process.env.INSTANT_MARGIN_LOVELACE ?? "10000") });
  if (mode === "instant" && !price.serveInstant) return { fallback: true, price };
  const settled = await facilitator.settle(payment as never, { x402Version: 2, scheme: "exact", network: "cardano:preprod", amount: req.amount, asset: "lovelace", payTo: req.payTo, maxTimeoutSeconds: req.maxTimeoutSeconds, extra: req.extra } as never);
  if (!settled.success) throw new Error(`settlement pending: ${settled.errorReason ?? "unknown"}: ${settled.errorMessage ?? ""}`);
  return { paymentTx: settled.transaction, price, mode, taskId };
}

Bun.serve({ port, async fetch(request) {
  try {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, mode });
    if (request.method !== "POST" || url.pathname !== "/paid") return json({ error: "not found" }, 404);
    const body = await request.json() as { taskId?: string };
    const taskId = body.taskId ?? crypto.randomUUID();
    const req = requirements(taskId);
    const header = request.headers.get("payment-signature");
    if (!header) return new Response(JSON.stringify({ x402Version: 2, accepts: [{ scheme: "exact", network: "cardano:preprod", ...req }] }), { status: 402, headers: { "content-type": "application/json", "PAYMENT-REQUIRED": encodePaymentRequiredHeader({ x402Version: 2, resource: { url: request.url }, accepts: [{ scheme: "exact", network: "cardano:preprod", ...req }] } as never) } });
    const result = await settle(header, req, taskId);
    return json({ accepted: true, ...result });
  } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
} });

console.log(JSON.stringify({ port, mode, payTo: Boolean(payTo) }));
