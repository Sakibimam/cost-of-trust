import { afterEach, expect, test } from "bun:test";
import { startServer } from "../../router/src/server.ts";
import { pay, quote, validateSellerPayment, type Task } from "../src/index.ts";
import { encodePaymentRequiredHeader } from "@x402/core/http";

let router: ReturnType<typeof startServer> | undefined;
let seller: ReturnType<typeof Bun.serve> | undefined;
const task: Task = { task: "claim before expiry", serviceType: "cardano_deadline_execution", deadline: "2030-01-01T00:00:00Z", downstreamLossAda: 100, candidateSellers: ["seller-a"] };
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
    const required = { x402Version: 2, resource: { url: request.url }, accepts: [{ scheme: "exact", network: "cardano:preprod", amount: "1000", asset: "lovelace", payTo: "addr_test1qqe0seqy6tvff79kw3md5qdspevu59344rcna6fjsut5npeg2wdkgff976cth4upph2h0g9394tl6n0arnwqs307dyaq5lhh68", maxTimeoutSeconds: 600, extra: { costOfTrust: { riskQuoteEndpoint: `${base()}/quotes/seller-a` } } }] };
    return Response.json(required, { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required as any) } });
  } });
  const result = await pay(task, { routerUrl: base(), sellerUrls: { "seller-a": `http://localhost:${seller.port}` }, signer, maxAmountPerPayment: 1_000_000n, maxTaskSpend: 2_000_000n, allowedAssets: ["lovelace"] });
  expect(result.route.selectedSellers.length).toBeGreaterThan(0);
  expect(result.payments).toHaveLength(result.route.selectedSellers.length);
  expect(result.payments.every((payment) => payment.status === 200)).toBe(true);
});

test("spend policy rejects quote, asset, and payout violations", () => {
  const seller = { id: "seller-a", priceAda: 8, payTo: "router-pay-to" };
  const options = { maxAmountPerPayment: 8_000_000n, maxTaskSpend: 8_000_000n, allowedAssets: ["lovelace"] };
  expect(() => validateSellerPayment({ amount: "9000000", asset: "lovelace", payTo: seller.payTo }, seller, options)).toThrow("router quote");
  expect(() => validateSellerPayment({ amount: "1000", asset: "usdc", payTo: seller.payTo }, seller, options)).toThrow("not allowed");
  expect(() => validateSellerPayment({ amount: "1000", asset: "lovelace", payTo: "attacker" }, seller, options)).toThrow("payTo mismatch");
});
