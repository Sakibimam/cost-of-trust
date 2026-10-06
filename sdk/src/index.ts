import { ExactCardanoScheme } from "@x402/cardano/exact/client";
import type { ClientCardanoSigner } from "@x402/cardano";
import { x402Client, x402HTTPClient } from "@x402/core/client";

export type Task = {
  task: string; serviceType: string; deadline: string; downstreamLossAda: number;
  candidateSellers: string[]; riskAversion?: number; sharedInfrastructure?: boolean;
  constraints?: Record<string, unknown>;
};
export type PayOptions = { routerUrl: string; sellerUrls: Record<string, string>; signer: ClientCardanoSigner; fetch?: typeof fetch };

export async function quote(task: Task, routerUrl = "http://localhost:8787") {
  const response = await fetch(`${routerUrl}/best-route`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(task) });
  if (!response.ok) throw new Error(`router returned ${response.status}`);
  return response.json();
}

export async function pay(task: Task, options: PayOptions) {
  const fetcher = options.fetch ?? fetch;
  const firstUrl = options.sellerUrls[task.candidateSellers[0]];
  if (!firstUrl) throw new Error("sellerUrls must include the first candidate seller");
  const initial = await fetcher(firstUrl);
  if (initial.status !== 402) throw new Error(`seller returned ${initial.status}, expected 402`);
  const initialBody = await initial.clone().json().catch(() => undefined);
  const initialHttp = new x402HTTPClient(new x402Client());
  const required = initialHttp.getPaymentRequiredResponse((name) => initial.headers.get(name), initialBody);
  const extra = required.accepts[0]?.extra as { costOfTrust?: { riskQuoteEndpoint?: string } } | undefined;
  const endpoint = extra?.costOfTrust?.riskQuoteEndpoint;
  const route = await quote(task, endpoint ? new URL(endpoint).origin : options.routerUrl);
  const payments: Array<{ seller: string; status: number; settlement?: unknown }> = [];
  for (const seller of route.selectedSellers as string[]) {
    const url = options.sellerUrls[seller];
    if (!url) throw new Error(`sellerUrls missing selected seller ${seller}`);
    const unpaid = await fetcher(url);
    if (unpaid.status !== 402) throw new Error(`${seller} returned ${unpaid.status}, expected 402`);
    const body = await unpaid.clone().json().catch(() => undefined);
    const client = new x402Client().setSpendControls(false).register("cardano:preprod", new ExactCardanoScheme(options.signer));
    const http = new x402HTTPClient(client);
    const paymentRequired = http.getPaymentRequiredResponse((name) => unpaid.headers.get(name), body);
    const payload = await http.createPaymentPayload(paymentRequired);
    const paid = await fetcher(url, { headers: http.encodePaymentSignatureHeader(payload) });
    const result = await http.processPaymentResult(payload, (name) => paid.headers.get(name), paid.status);
    if (!paid.ok) throw new Error(`${seller} payment failed with ${paid.status}`);
    payments.push({ seller, status: paid.status, settlement: result.settleResponse });
  }
  return { route, reason: route.reason, payments };
}

export type { ClientCardanoSigner };
