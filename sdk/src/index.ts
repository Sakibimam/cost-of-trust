import { ExactCardanoScheme } from "@x402/cardano/exact/client";
import type { ClientCardanoSigner } from "@x402/cardano";
import { x402Client, x402HTTPClient } from "@x402/core/client";

export type Task = {
  task: string; serviceType: string; deadline: string; downstreamLossAda: number;
  candidateSellers: string[]; riskAversion?: number; sharedInfrastructure?: boolean;
  constraints?: Record<string, unknown>;
};
export type PayOptions = {
  routerUrl: string;
  sellerUrls: Record<string, string>;
  signer: ClientCardanoSigner;
  maxAmountPerPayment: bigint;
  maxTaskSpend: bigint;
  allowedAssets: string[];
  fetch?: typeof fetch;
};

type SellerRecord = { id: string; priceAda: number; payTo: string };

export function validateSellerPayment(requirement: { amount: string; asset: string; payTo: string }, seller: SellerRecord, options: Pick<PayOptions, "maxAmountPerPayment" | "maxTaskSpend" | "allowedAssets">, spent = 0n): bigint {
  if (!options.allowedAssets.includes(requirement.asset)) throw new Error(`asset ${requirement.asset} is not allowed`);
  const amount = BigInt(requirement.amount);
  const quoted = BigInt(Math.round(seller.priceAda * 1_000_000));
  if (requirement.payTo !== seller.payTo) throw new Error(`payTo mismatch for ${seller.id}`);
  if (amount > quoted) throw new Error(`payment exceeds router quote for ${seller.id}`);
  if (amount > options.maxAmountPerPayment) throw new Error("payment exceeds maxAmountPerPayment");
  if (spent + amount > options.maxTaskSpend) throw new Error("task spend exceeds maxTaskSpend");
  return amount;
}

export async function quote(task: Task, routerUrl = "http://localhost:8787") {
  const response = await fetch(`${routerUrl}/best-route`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(task) });
  if (!response.ok) throw new Error(`router returned ${response.status}`);
  return response.json();
}

export async function pay(task: Task, options: PayOptions) {
  const fetcher = options.fetch ?? fetch;
  const route = await quote(task, options.routerUrl);
  const sellersResponse = await fetcher(`${options.routerUrl.replace(/\/$/, "")}/sellers`);
  if (!sellersResponse.ok) throw new Error(`seller discovery returned ${sellersResponse.status}`);
  const sellers = await sellersResponse.json() as SellerRecord[];
  const records = new Map(sellers.map((seller) => [seller.id, seller]));
  const payments: Array<{ seller: string; status: number; settlement?: unknown }> = [];
  let spent = 0n;
  for (const seller of route.selectedSellers as string[]) {
    const record = records.get(seller);
    if (!record) throw new Error(`router seller record missing ${seller}`);
    const url = options.sellerUrls[seller];
    if (!url) throw new Error(`sellerUrls missing selected seller ${seller}`);
    const unpaid = await fetcher(url);
    if (unpaid.status !== 402) throw new Error(`${seller} returned ${unpaid.status}, expected 402`);
    const body = await unpaid.clone().json().catch(() => undefined);
    const paymentRequired = new x402HTTPClient(new x402Client()).getPaymentRequiredResponse((name) => unpaid.headers.get(name), body);
    const accepted = paymentRequired.accepts[0];
    if (!accepted) throw new Error(`${seller} returned no payment options`);
    const amount = validateSellerPayment(accepted, record, options, spent);
    spent += amount;
    const client = new x402Client().setSpendControls({ maxAmountPerPayment: amount.toString(), allowedAssets: [{ network: "cardano:preprod", asset: accepted.asset, maxAmountPerPayment: amount.toString() }] }).register("cardano:preprod", new ExactCardanoScheme(options.signer));
    const http = new x402HTTPClient(client);
    const payload = await http.createPaymentPayload(paymentRequired);
    const paid = await fetcher(url, { headers: http.encodePaymentSignatureHeader(payload) });
    const result = await http.processPaymentResult(payload, (name) => paid.headers.get(name), paid.status);
    if (!paid.ok) throw new Error(`${seller} payment failed with ${paid.status}`);
    payments.push({ seller, status: paid.status, settlement: result.settleResponse });
  }
  return { route, reason: route.reason, payments };
}

export type { ClientCardanoSigner };
