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
  expect(body.selectedRoute).toBe("underwritten-single");
  expect(body.selectedSellers).toEqual(["seller-b"]);
  const under = body.routes.find((r: any) => r.route === "underwritten-single" && r.sellers[0] === "seller-b");
  expect(under.premiumAda).toBeCloseTo(8.6, 2);
  expect(under.expectedTotalCostAda).toBeCloseTo(20.6, 2);
  expect(body.termsHash).toMatch(/^[0-9a-f]{64}$/);
  const hash = Buffer.from(blake2b(new TextEncoder().encode(canonicalJson({ route: "underwritten-single", sellers: ["seller-b"], servicePriceAda: 10, premiumAda: under.premiumAda, coverageAda: 80 })), { dkLen: 32 })).toString("hex");
  expect(body.termsHash).toBe(hash);

  const quote = await (await fetch(`${base()}/quotes/${body.quoteId}`)).json();
  expect(quote.result.selectedRoute).toBe("underwritten-single");
  const sellerQuote = await (await fetch(`${base()}/quotes/seller-b`)).json();
  expect(sellerQuote.coverageOffers[0].premiumAda).toBeCloseTo(8.6, 2);
  expect(sellerQuote.coverageOffers[0].termsHash).toMatch(/^[0-9a-f]{64}$/);
  expect((await fetch(`${base()}/quotes/nope`)).status).toBe(404);

  const sellers = await (await fetch(`${base()}/sellers`)).json();
  expect(sellers).toHaveLength(3);
  expect(sellers[1].risk.pLoss).toBeCloseTo(0.1, 4);
  expect((await (await fetch(`${base()}/health`)).json()).ok).toBe(true);
  const preflight = await fetch(`${base()}/best-route`, { method: "OPTIONS" });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
});

test("requireCoverage and maxServiceSpendAda over HTTP; unknown seller 400", async () => {
  server = startServer(0);
  const covered = await (await post({ ...req, constraints: { allowRedundancy: true, requireCoverage: true } })).json();
  expect(covered.selectedRoute).toBe("underwritten-single");
  const capped = await (await post({ ...req, constraints: { allowRedundancy: true, maxServiceSpendAda: 9 } })).json();
  expect(capped.selectedSellers).not.toContain("seller-b");
  expect((await post({ ...req, candidateSellers: ["seller-x"] })).status).toBe(400);
  expect((await post({ ...req, candidateSellers: ["seller-b"], constraints: { maxServiceSpendAda: 5 } })).status).toBe(400);
});

test("ingestOutcome persists evidence and moves the posterior", async () => {
  server = startServer(0);
  const before = (await (await fetch(`${base()}/sellers`)).json())[0].risk.pLoss;
  const tx = "ab".repeat(32);
  const updated = await ingestOutcome("seller-a", false, tx);
  expect(updated.failures).toBe(1);
  const disk = JSON.parse(readFileSync(sellersPath, "utf8"));
  expect(disk[0].failures).toBe(1);
  expect(disk[0].evidence).toEqual([tx]);
  const after = (await (await fetch(`${base()}/sellers`)).json())[0];
  expect(after.risk.pLoss).toBeGreaterThan(before);
  expect(after.evidence).toEqual([tx]);
  await expect(ingestOutcome("seller-a", true, "")).rejects.toThrow("txHash is required");
  await expect(ingestOutcome("ghost", true, tx)).rejects.toThrow("seller not found");
});

test("termsHash is key-order independent blake2b-256", () => {
  expect(termsHash({ a: 1, b: 2 })).toBe(termsHash({ b: 2, a: 1 }));
  expect(termsHash({ a: 1 })).not.toBe(termsHash({ a: 2 }));
});
