import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { TRUST_CHECK_PAY_TO } from "../../../../../lib/x402/payto";
import { resetSettlementStateForTests, setKoiosFetchForTests, txIdFromPayment } from "../../../../../lib/x402/settlement";

const reports: string[] = [];
mock.module("../../../../../../../coworker/src/report", () => ({
  createReport: async (input: { agentIdentifier: string }) => { reports.push(input.agentIdentifier); return { recommendation: "do_not_hire", input }; },
}));
const { GET } = await import("./route");
const { POST } = await import("../route");

const TX = "4da34655df9b648f6e73f42b01496e3fd8b95928dfaf99262d3abe34665d23a9";
const OTHER_ADDRESS = "addr_test1qp3d5uypvn6x4kvcg0l6k3zr5fc9mdwq8h4ggq6j0wvr7mm2cqjnxtgqd9wgcelmxrnscpmcrryc8wkxtfvz4tcrn5qq6gknxn";
const body = { agentIdentifier: "Knight", taskValueAtRiskAda: 100, deadlineMinutes: 15 };
const reqParam = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const get = (tx: string, req: string) => GET(new Request(`https://example.test/api/x402/trust-check/result?tx=${tx}&req=${req}`));

type Out = { payment_addr: { bech32: string }; value: string };
function chain(outputs: Out[], opts: { confirmed?: boolean; ageSeconds?: number } = {}) {
  setKoiosFetchForTests((async (input: URL | RequestInfo) => {
    if (String(input).endsWith("/tx_status")) return new Response(JSON.stringify([{ num_confirmations: opts.confirmed === false ? 0 : 3 }]));
    return new Response(JSON.stringify(opts.confirmed === false ? [] : [{ tx_hash: TX, block_hash: "b", block_height: 1, tx_timestamp: Math.floor(Date.now() / 1000) - (opts.ageSeconds ?? 30), outputs }]));
  }) as unknown as typeof fetch);
}
const pays = (bech32: string, value = "1000000"): Out => ({ payment_addr: { bech32 }, value });

beforeEach(() => { reports.length = 0; });
afterEach(() => { resetSettlementStateForTests(); setKoiosFetchForTests(undefined); });

test("paid then poll returns the report, and the same payment cannot buy a different request", async () => {
  chain([pays(OTHER_ADDRESS, "3831595"), pays(TRUST_CHECK_PAY_TO)]);
  const first = await get(TX, reqParam(body));
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ recommendation: "do_not_hire", input: { agentIdentifier: "Knight" } });
  expect(first.headers.get("payment-response")).toBeTruthy();
  const again = await get(TX, reqParam(body));
  expect(again.status).toBe(200);
  expect(reports).toEqual(["Knight"]);
  const different = await get(TX, reqParam({ ...body, agentIdentifier: "dpa Research Agent" }));
  expect(different.status).toBe(409);
});

test("a transaction that pays a different address is refused", async () => {
  chain([pays(OTHER_ADDRESS, "1000000"), pays(OTHER_ADDRESS, "5000000")]);
  const response = await get(TX, reqParam(body));
  expect(response.status).toBe(402);
  expect(await response.json()).toMatchObject({ error: "payment_not_valid" });
  expect(reports).toEqual([]);
});

test("a transaction that pays the right address too little is refused", async () => {
  chain([pays(TRUST_CHECK_PAY_TO, "999999")]);
  expect((await get(TX, reqParam(body))).status).toBe(402);
  expect(reports).toEqual([]);
});

test("an old payment is expired and an unconfirmed one is pending", async () => {
  chain([pays(TRUST_CHECK_PAY_TO)], { ageSeconds: 3 * 24 * 3600 });
  expect((await get(TX, reqParam(body))).status).toBe(402);
  chain([], { confirmed: false });
  expect((await get(TX, reqParam(body))).status).toBe(202);
  expect(reports).toEqual([]);
});

test("bad tx and bad req are 400", async () => {
  expect((await get("nothex", reqParam(body))).status).toBe(400);
  expect((await get(TX, "%%%")).status).toBe(400);
  expect((await get(TX, reqParam({ agentIdentifier: "Knight" }))).status).toBe(400);
});

const transaction = Buffer.from("84a400d90102818258204da34655df9b648f6e73f42b01496e3fd8b95928dfaf99262d3abe34665d23a9050182825839001e2475585deddab7fee3f3d1ad66b73801fa3dc398061502c12d3d5e950eba73a0ff9b9876108a67cb61f416510cd9deceea8d97fc926dea1a000f42408258390062da708164cc7e486adc9a10f14ebb063e8607ee3d7cc532d444993232c2c1505a1b134f43f68a0f64d593ef4a3564950ee981f2e76c9f911a003a772b021a000291d5031a08155511a100d901028182582038d9037168fbd4eea7f96a39f22e30f3c502bc93ffd07b8c7d962363b40477425840a2c39b64b61eae451f98b9af34b4b70c05ab7dacefb3212ce3bf264e44d56a83aa967e110875983682dc521bcfbd739d93b28a3ec65f56d28704453580097e03f5f6", "hex").toString("base64");
const header = encodePaymentSignatureHeader({ x402Version: 2, payload: { transaction, nonce: `${TX}#0` } } as never);

test("a replayed paid POST gets a 409 whose poll URL is the result route for the same request, and polling it delivers", async () => {
  chain([pays(TRUST_CHECK_PAY_TO)]);
  const replay = await POST(new Request("https://example.test/api/x402/trust-check", { method: "POST", headers: { "content-type": "application/json", "payment-signature": header }, body: JSON.stringify(body) }));
  expect(replay.status).toBe(409);
  const { poll } = await replay.json() as { poll: string };
  const url = new URL(poll);
  expect(url.pathname).toBe("/api/x402/trust-check/result");
  expect(url.searchParams.get("tx")).toBe(txIdFromPayment(header));
  const delivered = await GET(new Request(poll));
  expect(delivered.status).toBe(200);
  expect(await delivered.json()).toMatchObject({ input: { agentIdentifier: "Knight", taskValueAtRiskAda: 100, deadlineMinutes: 15 } });
});
