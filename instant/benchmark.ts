import { readFileSync, writeFileSync } from "node:fs";
import { Address, Assets, Client, TransactionHash, preprod } from "@evolution-sdk/evolution";
import { x402Client } from "../agents/node_modules/@x402/core/dist/esm/client/index.mjs";
import { x402HTTPClient } from "../agents/node_modules/@x402/core/dist/esm/http/index.mjs";
import { toClientCardanoSigner, decodeCardanoTransaction } from "../agents/node_modules/@x402/cardano/dist/esm/index.mjs";
import { ExactCardanoScheme } from "../agents/node_modules/@x402/cardano/dist/esm/exact/client/index.mjs";

type WalletFile = { buyer: { seed: string } };
type Confirmation = { confirmations: number; status?: string; checkedAt: string };
type PaymentRow = { index: number; input: string; timeTo200Ms: number; txHash: string; confirmation: Confirmation };

const wallet = JSON.parse(readFileSync(process.env.WALLET_FILE ?? "/Users/user/Desktop/canton/recourse/.wallets.json", "utf8")) as WalletFile;
const koios = process.env.KOIOS_URL ?? "https://preprod.koios.rest/api/v1";
const buyerSeed = wallet.buyer.seed;
const network = "cardano:preprod";
const splitAmount = 5_000_000n;
const splitCount = 45;
const confirmationTimeoutMs = 300_000;

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${process.env.KAIOS_KEY ?? ""}`, ...extra };
}

async function retry<T>(fn: () => Promise<T>, retryable: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const value = await fn();
    if (!retryable(value) || attempt >= 8) return value;
    await Bun.sleep(1000 * 2 ** attempt);
  }
}

async function txStatus(txHash: string, minimum = 1): Promise<Confirmation> {
  const deadline = Date.now() + confirmationTimeoutMs;
  for (;;) {
    const response = await retry(
      () => fetch(`${koios}/tx_status`, { method: "POST", headers: authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ _tx_hashes: [txHash] }) }),
      (value) => value instanceof Response && value.status === 429,
    );
    if (!response.ok) throw new Error(`Koios tx_status ${response.status}`);
    const row = (await response.json() as Array<{ num_confirmations?: number; status?: string }>)[0];
    const confirmations = row?.num_confirmations ?? 0;
    if (confirmations >= minimum || /fail|reject/i.test(row?.status ?? "")) return { confirmations, status: row?.status, checkedAt: new Date().toISOString() };
    if (Date.now() > deadline) throw new Error(`confirmation timeout ${txHash}`);
    await Bun.sleep(4000);
  }
}

function ref(txHash: string, index: number): string {
  return `${txHash}#${index}`;
}

function refOf(utxo: { transactionId: unknown; index: number | bigint }): string {
  return `${TransactionHash.toHex(utxo.transactionId as never).toLowerCase()}#${Number(utxo.index)}`;
}

async function buyerClient() {
  return Client.make(preprod).withKoios({ baseUrl: koios, token: process.env.KAIOS_KEY }).withSeed({ mnemonic: buyerSeed });
}

async function splitBuyerUtxos(): Promise<{ txHash: string; inputs: string[] }> {
  const existing = process.env.BENCHMARK_SPLIT_TX?.toLowerCase();
  if (existing) {
    await txStatus(existing, 2);
    const inputs = Array.from({ length: splitCount }, (_, index) => ref(existing, index));
    const response = await fetch(`${koios}/utxo_info`, { method: "POST", headers: authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ _utxo_refs: inputs }) });
    const rows = await response.json() as unknown[];
    if (!response.ok || rows.length !== splitCount) throw new Error("existing split transaction does not expose 45 queryable UTxOs");
    return { txHash: existing, inputs };
  }
  const client = await buyerClient();
  const address = await client.address();
  const builder = client.newTx();
  for (let index = 0; index < splitCount; index++) builder.payToAddress({ address, assets: Assets.fromLovelace(splitAmount) });
  const submitted = await (await (await builder.build()).sign()).submit();
  const txHash = TransactionHash.toHex(submitted).toLowerCase();
  await txStatus(txHash, 2);
  const inputs = Array.from({ length: splitCount }, (_, index) => ref(txHash, index));
  const response = await fetch(`${koios}/utxo_info`, { method: "POST", headers: authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ _utxo_refs: inputs }) });
  const rows = await response.json() as unknown[];
  if (!response.ok || rows.length !== splitCount) throw new Error("split transaction did not create 45 queryable UTxOs");
  return { txHash, inputs };
}

function pinnedSigner(inputRef: string) {
  const signer = toClientCardanoSigner({ mnemonic: buyerSeed, network, provider: { koios: { baseUrl: koios, token: process.env.KAIOS_KEY } } });
  return {
    ...signer,
    async buildAndSignPaymentTransaction(input: Parameters<typeof signer.buildAndSignPaymentTransaction>[0]) {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (resource: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url;
        const response = await originalFetch(resource, init);
        if (!url.endsWith("/address_info")) return response;
        const body = await response.json() as Array<{ utxo_set?: Array<{ tx_hash: string; tx_index: number }> }>;
        const [txHash, indexText] = inputRef.split("#");
        const index = Number(indexText);
        const filtered = body.map((address) => ({ ...address, utxo_set: (address.utxo_set ?? []).filter((utxo) => utxo.tx_hash.toLowerCase() === txHash && utxo.tx_index === index) }));
        return new Response(JSON.stringify(filtered), { status: response.status, headers: response.headers });
      }) as typeof fetch;
      try {
        return await signer.buildAndSignPaymentTransaction(input);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  };
}

async function payment(url: string, inputRef: string, index: number): Promise<PaymentRow> {
  const started = performance.now();
  const taskId = crypto.randomUUID();
  const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId }) });
  if (first.status !== 402) throw new Error(`expected 402, got ${first.status}`);
  const client = new x402HTTPClient(new x402Client().setSpendControls(false).register("cardano:*", new ExactCardanoScheme(pinnedSigner(inputRef))));
  const required = client.getPaymentRequiredResponse((name) => first.headers.get(name));
  if (required.accepts[0]?.asset !== "lovelace") throw new Error(`split UTxOs do not carry required asset ${required.accepts[0]?.asset ?? "missing"}`);
  const signature = client.encodePaymentSignatureHeader(await client.createPaymentPayload(required));
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...signature }, body: JSON.stringify({ taskId }) });
  const timeTo200Ms = performance.now() - started;
  const body = await response.json() as { paymentTx?: string; error?: string };
  if (!response.ok || !body.paymentTx) throw new Error(body.error ?? `paid request failed ${response.status}`);
  return { index, input: inputRef, timeTo200Ms, txHash: body.paymentTx, confirmation: await txStatus(body.paymentTx) };
}

export async function doubleSpend(url: string, inputRef: string): Promise<Record<string, unknown>> {
  const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: crypto.randomUUID() }) });
  if (first.status !== 402) throw new Error(`double-spend setup expected 402, got ${first.status}`);
  const client = new x402HTTPClient(new x402Client().setSpendControls(false).register("cardano:*", new ExactCardanoScheme(pinnedSigner(inputRef))));
  const required = client.getPaymentRequiredResponse((name) => first.headers.get(name));
  const payload = await client.createPaymentPayload(required);
  const signature = client.encodePaymentSignatureHeader(payload);
  const decoded = decodeCardanoTransaction(payload.payload.transaction);
  const buyer = await buyerClient();
  const utxo = (await buyer.getWalletUtxos()).find((candidate) => refOf(candidate) === inputRef);
  if (!utxo) throw new Error(`double-spend input is not available: ${inputRef}`);
  const address = await buyer.address();
  const conflict = await (await (await buyer.newTx().collectFrom({ inputs: [utxo] }).payToAddress({ address, assets: Assets.fromLovelace(4_800_000n) }).build()).sign()).submit();
  const conflictHash = TransactionHash.toHex(conflict).toLowerCase();
  const conflictConfirmation = await txStatus(conflictHash, 1);
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...signature }, body: JSON.stringify({ taskId: crypto.randomUUID() }) });
  const body = await response.json() as { paymentTx?: string; error?: string };
  return { status: !response.ok && /input already spent/i.test(body.error ?? "") ? "refused" : "unexpected", input: inputRef, signedPaymentTxHash: decoded.txHash, signedPaymentConfirmation: null, conflictingTxHash: conflictHash, conflictingTxConfirmation: conflictConfirmation, response: { status: response.status, error: body.error } };
}

function stats(rows: PaymentRow[]) {
  const times = rows.map((row) => row.timeTo200Ms).sort((a, b) => a - b);
  return { requests: rows.length, p50Ms: times[Math.ceil(times.length * 0.5) - 1], p95Ms: times[Math.ceil(times.length * 0.95) - 1], confirmed: rows.filter((row) => row.confirmation.confirmations >= 1).length };
}

async function main() {
  const urls = { confirmed: process.env.CONFIRMED_URL ?? "http://127.0.0.1:4191/paid", instant: process.env.INSTANT_URL ?? "http://127.0.0.1:4190/paid" };
  if (process.env.DOUBLE_SPEND_ONLY_INPUT) {
    const previous = JSON.parse(readFileSync("instant/results.json", "utf8")) as Record<string, unknown>;
    const conflict = await doubleSpend(urls.instant, process.env.DOUBLE_SPEND_ONLY_INPUT);
    writeFileSync("instant/results.json", JSON.stringify({ ...previous, doubleSpend: conflict }, null, 2));
    return;
  }
  const split = await splitBuyerUtxos();
  const unused = [...split.inputs];
  const results: Record<string, PaymentRow[]> = { confirmed: [], instant: [] };
  for (const mode of ["confirmed", "instant"] as const) {
    for (let index = 0; index < 20; index++) {
      const input = unused[0];
      const row = await payment(urls[mode], input, results[mode].length);
      results[mode].push(row);
      unused.shift();
    }
  }
  const conflict = await doubleSpend(urls.instant, unused[0]);
  writeFileSync("instant/results.json", JSON.stringify({ generatedAt: new Date().toISOString(), status: "complete", split: { txHash: split.txHash, confirmations: 2, inputs: split.inputs }, summary: { confirmed: stats(results.confirmed), instant: stats(results.instant) }, results, doubleSpend: conflict }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  writeFileSync("instant/results.json", JSON.stringify({ generatedAt: new Date().toISOString(), status: "blocked", error: message }, null, 2));
  console.error(message);
  process.exitCode = 1;
});
