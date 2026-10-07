import { readFile, writeFile } from "node:fs/promises";
import { decodeCardanoTransaction, toFacilitatorCardanoSigner } from "@x402/cardano";
import { ExactCardanoScheme } from "@x402/cardano/exact/facilitator";
import { decodePaymentSignatureHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { x402Facilitator } from "@x402/core/facilitator";

export type StoredDelivery = { status: "complete"; report: unknown; paymentResponse: unknown; requestHash?: string };
export class PaymentAlreadyUsedError extends Error {
  constructor(readonly txId: string) { super("payment already used"); this.name = "PaymentAlreadyUsedError"; }
}

export class PaymentRejectedError extends Error {
  constructor(reason: string) { super(`payment rejected: ${reason}`); this.name = "PaymentRejectedError"; }
}

const deliveryPath = "/tmp/cost-of-trust-x402-deliveries.json";
const deliveries = new Map<string, StoredDelivery>();
const locks = new Map<string, Promise<unknown>>();
let loaded = false;
let koiosFetch: typeof fetch | undefined;

async function loadDeliveries() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = JSON.parse(await readFile(deliveryPath, "utf8")) as Record<string, StoredDelivery>;
    for (const [txId, delivery] of Object.entries(saved)) deliveries.set(txId, delivery);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function saveDelivery(txId: string, delivery: StoredDelivery) {
  deliveries.set(txId, delivery);
  await writeFile(deliveryPath, JSON.stringify(Object.fromEntries(deliveries)), { mode: 0o600 });
}

const facilitator = (() => {
  const signer = toFacilitatorCardanoSigner({
    network: "cardano:preprod",
    provider: { koios: { baseUrl: process.env.KOIOS_URL ?? "https://preprod.koios.rest/api/v1", token: process.env.KAIOS_KEY }, requestTimeoutMs: 20_000 },
    awaitConfirmation: true,
  });
  return new x402Facilitator().register("cardano:preprod", new ExactCardanoScheme(signer));
})();

export function txIdFromPayment(header: string): string {
  const payment = decodePaymentSignatureHeader(header) as { payload?: { transaction?: string } };
  const transaction = payment.payload?.transaction;
  if (!transaction) throw new Error("payment payload has no transaction");
  return decodeCardanoTransaction(transaction).txHash;
}

async function koiosPost(path: string, body: unknown): Promise<Response> {
  const baseUrl = process.env.KOIOS_URL ?? "https://preprod.koios.rest/api/v1";
  const headers = { "content-type": "application/json", ...(process.env.KAIOS_KEY ? { authorization: `Bearer ${process.env.KAIOS_KEY}` } : {}) };
  const request = koiosFetch ?? fetch;
  for (let attempt = 0; ; attempt++) {
    const response = await request(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (response.status !== 429 || attempt === 3) return response;
    await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
  }
}

async function confirmedOnChain(txId: string): Promise<boolean> {
  const status = await koiosPost("/tx_status", { _tx_hashes: [txId] });
  if (!status.ok) throw new Error(`Koios tx_status failed: ${status.status}`);
  const rows = await status.json() as Array<{ num_confirmations?: number | null }>;
  if ((rows[0]?.num_confirmations ?? 0) > 0) return true;
  const info = await koiosPost("/tx_info", { _tx_hashes: [txId] });
  if (info.status === 404) return false;
  if (!info.ok) throw new Error(`Koios tx_info failed: ${info.status}`);
  const infoRows = await info.json() as Array<{ block_hash?: string | null; block_height?: number | null }>;
  return Boolean(infoRows[0]?.block_hash || infoRows[0]?.block_height != null);
}

export type OnChainPayment = { confirmed: boolean; lovelaceToPayTo: bigint; timestamp: number | null };

// What the chain says about a payment: is the tx in a block, and how much did it send to payTo.
export async function readPayment(txId: string, payTo: string): Promise<OnChainPayment> {
  const info = await koiosPost("/tx_info", { _tx_hashes: [txId], _inputs: false, _metadata: false, _assets: false, _withdrawals: false, _certs: false, _scripts: false, _bytecode: false });
  if (info.status === 404) return { confirmed: false, lovelaceToPayTo: 0n, timestamp: null };
  if (!info.ok) throw new Error(`Koios tx_info failed: ${info.status}`);
  const [row] = await info.json() as Array<{ block_hash?: string | null; block_height?: number | null; tx_timestamp?: number | null; outputs?: Array<{ payment_addr?: { bech32?: string }; value?: string }> }>;
  if (!row) return { confirmed: false, lovelaceToPayTo: 0n, timestamp: null };
  const lovelaceToPayTo = (row.outputs ?? []).filter((output) => output.payment_addr?.bech32 === payTo).reduce((sum, output) => sum + BigInt(output.value ?? "0"), 0n);
  return { confirmed: Boolean(row.block_hash || row.block_height != null), lovelaceToPayTo, timestamp: row.tx_timestamp ?? null };
}

export { confirmedOnChain };

async function settleUncoordinated(header: string, requirements: Record<string, unknown>) {
  await loadDeliveries();
  const txId = txIdFromPayment(header);
  const cached = deliveries.get(txId);
  if (cached) return { txId, cached };
  if (await confirmedOnChain(txId)) throw new PaymentAlreadyUsedError(txId);
  const payment = decodePaymentSignatureHeader(header);
  const verified = await facilitator.verify(payment as never, requirements as never);
  if (!verified.isValid) throw new PaymentRejectedError(verified.invalidReason ?? "invalid");
  const deadline = Date.now() + 35_000;
  for (;;) {
    const settled = await facilitator.settle(payment as never, requirements as never);
    if (settled.success) return { txId, paymentResponse: settled };
    if (await confirmedOnChain(txId)) return { txId, paymentResponse: { success: true, transaction: txId, network: "cardano:preprod" } };
    if (!(settled.errorReason === "settlement_pending" || settled.errorReason === "exact_cardano_settlement_not_confirmed") || Date.now() >= deadline) throw new Error(`payment settlement failed: ${settled.errorReason ?? "failed"}`);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

export async function settleOnce(header: string, requirements: Record<string, unknown>) {
  const txId = txIdFromPayment(header);
  const active = locks.get(`settle:${txId}`);
  if (active) return active as Promise<{ txId: string; cached?: StoredDelivery; paymentResponse?: unknown }>;
  const run = settleUncoordinated(header, requirements).finally(() => locks.delete(`settle:${txId}`));
  locks.set(`settle:${txId}`, run);
  return run;
}

export async function recordDelivery(txId: string, report: unknown, paymentResponse: unknown, requestHash?: string) {
  await saveDelivery(txId, { status: "complete", report, paymentResponse, requestHash });
}

export async function getDelivery(txId: string) { await loadDeliveries(); return deliveries.get(txId); }
export function withDeliveryLock<T>(txId: string, work: () => Promise<T>): Promise<T> {
  const active = locks.get(`delivery:${txId}`);
  if (active) return active as Promise<T>;
  const run = work().finally(() => locks.delete(`delivery:${txId}`));
  locks.set(`delivery:${txId}`, run);
  return run;
}
export function setKoiosFetchForTests(fetchImpl: typeof fetch | undefined) { koiosFetch = fetchImpl; }
export function resetSettlementStateForTests() { deliveries.clear(); locks.clear(); loaded = true; }
export { encodePaymentResponseHeader };
