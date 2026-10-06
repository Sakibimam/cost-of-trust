import { afterEach, expect, test } from "bun:test";
import { startServer } from "../../router/src/server.ts";
import { pay, quote, type Task } from "../src/index.ts";
import { encodePaymentRequiredHeader } from "@x402/core/http";

let router: ReturnType<typeof startServer> | undefined;
let seller: ReturnType<typeof Bun.serve> | undefined;
const task: Task = { task: "claim before expiry", serviceType: "cardano_deadline_execution", deadline: "2030-01-01T00:00:00Z", downstreamLossAda: 100, candidateSellers: ["provider-koios-authenticated", "provider-tatum-preprod"] };
const signer = {
  getAddress: () => "addr_test1vpq7f9f0x3j4v7w4n3u2t6s8r5q4p3o2n1m0l9k8j7h6g5f4e3d2c1b0a9",
  buildAndSignPaymentTransaction: () => ({ transaction: "AA==", nonce: `${"ab".repeat(32)}#0` }),
};

afterEach(() => { router?.stop(true); seller?.stop(true); router = undefined; seller = undefined; });

function base() { return `http://localhost:${router!.port}`; }

test("quote uses the real local router", async () => {
  router = startServer(0);
  const result = await quote(task, base());
  expect(result.selectedSellers.length).toBeGreaterThan(0);
  expect(result.reason).toContain("risk-adjusted cost");
});

test("pay consumes a real local 402 and retries with x402 payment", async () => {
  router = startServer(0);
  seller = Bun.serve({ port: 0, fetch: (request) => {
    if (request.headers.has("PAYMENT-SIGNATURE")) return Response.json({ ok: true }, { status: 200 });
    const required = { x402Version: 2, resource: { url: request.url }, accepts: [{ scheme: "exact", network: "cardano:preprod", amount: "1000", asset: "lovelace", payTo: "addr_test1vqg7f9f0x3j4v7w4n3u2t6s8r5q4p3o2n1m0l9k8j7h6f5e4d3c2b1a0", maxTimeoutSeconds: 600, extra: { costOfTrust: { riskQuoteEndpoint: `${base()}/quotes/provider-koios-authenticated` } } }] };
    return Response.json(required, { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required as any) } });
  } });
  const result = await pay(task, { routerUrl: "http://127.0.0.1:9", sellerUrls: { "provider-koios-authenticated": `http://localhost:${seller.port}`, "provider-tatum-preprod": `http://localhost:${seller.port}` }, signer });
  expect(result.route.selectedSellers.length).toBeGreaterThan(0);
  expect(result.payments).toHaveLength(result.route.selectedSellers.length);
  expect(result.payments.every((payment) => payment.status === 200)).toBe(true);
});
