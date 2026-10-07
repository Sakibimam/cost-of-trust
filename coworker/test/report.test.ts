import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createReport, decide, getJson, isUnsafeUrl, renderReportMarkdown } from "../src/report.ts";
import { finishTally, registryFromChain, submitResultTimeSeconds, tallyDelivery, type DeliveryTally } from "../src/koios.ts";
import type { Evidence, TrustReport } from "../src/types.ts";
import backtest from "../../web/src/data/backtest.json" with { type: "json" };


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
  const { submissions: _submissions, ceilingByOpenTx = {}, ...counted } = tally;
  assert.deepEqual({ ...counted, events: tally.events.map((event) => `${event.action} ${event.txHash.slice(0, 8)}`) }, {
    escrowsOpened: 1, resultsSubmitted: 1, paid: 1, refunded: 1, disputed: 0,
    events: ["escrowOpened a6e3fbda", "resultsSubmitted 8c9db324", "paid 9c560b70", "refunded d3e30266"],
  });
  const opened = tally.events.find((event) => event.action === "escrowOpened");
  assert.ok(opened);
  assert.ok((ceilingByOpenTx[opened.txHash] ?? 0) > opened.blockTime);
  assert.equal(Object.keys(ceilingByOpenTx).length, 3);
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
  assert.equal(decide([delivery(1, 4), health("ok")], 5, input).recommendation, "do_not_hire");
  assert.equal(decide([delivery(1, 4), health("ok")], 500, input).recommendation, "do_not_hire");
  assert.notEqual(decide([delivery(1, 4), health("ok")], 5, input).expectedCostAda, decide([delivery(1, 4), health("ok")], 500, input).expectedCostAda);
  const independent = decide([delivery(1, 4), health("ok")], 500, input);
  const shared = decide([delivery(1, 4), health("ok")], 500, { ...input, sharedInfrastructure: true });
  assert.ok((shared.options.staggered?.riskAdjustedCostAda ?? 0) > (independent.options.staggered?.riskAdjustedCostAda ?? 0));
  const clean = decide([delivery(20, 0), health("ok")], 100, input);
  assert.equal(clean.recommendation, "hire_as_is");
  assert.equal(clean.selectedRoute, "single");
  assert.equal(clean.expectedCostAda, clean.options.single?.expectedTotalCostAda);
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

test("SSRF gate rejects private, metadata, IPv6 ULA, link-local, and mapped addresses", async () => {
  const resolve = (async () => [{ address: "127.0.0.1", family: 4 }]) as unknown as typeof import("node:dns/promises").lookup;
  for (const url of ["http://169.254.169.254", "http://[::1]", "http://[fc00::1]", "http://[fe80::1]", "http://[::ffff:7f00:1]", "http://metadata.google.internal", "http://agent.example"]) {
    assert.equal(await isUnsafeUrl(url, resolve), true, url);
  }
  assert.equal(await isUnsafeUrl("https://agent.example", (async () => [{ address: "93.184.216.34", family: 4 }]) as unknown as typeof import("node:dns/promises").lookup), false);
});

test("registry endpoint requests refuse redirects", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let redirect: RequestRedirect | undefined;
  globalThis.fetch = async (_input, init) => { calls += 1; redirect = init?.redirect; return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:3012" } }); };
  try {
    const evidence = await getJson("agent_health", "https://agent.example/health", undefined, (async () => [{ address: "93.184.216.34", family: 4 }]) as unknown as typeof import("node:dns/promises").lookup);
    assert.equal(evidence.status, "unavailable");
    assert.match(evidence.error ?? "", /redirect refused/);
    assert.equal(calls, 1);
    assert.equal(redirect, "manual");
  } finally { globalThis.fetch = originalFetch; }
});

test("MIP-003 agent with /availability up and no /health route is not vetoed", () => {
  const availability: Evidence = { source: "agent_availability", status: "ok", observedAt: "", data: { status: "available" } };
  const noHealth: Evidence = { source: "agent_health", status: "unavailable", observedAt: "", error: "HTTP 404" };
  const down: Evidence = { source: "agent_availability", status: "unavailable", observedAt: "", error: "HTTP 502" };
  assert.notEqual(decide([delivery(28, 0), availability, noHealth], 100).recommendation, "do_not_hire");
  assert.equal(decide([delivery(28, 0), down, noHealth], 100).recommendation, "do_not_hire");
});

test("V1 escrows on a shared selling wallet are attributed per agent with response times", () => {
  const POLICY = "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9";
  const unitA = POLICY + "a".repeat(64), unitB = POLICY + "b".repeat(64);
  const contract = "addr1escrow", seller = "f0".repeat(28), buyer = "e5".repeat(28);
  const cred = (bytes: string) => ({ constructor: 0, fields: [{ constructor: 0, fields: [{ bytes }] }] });
  const datum = (unit: string, deadline: number) => ({ constructor: 0, fields: [cred(buyer), cred(seller), { bytes: "" }, { bytes: "" }, { bytes: "1".repeat(64) + unit }, { bytes: "" }, { int: 1 }, { bytes: "" }, { bytes: "" }, { int: 0 }, { int: deadline }, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }, { constructor: 0, fields: [] }] });
  const submit = (hash: string, unit: string, deadlineMs: number, atSec: number) => ({
    tx_hash: hash, tx_timestamp: atSec,
    inputs: [{ tx_hash: "in" + hash, tx_index: 0, payment_addr: { bech32: contract }, inline_datum: { value: datum(unit, deadlineMs) } }],
    plutus_contracts: [{ valid_contract: true, spends_input: { tx_hash: "in" + hash, tx_index: 0 }, input: { redeemer: { datum: { value: { constructor: 5 } } } } }],
  });
  const tally: DeliveryTally = { escrowsOpened: 0, resultsSubmitted: 0, paid: 0, refunded: 0, disputed: 0, events: [] };
  tallyDelivery([submit("t1", unitA, 2_000_000, 1_000), submit("t2", unitA, 2_000_000, 3_000), submit("t3", unitB, 2_000_000, 1_000)] as never, new Set([seller]), unitA, contract, tally);
  assert.equal(tally.resultsSubmitted, 2);
  assert.deepEqual(tally.responseSeconds, undefined);
});

test("a slow response is not a refund, and a tight caller deadline buys a backup", () => {
  const history = { paid: 10, refunded: 0, disputed: 0, responseSeconds: [60, 120] };
  const facts = [{ source: "masumi_delivery_history", status: "ok" as const, observedAt: "", data: history }];
  const noTimes = [{ source: "masumi_delivery_history", status: "ok" as const, observedAt: "", data: { paid: 10, refunded: 0, disputed: 0 } }];
  const oneMinute = decide(facts, 100, { agentIdentifier: "registry-agent", deadlineMinutes: 1 });
  const thirtyMinutes = decide(facts, 100, { agentIdentifier: "registry-agent", deadlineMinutes: 30 });
  const sameHistory = decide(noTimes, 100, { agentIdentifier: "registry-agent", deadlineMinutes: 1 });
  assert.equal(oneMinute.options.single?.riskAdjustedCostAda, thirtyMinutes.options.single?.riskAdjustedCostAda);
  assert.equal(oneMinute.options.single?.riskAdjustedCostAda, sameHistory.options.single?.riskAdjustedCostAda);
  assert.equal(oneMinute.recommendation, "hire_with_backup_keeper");
  assert.equal(oneMinute.selectedRoute, "staggered");
  assert.equal(oneMinute.expectedCostAda, oneMinute.options.staggered?.expectedTotalCostAda);
  assert.equal(oneMinute.deadlineStats?.buyerDeadline, "tighter");
  assert.equal(oneMinute.deadlineStats?.responseMean, 90);
  assert.equal(oneMinute.deadlineStats?.responseVariance, 900);
  assert.equal(thirtyMinutes.recommendation, "hire_as_is");
  assert.equal(thirtyMinutes.selectedRoute, "single");
  assert.equal(thirtyMinutes.deadlineStats?.buyerDeadline, "inside");
});

test("endpoint down stays do not hire and the timing spread is still reported", () => {
  const facts = [
    { source: "masumi_delivery_history", status: "ok" as const, observedAt: "", data: { paid: 10, refunded: 0, disputed: 0, responseSeconds: [60, 120] } },
    { source: "agent_availability", status: "unavailable" as const, observedAt: "", error: "HTTP 502" },
  ];
  const report = decide(facts, 100, { agentIdentifier: "registry-agent", deadlineMinutes: 1 });
  assert.equal(report.recommendation, "do_not_hire");
  assert.equal(report.deadlineStats?.responseCount, 2);
  assert.equal(report.deadlineStats?.responseMean, 90);
  assert.equal(report.deadlineStats?.buyerDeadline, "tighter");
  assert.equal(report.deadlineStats?.buyerDeadlineSeconds, 60);
  assert.equal(report.deadlineStats?.ceilingCount, 0);
});

test("the sokosumi result leads with hire, backup, or do not hire", () => {
  const facts = [{ source: "masumi_delivery_history", status: "ok" as const, observedAt: "", data: { paid: 10, refunded: 0, disputed: 0, responseSeconds: [60, 120], buyers: ["a", "b"] } }];
  const decision = decide(facts, 100, { agentIdentifier: "registry-agent", deadlineMinutes: 1 });
  const report: TrustReport = {
    input: { agentIdentifier: "registry-agent", taskValueAtRiskAda: 100, deadlineMinutes: 1 },
    ...decision,
    facts,
    summary: "",
    generatedAt: "2026-10-07T00:00:00.000Z",
  };
  const markdown = renderReportMarkdown(report);
  assert.match(markdown, /^Hire this agent, and pay a backup/);
  assert.equal(/buyer deadline/i.test(markdown), false);
  assert.equal(/\d+ buyers/.test(markdown), false);
  assert.match(markdown, /10 paid, 0 refunded, 0 disputed/);
  assert.match(markdown, new RegExp(backtest.calibration.betaBinomialBrier.toFixed(3)));
  assert.match(markdown, new RegExp(backtest.calibration.disputeRateBrier.toFixed(3)));
  assert.ok(markdown.includes(String(backtest.policies.P2["100"].jobsDone)));
  assert.ok(markdown.includes(String(backtest.policies.P0["100"].jobsDone)));
  assert.ok(markdown.includes(String(backtest.calibration.observations)));
});

test("V1 submit_result_time at field 10 is the seller ceiling", () => {
  const openAt = 1_700_000_000;
  const unit = "a".repeat(56) + "b".repeat(64);
  const seller = "f0".repeat(28);
  const buyer = "e5".repeat(28);
  const contract = "addr1escrow";
  const cred = (bytes: string) => ({ constructor: 0, fields: [{ constructor: 0, fields: [{ bytes }] }] });
  const fields = [cred(buyer), cred(seller), { bytes: "" }, { bytes: "" }, { bytes: "1".repeat(64) + unit }, { bytes: "" }, { int: 1 }, { bytes: "" }, { bytes: "" }, { int: 0 }, { int: openAt + 900 }, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }, { constructor: 0, fields: [] }];
  const datum = { constructor: 0, fields };
  assert.equal(fields.length, 16);
  assert.equal(submitResultTimeSeconds(datum), openAt + 900);
  const tally = empty();
  tallyDelivery([{ tx_hash: "open1", tx_timestamp: openAt, outputs: [{ payment_addr: { bech32: contract }, inline_datum: { value: datum } }] }] as never, new Set([seller]), unit, contract, tally);
  finishTally(tally);
  assert.deepEqual(tally.ceilingSeconds, [900]);
  const v2 = { constructor: 0, fields: Array.from({ length: 19 }, (_, index) => index === 13 ? { int: openAt + 900 } : { int: 0 }) };
  assert.equal(submitResultTimeSeconds(v2), openAt + 900);
  v2.fields[10] = { int: 1 };
  assert.equal(submitResultTimeSeconds(v2), openAt + 900);
});

test("recorded Knight V1 refund responses remain attributed to Knight", async () => {
  const recorded = await fixture("knight-refund-txs.json");
  const unit = "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9f72c4fd88720ace11d813fd94dc27c74034d951f8b27dbc7b871e6a048cbf495";
  const seller = "bd2adb685621e224aae7571cb6bd8f0beb0fdd31875eb3a27feee6c0";
  const datum = { constructor: 0, fields: [{}, { fields: [{ fields: [{ bytes: seller }] }] }, {}, {}, { bytes: "0".repeat(64) + unit }, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, { constructor: 0 }] } as never;
  const txs = recorded.map((tx: { tx_hash: string; tx_timestamp: number }) => ({ ...tx, inputs: [{ tx_hash: `open-${tx.tx_hash}`, tx_index: 0, payment_addr: { bech32: "addr1wx7j4kmg2cs7yf92uat3ed4a3u97kr7axxr4avaz0lhwdsq87ujx7" }, inline_datum: { value: datum } }], plutus_contracts: [{ valid_contract: true, spends_input: { tx_hash: `open-${tx.tx_hash}`, tx_index: 0 }, input: { redeemer: { datum: { value: { constructor: 3 } } } } }] }));
  const tally = empty();
  tallyDelivery(txs as never, new Set([seller]), unit, "addr1wx7j4kmg2cs7yf92uat3ed4a3u97kr7axxr4avaz0lhwdsq87ujx7", tally);
  assert.equal(tally.refunded, 15);
  assert.equal(tally.paid, 0);
  assert.equal(decide([{ source: "masumi_delivery_history", status: "ok", observedAt: "", data: tally }], 500, { agentIdentifier: unit }).recommendation, "do_not_hire");
});
