import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blake2b } from "@noble/hashes/blake2.js";
import { canonicalJson, ingestOutcome, startServer, termsHash, useSellersFile } from "../src/server.ts";

let server: ReturnType<typeof startServer> | undefined;
let sellersPath = "";
beforeEach(async () => {
  sellersPath = join(mkdtempSync(join(tmpdir(), "cot-")), "sellers.json");
  copyFileSync(new URL("../sellers.json", import.meta.url).pathname, sellersPath);
  await useSellersFile(sellersPath);
});
afterEach(() => { server?.stop(true); server = undefined; });

const base = () => `http://localhost:${server!.port}`;
const post = (body: unknown) => fetch(`${base()}/best-route`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const req = { task: "claim before expiry", serviceType: "cardano_deadline_execution", deadline: "2030-01-01T00:00:00Z", downstreamLossAda: 100, candidateSellers: ["seller-a", "seller-b", "seller-c"], constraints: { allowRedundancy: true } };

test("POST /best-route then GET /quotes/:id, /sellers, /health, CORS", async () => {
  server = startServer(0);
  const response = await post(req);
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  const body = await response.json();
  expect(body.selectedRoute).toBe("staggered");
  expect(body.selectedSellers).toEqual(["seller-a", "seller-b"]);
  expect(body.riskAversion ?? body.assumptions.riskAversion.value).toBe(0);
  const under = body.routes.find((r: any) => r.route === "underwritten" && r.sellers[0] === "seller-b");
  expect(under.premiumAda).toBeCloseTo(10.2, 2);
  expect(under.expectedTotalCostAda).toBeCloseTo(22.2, 2);
  expect(under.sdLossAda).toBeCloseTo(6, 2);
  expect(under.riskAdjustedCostAda).toBeCloseTo(22.2, 2);
  expect(body.termsHash).toMatch(/^[0-9a-f]{64}$/);
  const hash = Buffer.from(blake2b(new TextEncoder().encode(canonicalJson({ route: "staggered", sellers: ["seller-a", "seller-b"], servicePriceAda: body.routes.find((r: any) => r.route === "staggered").servicePriceAda, premiumAda: 0, coverageAda: 0 })), { dkLen: 32 })).toString("hex");
  expect(body.termsHash).toBe(hash);

  const quote = await (await fetch(`${base()}/quotes/${body.quoteId}`)).json();
  expect(quote.result.selectedRoute).toBe("staggered");
  const sellerQuote = await (await fetch(`${base()}/quotes/seller-b`)).json();
  expect(sellerQuote.coverageOffers[0].premiumAda).toBeCloseTo(10.2, 2);
  expect(sellerQuote.coverageOffers[0].termsHash).toMatch(/^[0-9a-f]{64}$/);
  expect((await fetch(`${base()}/quotes/nope`)).status).toBe(404);

  const sellers = await (await fetch(`${base()}/sellers`)).json();
  expect(sellers).toHaveLength(6);
  expect(sellers[1].risk.pLoss).toBeCloseTo(0.1, 4);
  expect((await (await fetch(`${base()}/health`)).json()).ok).toBe(true);
  const preflight = await fetch(`${base()}/best-route`, { method: "OPTIONS" });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
});

test("requireCoverage and maxServiceSpendAda over HTTP; unknown seller 400", async () => {
  server = startServer(0);
  const shared = await (await post({ ...req, riskAversion: 0.25, sharedInfrastructure: true })).json();
  expect(shared.selectedRoute).toBe("underwritten");
  expect(shared.selectedSellers).toEqual(["seller-b"]);
  expect(shared.assumptions.sharedInfrastructure.value).toBe(true);
  const averse = await (await post({ ...req, riskAversion: 0.25, constraints: { allowRedundancy: false } })).json();
  expect(averse.selectedRoute).toBe("underwritten");
  expect(averse.routes.find((r: any) => r.route === "underwritten" && r.sellers[0] === "seller-b").riskAdjustedCostAda).toBeCloseTo(23.7, 2);
  expect(averse.reason).toContain("coverage caps the 30.00 ADA loss sd of seller-b");
  const covered = await (await post({ ...req, constraints: { allowRedundancy: true, requireCoverage: true } })).json();
  expect(covered.selectedRoute).toBe("underwritten");
  const capped = await (await post({ ...req, constraints: { allowRedundancy: true, maxServiceSpendAda: 9 } })).json();
  expect(capped.alternatives.every((r: any) => r.servicePriceAda <= 9)).toBe(true);
  expect(capped.routes.some((r: any) => r.servicePriceAda > 9)).toBe(true);
  expect((await post({ ...req, candidateSellers: ["seller-x"] })).status).toBe(400);
  expect((await post({ ...req, candidateSellers: ["seller-b"], constraints: { maxServiceSpendAda: 5 } })).status).toBe(400);
});

test.serial("ingestOutcome persists evidence and moves the posterior", async () => {
  server = startServer(0);
  const initial = (await (await fetch(`${base()}/sellers`)).json())[0];
  const before = initial.risk.pLoss;
  const tx = "ab".repeat(32);
  const updated = await ingestOutcome("seller-a", false, tx);
  expect(updated.failures).toBe(initial.failures + 1);
  const disk = JSON.parse(readFileSync(sellersPath, "utf8"));
  expect(disk[0].failures).toBe(1);
  expect(disk[0].evidence).toEqual([...initial.evidence, tx]);
  const after = (await (await fetch(`${base()}/sellers`)).json())[0];
  expect(after.risk.pLoss).toBeGreaterThan(before);
  expect(after.evidence).toEqual([...initial.evidence, tx]);
  await expect(ingestOutcome("seller-a", true, "")).rejects.toThrow("txHash is required");
  await expect(ingestOutcome("ghost", true, tx)).rejects.toThrow("seller not found");
});

test("termsHash is key-order independent blake2b-256", () => {
  expect(termsHash({ a: 1, b: 2 })).toBe(termsHash({ b: 2, a: 1 }));
  expect(termsHash({ a: 1 })).not.toBe(termsHash({ a: 2 }));
});

test.serial("ingest authenticates, binds claim evidence to the seller, and dedupes", async () => {
  server = startServer(0);
  const previousFetch = globalThis.fetch;
  const tx = "cd".repeat(32);
  const seller = (await (await fetch(`${base()}/sellers`)).json())[0];
  const sellerPayTo = seller.payTo;
  process.env.INGEST_TOKEN = "ingest-test-token";
  process.env.KAIOS_KEY = "koios-test-key";
  let txInfoCalls = 0;
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/tx_status")) return new Response(JSON.stringify([{ num_confirmations: 1 }]));
    if (path.endsWith("/tx_info")) {
      const unrelated = txInfoCalls++ === 0;
      return new Response(JSON.stringify([{ inputs: unrelated ? [{ address: "addr_test1 unrelated", redeemer: { constructor: 0 } }] : [{ address: "addr_test1wpvyupyu5rclc55v8j342y295mc8f6wdc434ansa7j64vwc2mvcle", redeemer: { constructor: 0 } }], outputs: [{ address: sellerPayTo, value: { lovelace: 1_000_000 } }] }]));
    }
    return previousFetch(input, init);
  }) as typeof fetch;
  try {
    expect((await fetch(`${base()}/ingest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sellerId: "seller-a", success: true, txHash: tx }) })).status).toBe(401);
    const unrelated = await fetch(`${base()}/ingest`, { method: "POST", headers: { authorization: "Bearer ingest-test-token", "content-type": "application/json" }, body: JSON.stringify({ sellerId: "seller-a", success: true, txHash: "ef".repeat(32) }) });
    expect(unrelated.status).toBe(400);
    const rejected = await fetch(`${base()}/ingest`, { method: "POST", headers: { authorization: "Bearer ingest-test-token", "content-type": "application/json" }, body: JSON.stringify({ sellerId: "seller-a", success: true, txHash: tx }) });
    expect(rejected.status).toBe(200);
    const duplicate = await fetch(`${base()}/ingest`, { method: "POST", headers: { authorization: "Bearer ingest-test-token", "content-type": "application/json" }, body: JSON.stringify({ sellerId: "seller-a", success: true, txHash: tx }) });
    expect((await duplicate.json()).successes).toBe(seller.successes + 1);
  } finally {
    globalThis.fetch = previousFetch;
    delete process.env.INGEST_TOKEN;
    delete process.env.KAIOS_KEY;
  }
});

test("measured provider histories drive provider selection", async () => {
  server = startServer(0);
  const probe = JSON.parse(readFileSync(new URL("../probes/results-20261006051159.json", import.meta.url), "utf8"));
  const measured = new Map<string, { successes: number; failures: number }>();
  for (const record of probe.records) {
    if (!measured.has(record.provider)) measured.set(record.provider, { successes: 0, failures: 0 });
    const history = measured.get(record.provider)!;
    record.ok ? history.successes++ : history.failures++;
  }
  const response = await post({ ...req, candidateSellers: ["provider-koios-authenticated", "provider-tatum-preprod"] });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.selectedSellers.length).toBeGreaterThan(0);
  expect(body.reason).toContain("risk-adjusted cost");
  const sellers = await (await fetch(`${base()}/sellers`)).json();
  for (const seller of sellers.filter((item: any) => item.type === "provider")) {
    const history = measured.get(seller.id === "provider-koios-authenticated" ? "koios-preprod-authenticated" : seller.id === "provider-koios-public" ? "koios-preprod-public" : "tatum-cardano-preprod");
    expect(seller.successes).toBe(history?.successes);
    expect(seller.failures).toBe(history?.failures);
  }
});

test("exactly two counterparties produce a decision with a reason", async () => {
  server = startServer(0);
  const response = await post({ ...req, candidateSellers: ["provider-koios-authenticated", "provider-tatum-preprod"] });
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.selectedSellers.length).toBeGreaterThan(0);
  expect(body.reason.length).toBeGreaterThan(20);
});
