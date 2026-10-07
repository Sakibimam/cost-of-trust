import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { escrowParty, request, tallyDelivery, type DeliveryTally } from "../coworker/src/koios.ts";
import { evaluateRoutes, sellerRisk, type Seller, type UnderwriterConfig, type RouteQuote } from "../router/src/routes.ts";
import underwriter from "../router/underwriter.json" with { type: "json" };

export const POLICY_IDS = [
  "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9",
  "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b",
] as const;
const CONTRACTS = [
  "addr1wxs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgge2j6d",
  "addr1wx7j4kmg2cs7yf92uat3ed4a3u97kr7axxr4avaz0lhwdsq87ujx7",
];
const PAGE = 1000;
const CONTRACT_SCAN_CAP = 1000;
const CONTRACT_PAGE = 250;
const CHUNK = 50;
const LOSSES = [5, 25, 100, 500] as const;

export type Outcome = { txHash: string; at: number; outcome: "paid" | "refunded" | "disputed"; policyId: string; unit: string };
export type Agent = { id: string; policyId: string; unit: string; name: string; priceAda: number; provider: string; outcomes: Outcome[]; firstAt: number; lastAt: number };
type Row = Record<string, unknown>;
type Tx = { tx_hash: string; tx_timestamp: number; inputs?: Row[]; outputs?: Row[]; plutus_contracts?: Row[] };
type CachedRequest = (path: string, init?: RequestInit) => Promise<unknown>;

const cacheDir = new URL("./cache/", import.meta.url);
const cacheKey = (path: string, init: RequestInit) => createHash("sha256").update(JSON.stringify([path, init.method ?? "GET", init.body ?? ""])).digest("hex");
async function cachedRequest(): Promise<CachedRequest> {
  await mkdir(cacheDir, { recursive: true });
  return async (path, init = {}) => {
    const file = new URL(`${cacheKey(path, init)}.json`, cacheDir);
    try { return JSON.parse(await readFile(file, "utf8")); } catch { /* cache miss */ }
    const data = await request(path, init, "Mainnet");
    await writeFile(file, JSON.stringify(data));
    return data;
  };
}

function recordValue(data: unknown, key: string): unknown {
  if (!data || typeof data !== "object") return undefined;
  if (Array.isArray(data)) for (const value of data) { const found = recordValue(value, key); if (found !== undefined) return found; }
  else { const record = data as Row; if (key in record) return record[key]; for (const value of Object.values(record)) { const found = recordValue(value, key); if (found !== undefined) return found; } }
  return undefined;
}
function paymentCredential(address: string): string | null {
  const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const separator = address.lastIndexOf("1");
  if (separator < 1) return null;
  const values = address.slice(separator + 1, -6).toLowerCase().split("").map((char) => alphabet.indexOf(char));
  if (values.some((value) => value < 0)) return null;
  let acc = 0; let bits = 0; const bytes: number[] = [];
  for (const value of values) { acc = (acc << 5) | value; bits += 5; while (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } }
  return bytes.length >= 29 ? Buffer.from(bytes.slice(1, 29)).toString("hex") : null;
}
function priceAda(data: unknown): number {
  const pricing = recordValue(data, "agentPricing");
  const entries = pricing && typeof pricing === "object" && !Array.isArray(pricing) && Array.isArray((pricing as Row).fixedPricing)
    ? (pricing as Row).fixedPricing as unknown[] : Array.isArray(pricing) ? pricing : pricing ? [pricing] : [];
  const entry = entries.find((value) => value && typeof value === "object" && String((value as Row).unit ?? (value as Row).currency ?? "").toLowerCase() === "lovelace") as Row | undefined;
  const amount = Number(entry?.amount ?? entry?.quantity ?? entry?.price ?? 0);
  return Number.isFinite(amount) ? amount / 1_000_000 : 0;
}
function nameOf(data: unknown, fallback: string): string { const name = recordValue(data, "name"); return typeof name === "string" && name ? name : Array.isArray(name) && typeof name[0] === "string" ? name[0] : fallback; }
function providerOf(data: unknown): string { const url = recordValue(data, "api_base_url"); const value = Array.isArray(url) ? url.join("") : url; return typeof value === "string" ? new URL(value).host : "unknown"; }

async function policyAssets(get: CachedRequest, policyId: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await get(`/policy_asset_list?_asset_policy=${policyId}&limit=${PAGE}&offset=${offset}`) as Row[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}
async function contractTransactions(get: CachedRequest, afterBlock: number): Promise<Tx[]> {
  const rows: Row[] = [];
  for (const contract of CONTRACTS) {
    for (let offset = 0; rows.length < CONTRACT_SCAN_CAP * CONTRACTS.length; offset += CONTRACT_PAGE) {
      const page = await get(`/address_txs?offset=${offset}&limit=${CONTRACT_PAGE}`, { method: "POST", body: JSON.stringify({ _addresses: [contract], _after_block_height: afterBlock }) }) as Row[];
      rows.push(...page);
      if (page.length < CONTRACT_PAGE || offset + page.length >= CONTRACT_SCAN_CAP) break;
    }
  }
  const unique = [...new Map(rows.map((row) => [String(row.tx_hash), row])).values()];
  const txs: Tx[] = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const hashes = unique.slice(i, i + CHUNK).map((row) => String(row.tx_hash));
    const page = await get("/tx_info", { method: "POST", body: JSON.stringify({ _tx_hashes: hashes, _inputs: true, _metadata: false, _assets: false, _withdrawals: false, _certs: false, _scripts: true, _bytecode: false }) }) as Tx[];
    txs.push(...page);
    process.stdout.write(`tx_info ${Math.min(i + CHUNK, unique.length)}/${unique.length}\r`);
  }
  process.stdout.write("\n");
  return txs;
}

async function loadAgents(get: CachedRequest): Promise<Agent[]> {
  const assets = (await Promise.all(POLICY_IDS.map((policyId) => policyAssets(get, policyId)))).flatMap((rows, index) => rows.map((row) => ({ row, policyId: POLICY_IDS[index] })));
  const metadata = await Promise.all(assets.map(async ({ row, policyId }) => {
    const name = String(row.asset_name ?? "");
    const unit = policyId + name;
    const [info] = await get("/asset_info", { method: "POST", body: JSON.stringify({ _asset_policy: policyId, _asset_name: name }) }) as Row[];
    const holders = await get(`/asset_addresses?_asset_policy=${policyId}&_asset_name=${name}`) as Row[];
    const sellers = new Set(holders.map((holder) => paymentCredential(String(holder.payment_address ?? ""))).filter((value): value is string => Boolean(value)));
    return { policyId, unit, name: nameOf(info, unit), priceAda: priceAda(info), provider: providerOf(info), sellers };
  }));
  const mintBlocks = await Promise.all(metadata.map(async (agent) => {
    const [info] = await get("/asset_info", { method: "POST", body: JSON.stringify({ _asset_policy: agent.policyId, _asset_name: agent.unit.slice(56) }) }) as Row[];
    const [mint] = await get("/tx_info", { method: "POST", body: JSON.stringify({ _tx_hashes: [info?.minting_tx_hash], _inputs: false, _metadata: false, _assets: false, _withdrawals: false, _certs: false, _scripts: false, _bytecode: false }) }) as Row[];
    return Number(mint?.block_height ?? 0);
  }));
  console.log(`registry assets ${metadata.length}, earliest mint block ${Math.min(...mintBlocks)}`);
  const txs = await contractTransactions(get, Math.min(...mintBlocks.filter(Boolean)) || 0);
  const agents: Agent[] = [];
  for (const [index, meta] of metadata.entries()) {
    const tally: DeliveryTally = { escrowsOpened: 0, resultsSubmitted: 0, paid: 0, refunded: 0, disputed: 0, events: [] };
    for (const contract of CONTRACTS) tallyDelivery(txs.filter((tx) => tx.tx_timestamp >= 0), meta.sellers, meta.unit, contract, tally);
    const outcomes = tally.events.filter((event): event is typeof event & { action: Outcome["outcome"] } => event.action === "paid" || event.action === "refunded" || event.action === "disputed")
      .map((event) => ({ txHash: event.txHash, at: event.blockTime, outcome: event.action, policyId: meta.policyId, unit: meta.unit })).sort((a, b) => a.at - b.at || a.txHash.localeCompare(b.txHash));
    if (outcomes.length >= 6) agents.push({ id: meta.unit, policyId: meta.policyId, unit: meta.unit, name: meta.name, priceAda: meta.priceAda, provider: meta.provider, outcomes, firstAt: outcomes[0].at, lastAt: outcomes.at(-1)!.at });
    process.stdout.write(`agent ${index + 1}/${metadata.length}: ${outcomes.length} resolved\n`);
  }
  return agents;
}

export type PolicyResult = { jobsAttempted: number; jobsSkipped: number; realizedFailures: number; realizedAdaLost: number; feesPaid: number; totalCostPer100Decisions: number; adaSavedVsP0: number; modelledBackupLegs: number };
export type Backtest = { generatedAt: string; sourcePolicyIds: readonly string[]; agents: number; escrows: number; eligibleDecisions: number; timeWindow: { from: string; to: string }; policies: Record<string, Record<string, PolicyResult>>; calibration: { betaBinomialBrier: number; disputeRateBrier: number; observations: number }; drivers: Array<{ agent: string; name: string; adaSaved: number; decisions: number }>; caveat: string };

const config = underwriter as UnderwriterConfig;
function seller(agent: Agent, before: readonly Outcome[]): Seller {
  const successes = before.filter((outcome) => outcome.outcome === "paid").length;
  const failures = before.length - successes;
  return { id: agent.id, name: agent.name, priceAda: agent.priceAda, provider: agent.provider, payTo: "mainnet-registry-agent", endpoint: "", successes, failures, evidence: [], type: "agent" };
}
function routeFor(target: Agent, all: Agent[], beforeByAgent: Map<string, Outcome[]>, loss: number): { recommendation: "do_not_hire" | "hire_as_is" | "hire_with_backup" | "require_coverage"; quote?: RouteQuote; pLoss: number; backupModelled: boolean } {
  const targetSeller = seller(target, beforeByAgent.get(target.id) ?? []);
  const candidates = all.map((agent) => seller(agent, beforeByAgent.get(agent.id) ?? []));
  const result = evaluateRoutes({ downstreamLossAda: loss, candidateSellers: candidates, constraints: { allowRedundancy: true }, underwriter: config, riskAversion: 0.25 });
  const quote = result.routes.find((item) => item.route === result.selectedRoute && item.sellers.join(",") === result.selectedSellers.join(","));
  const targetIsPrimary = quote?.sellers[0] === target.id;
  if (!quote || !targetIsPrimary) return { recommendation: "do_not_hire", pLoss: sellerRisk(targetSeller, config).pLoss, backupModelled: false };
  const recommendation = quote.route === "single" ? "hire_as_is" : quote.route === "underwritten" ? "require_coverage" : "hire_with_backup";
  return { recommendation, quote, pLoss: sellerRisk(targetSeller, config).pLoss, backupModelled: quote.route === "redundant" || quote.route === "staggered" };
}
function onePolicy(name: string, agents: Agent[], loss: number): { result: PolicyResult; savedByAgent: Map<string, number> } {
  let jobsAttempted = 0, jobsSkipped = 0, realizedFailures = 0, realizedAdaLost = 0, feesPaid = 0, modelledBackupLegs = 0;
  const savedByAgent = new Map<string, number>();
  for (const target of agents) for (let k = 5; k < target.outcomes.length; k++) {
    const current = target.outcomes[k];
    const beforeByAgent = new Map(agents.map((agent) => [agent.id, agent.outcomes.filter((outcome) => outcome.at < current.at)]));
    const targetBefore = beforeByAgent.get(target.id) ?? [];
    const failed = current.outcome !== "paid";
    let cost = 0;
    let skipped = false;
    if (name === "P0") cost = target.priceAda + (failed ? loss : 0);
    else if (name === "P1") { skipped = targetBefore.filter((outcome) => outcome.outcome === "disputed").length / targetBefore.length > 0.05; if (!skipped) cost = target.priceAda + (failed ? loss : 0); }
    else if (name === "P2") { skipped = targetBefore.filter((outcome) => outcome.outcome !== "paid").length / targetBefore.length > 0.2; if (!skipped) cost = target.priceAda + (failed ? loss : 0); }
    else {
      const route = routeFor(target, agents, beforeByAgent, loss);
      skipped = route.recommendation === "do_not_hire";
      if (!skipped && route.quote) {
        feesPaid += route.quote.servicePriceAda + route.quote.premiumAda;
        if (route.recommendation === "require_coverage") cost = route.quote.servicePriceAda + route.quote.premiumAda + (failed ? Math.max(0, loss - route.quote.coverageAda) : 0);
        else if (route.recommendation === "hire_with_backup") {
          const backup = agents.find((agent) => agent.id === route.quote!.sellers[1]);
          const backupRisk = backup ? sellerRisk(seller(backup, beforeByAgent.get(backup.id) ?? []), config).pLoss : 1;
          cost = route.quote.servicePriceAda + (failed ? backupRisk * loss : 0);
          modelledBackupLegs++;
        } else cost = route.quote.servicePriceAda + (failed ? loss : 0);
      }
    }
    if (skipped) jobsSkipped++; else { jobsAttempted++; if (failed) realizedFailures++; if (name !== "P3") feesPaid += target.priceAda; realizedAdaLost += cost; }
    if (name === "P3") savedByAgent.set(target.id, (savedByAgent.get(target.id) ?? 0) + (target.priceAda + (failed ? loss : 0) - cost));
  }
  const decisions = agents.reduce((sum, agent) => sum + Math.max(0, agent.outcomes.length - 5), 0);
  return { result: { jobsAttempted, jobsSkipped, realizedFailures, realizedAdaLost, feesPaid, totalCostPer100Decisions: decisions ? realizedAdaLost / decisions * 100 : 0, adaSavedVsP0: 0, modelledBackupLegs }, savedByAgent };
}

export function decisionHistory(outcomes: readonly Outcome[], k: number): readonly Outcome[] { return outcomes.slice(0, k); }
export function decideFromHistory(history: readonly Outcome[]): "hire" | "skip" { const disputes = history.filter((outcome) => outcome.outcome === "disputed").length; return disputes / history.length <= 0.05 ? "hire" : "skip"; }

export async function main(): Promise<Backtest> {
  const get = await cachedRequest();
  const agents = await loadAgents(get);
  if (!agents.length) throw new Error("No mainnet registry agent has six resolved escrows");
  const decisions = agents.reduce((sum, agent) => sum + agent.outcomes.length - 5, 0);
  const policies: Backtest["policies"] = {};
  for (const loss of LOSSES) {
    const base = onePolicy("P0", agents, loss);
    for (const name of ["P0", "P1", "P2", "P3"] as const) {
      const run = onePolicy(name, agents, loss).result;
      if (name === "P0") run.adaSavedVsP0 = 0;
      else run.adaSavedVsP0 = base.result.realizedAdaLost - run.realizedAdaLost;
      (policies[name] ??= {})[String(loss)] = run;
    }
  }
  let beta = 0, dispute = 0, observations = 0;
  for (const agent of agents) for (let k = 5; k < agent.outcomes.length; k++) {
    const past = decisionHistory(agent.outcomes, k); const predicted = (2 + past.filter((item) => item.outcome !== "paid").length) / (10 + past.length); const disputeRate = past.filter((item) => item.outcome === "disputed").length / past.length; const actual = agent.outcomes[k].outcome === "paid" ? 0 : 1;
    beta += (predicted - actual) ** 2; dispute += (disputeRate - actual) ** 2; observations++;
  }
  const p3ForDrivers = onePolicy("P3", agents, 100);
  const drivers = agents.map((agent) => ({ agent: agent.id, name: agent.name, adaSaved: p3ForDrivers.savedByAgent.get(agent.id) ?? 0, decisions: agent.outcomes.length - 5 })).sort((a, b) => b.adaSaved - a.adaSaved).slice(0, 5);
  const all = agents.flatMap((agent) => agent.outcomes);
  return { generatedAt: new Date().toISOString(), sourcePolicyIds: POLICY_IDS, agents: agents.length, escrows: all.length, eligibleDecisions: decisions, timeWindow: { from: new Date(Math.min(...all.map((item) => item.at)) * 1000).toISOString(), to: new Date(Math.max(...all.map((item) => item.at)) * 1000).toISOString() }, policies, calibration: { betaBinomialBrier: beta / observations, disputeRateBrier: dispute / observations, observations }, drivers, caveat: "Primary outcomes are observed from mainnet Masumi escrow spends in the newest 1,000 transactions per payment contract. P3 backup legs are modelled from qualifying agents' pre-decision beta-binomial risk, not observed backup executions. Registry prices without a lovelace quote are reported as 0 ADA rather than converted by guesswork. Route fees and coverage are router quotes. V1 shared-wallet attribution remains wallet-based when the datum has no agent unit." };
}

function printSummary(result: Backtest): void {
  console.log("Policy | L ADA | attempted | skipped | failures | lost ADA | fees ADA | cost / 100 decisions | P3 saved vs P0");
  for (const name of ["P0", "P1", "P2", "P3"] as const) for (const loss of LOSSES) { const row = result.policies[name][String(loss)]; console.log(`${name} | ${loss} | ${row.jobsAttempted} | ${row.jobsSkipped} | ${row.realizedFailures} | ${row.realizedAdaLost.toFixed(2)} | ${row.feesPaid.toFixed(2)} | ${row.totalCostPer100Decisions.toFixed(2)} | ${row.adaSavedVsP0.toFixed(2)}`); }
}

if (import.meta.main) {
  const result = await main();
  await mkdir(new URL("../web/src/data/", import.meta.url), { recursive: true });
  await writeFile(new URL("../web/src/data/backtest.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
  printSummary(result);
  console.log(JSON.stringify({ agents: result.agents, escrows: result.escrows, decisions: result.eligibleDecisions, timeWindow: result.timeWindow, calibration: result.calibration, drivers: result.drivers }, null, 2));
}
