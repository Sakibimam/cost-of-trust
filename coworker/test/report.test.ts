import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createReport } from "../src/report.ts";
import { escrowHistory, registryFromChain } from "../src/koios.ts";

test("report rejects missing identifier and negative risk", async () => {
  await assert.rejects(() => createReport({ agentIdentifier: "", taskValueAtRiskAda: 1 }));
  await assert.rejects(() => createReport({ agentIdentifier: "x", taskValueAtRiskAda: -1 }));
});

test("registry reads a recorded Masumi unit with POST asset_info", async () => {
  const recorded = JSON.parse(await readFile(new URL("./fixtures/trust-check-asset-info.json", import.meta.url), "utf8"));
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body?: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: init?.body?.toString() });
    assert.equal(String(input), "https://preprod.koios.rest/api/v1/asset_info");
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify(recorded), { status: 200 });
  };
  try {
    const evidence = await registryFromChain("67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b101b443d8a410f64eb02369ab743ce57e0dcafc68a4c64ded88bab415e000000");
    assert.equal(evidence.status, "ok");
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), {
      _asset_policy: "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b",
      _asset_name: "101b443d8a410f64eb02369ab743ce57e0dcafc68a4c64ded88bab415e000000",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("escrow history resolves the unit before POST asset_txs", async () => {
  const recorded = JSON.parse(await readFile(new URL("./fixtures/trust-check-asset-txs.json", import.meta.url), "utf8"));
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, method: init?.method ?? "GET" });
    if (url.pathname.endsWith("/address_txs")) return new Response("[]", { status: 200 });
    if (url.pathname.endsWith("/asset_txs")) return new Response(JSON.stringify(recorded), { status: 200 });
    throw new Error(`unexpected fixture URL ${url.pathname}`);
  };
  try {
    const evidence = await escrowHistory("67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b101b443d8a410f64eb02369ab743ce57e0dcafc68a4c64ded88bab415e000000");
    assert.equal(evidence.status, "ok");
    assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), ["POST /api/v1/address_txs", "POST /api/v1/asset_txs"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("report turns the recorded router route into a recommendation", async () => {
  const assetInfo = JSON.parse(await readFile(new URL("./fixtures/trust-check-asset-info.json", import.meta.url), "utf8"));
  const assetTxs = JSON.parse(await readFile(new URL("./fixtures/trust-check-asset-txs.json", import.meta.url), "utf8"));
  const routerResult = JSON.parse(await readFile(new URL("./fixtures/router-best-route.json", import.meta.url), "utf8"));
  const originalFetch = globalThis.fetch;
  const original = { router: process.env.ROUTER_URL, registry: process.env.REGISTRY_API_KEY, openrouter: process.env.OPENROUTER_API_KEY, zai: process.env.ZAI_API_KEY, openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY };
  Object.assign(process.env, { ROUTER_URL: "http://router.test/api/router", REGISTRY_API_KEY: "", OPENROUTER_API_KEY: "", ZAI_API_KEY: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" });
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname.endsWith("/asset_info")) return Response.json(assetInfo);
    if (url.pathname.endsWith("/asset_txs")) return Response.json(assetTxs);
    if (url.pathname.endsWith("/address_txs")) return Response.json([]);
    if (url.pathname.endsWith("/availability") || url.pathname.endsWith("/health")) return Response.json({ ok: true });
    if (url.pathname.endsWith("/sellers")) return Response.json([{ id: "seller-a" }, { id: "seller-b" }]);
    if (url.pathname.endsWith("/best-route")) return Response.json(routerResult);
    throw new Error(`unexpected report URL ${url}`);
  };
  try {
    const report = await createReport({ agentIdentifier: "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b101b443d8a410f64eb02369ab743ce57e0dcafc68a4c64ded88bab415e000000", taskValueAtRiskAda: 100 });
    assert.equal(report.recommendation, "require_coverage");
    assert.equal(report.expectedCostAda, 29.6);
    assert.ok(calls.includes("POST /api/router/best-route"));
    assert.ok(!calls.includes("GET /api/router/quotes/"));
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(original)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
