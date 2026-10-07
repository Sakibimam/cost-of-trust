import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createReport, decide } from "../src/report.ts";
import { registryFromChain, tallyDelivery, type DeliveryTally } from "../src/koios.ts";
import type { Evidence } from "../src/types.ts";

const TRUST_CHECK = "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b101b443d8a410f64eb02369ab743ce57e0dcafc68a4c64ded88bab415e000000";
const SELLER = "99faa9dc9bab087ac3cded09a0789d7102219c519e770005c567f31c";
const V2_PREPROD = "addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g";
const fixture = async (name: string) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const empty = (): DeliveryTally => ({ escrowsOpened: 0, resultsSubmitted: 0, paid: 0, refunded: 0, disputed: 0, events: [] });

test("report rejects missing identifier and negative risk", async () => {
  await assert.rejects(() => createReport({ agentIdentifier: "", taskValueAtRiskAda: 1 }));
  await assert.rejects(() => createReport({ agentIdentifier: "x", taskValueAtRiskAda: -1 }));
});

test("registry reads a recorded Masumi unit with POST asset_info", async () => {
  const recorded = await fixture("trust-check-asset-info.json");
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body?: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: init?.body?.toString() });
    assert.equal(String(input), "https://preprod.koios.rest/api/v1/asset_info");
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify(recorded), { status: 200 });
  };
  try {
    const evidence = await registryFromChain(TRUST_CHECK);
    assert.equal(evidence.status, "ok");
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), { _asset_policy: TRUST_CHECK.slice(0, 56), _asset_name: TRUST_CHECK.slice(56) });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Real preprod txs for Trust Check: escrow lock a6e3fbda, SubmitResult 8c9db324, Withdraw 9c560b70, WithdrawRefund d3e30266.
test("delivery tally classifies recorded escrow txs for the seller", async () => {
  const txs = await fixture("escrow-txs.json");
  const tally = empty();
  tallyDelivery(txs, new Set([SELLER]), TRUST_CHECK, V2_PREPROD, tally);
  assert.deepEqual({ ...tally, events: tally.events.map((event) => `${event.action} ${event.txHash.slice(0, 8)}`) }, {
    escrowsOpened: 1, resultsSubmitted: 1, paid: 1, refunded: 1, disputed: 0,
    events: ["escrowOpened a6e3fbda", "resultsSubmitted 8c9db324", "paid 9c560b70", "refunded d3e30266"],
  });
});

test("delivery tally ignores escrows of another seller and agent", async () => {
  const txs = await fixture("escrow-txs.json");
  const tally = empty();
  tallyDelivery(txs, new Set(["00".repeat(28)]), "other-agent", V2_PREPROD, tally);
  assert.deepEqual(tally, empty());
});

const delivery = (paid: number, refunded: number): Evidence => ({ source: "masumi_delivery_history", status: "ok", observedAt: "", data: { paid, refunded, disputed: 0 } });
const health = (status: Evidence["status"], error?: string): Evidence => ({ source: "agent_health", status, observedAt: "", error });

test("decision prices the agent's own escrow outcomes", () => {
  assert.equal(decide([delivery(0, 0)], 100).recommendation, "insufficient_data");
  const input = { agentIdentifier: "registry-agent", riskAversion: 0.25, sharedInfrastructure: false } as const;
  assert.equal(decide([delivery(1, 4), health("ok")], 5, input).recommendation, "hire_as_is");
  assert.equal(decide([delivery(1, 4), health("ok")], 500, input).recommendation, "hire_with_backup_keeper");
  assert.notEqual(decide([delivery(1, 4), health("ok")], 5, input).expectedCostAda, decide([delivery(1, 4), health("ok")], 500, input).expectedCostAda);
  const independent = decide([delivery(1, 4), health("ok")], 500, input);
  const shared = decide([delivery(1, 4), health("ok")], 500, { ...input, sharedInfrastructure: true });
  assert.ok((shared.options.staggered?.riskAdjustedCostAda ?? 0) > (independent.options.staggered?.riskAdjustedCostAda ?? 0));
  assert.equal(decide([delivery(20, 0), health("ok")], 100, input).recommendation, "hire_with_backup_keeper");
  assert.equal(decide([delivery(1, 12), health("ok")], 100).recommendation, "do_not_hire");
  assert.equal(decide([delivery(20, 0), health("unavailable", "HTTP 502")], 100).recommendation, "do_not_hire");
});

test("report flags a loopback api_base_url from chain metadata as unreachable", async () => {
  const assetInfo = await fixture("trust-check-asset-info.json");
  const escrowTxs = await fixture("escrow-txs.json");
  const originalFetch = globalThis.fetch;
  const original = { registry: process.env.REGISTRY_API_KEY, openrouter: process.env.OPENROUTER_API_KEY, zai: process.env.ZAI_API_KEY, openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY };
  Object.assign(process.env, { REGISTRY_API_KEY: "", OPENROUTER_API_KEY: "", ZAI_API_KEY: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" });
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.host}${url.pathname}`);
    if (url.pathname.endsWith("/asset_info")) return Response.json(assetInfo);
    if (url.pathname.endsWith("/asset_addresses")) return Response.json([{ payment_address: "addr_test1qzvl42wunw4ss7krehksngrcn4csygvu2x08wqq9c4nlx89r4ezxcccwdrpjvpuhl92l38y2payde7pzr8zkkh27sltsgfum6n", quantity: "1" }]);
    if (url.pathname.endsWith("/tx_info")) return Response.json(JSON.parse(String(init?.body))._scripts ? escrowTxs : [{ block_height: 1 }]);
    if (url.pathname.endsWith("/address_txs")) return Response.json(JSON.parse(String(init?.body))._addresses[0] === V2_PREPROD ? escrowTxs.map((tx: { tx_hash: string }) => ({ tx_hash: tx.tx_hash })) : []);
    throw new Error(`unexpected report URL ${url}`);
  };
  try {
    const report = await createReport({ agentIdentifier: TRUST_CHECK, taskValueAtRiskAda: 100, network: "Preprod" });
    const healthFact = report.facts.find((fact) => fact.source === "agent_health");
    assert.match(healthFact?.error ?? "", /private API URL \(http:\/\/127\.0\.0\.1:8788\)/);
    assert.ok(!calls.some((call) => call.includes("127.0.0.1")));
    assert.equal(report.recommendation, "do_not_hire");
    assert.equal(report.expectedCostAda, report.options.staggered?.expectedTotalCostAda);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(original)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("MIP-003 agent with /availability up and no /health route is not vetoed", () => {
  const availability: Evidence = { source: "agent_availability", status: "ok", observedAt: "", data: { status: "available" } };
  const noHealth: Evidence = { source: "agent_health", status: "unavailable", observedAt: "", error: "HTTP 404" };
  const down: Evidence = { source: "agent_availability", status: "unavailable", observedAt: "", error: "HTTP 502" };
  assert.notEqual(decide([delivery(28, 0), availability, noHealth], 100).recommendation, "do_not_hire");
  assert.equal(decide([delivery(28, 0), down, noHealth], 100).recommendation, "do_not_hire");
});
