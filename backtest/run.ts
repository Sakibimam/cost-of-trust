import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { escrowParty, request, tallyDelivery, type DeliveryTally } from "../coworker/src/koios.ts";
import { decideCapabilityRoute, evaluateRoutes, posteriorFailure, sellerRisk, type CapabilityPolicy, type Seller, type UnderwriterConfig, type RouteQuote } from "../router/src/routes.ts";
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

export type DecisionType = "hire_as_is" | "backup" | "coverage" | "do_not_hire" | "insufficient_data";
export type DecisionTypeResult = { decisions: number; jobsDone: number; doneRate: number };
export type PolicyResult = { jobsAttempted: number; jobsSkipped: number; jobsDone: number; jobsDoneRate: number; realizedFailures: number; realizedAdaLost: number; undoneWorkAda: number; feesPaid: number; totalCostAda: number; totalCostPer100Decisions: number; adaSavedVsP0: number; observedBackupLegs: number; modelledBackupLegs: number; decisionTypes: Record<DecisionType, DecisionTypeResult> };
export type Backtest = { generatedAt: string; sourcePolicyIds: readonly string[]; agents: number; escrows: number; eligibleDecisions: number; agentsWithSameCapabilityAlternative: number; timeWindow: { from: string; to: string }; splitAt: string; policies: Record<string, Record<string, PolicyResult>>; heldOut: Record<string, Record<string, PolicyResult>>; calibration: { alpha0: number; beta0: number; failureRate: number; betaBinomialBrier: number; disputeRateBrier: number; observations: number }; diagnosis: Record<DecisionType, DecisionTypeResult>; drivers: Array<{ agent: string; name: string; adaSaved: number; decisions: number }>; caveat: string };

const config = underwriter as UnderwriterConfig;
function seller(agent: Agent, before: readonly Outcome[], prior?: CapabilityPolicy): Seller {
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

function bestAlternative(target: Agent, agents: Agent[], beforeByAgent: Map<string, Outcome[]>, at: number): { agent: Agent; outcome?: Outcome } | undefined {
  return agents.filter((agent) => agent.id !== target.id && agent.policyId === target.policyId && (beforeByAgent.get(agent.id)?.length ?? 0) > 0)
    .sort((a, b) => {
      const historyA = beforeByAgent.get(a.id)!; const historyB = beforeByAgent.get(b.id)!;
      const failureRate = (history: Outcome[]) => history.filter((item) => item.outcome !== "paid").length / history.length;
      return failureRate(historyA) - failureRate(historyB) || historyB.length - historyA.length || a.id.localeCompare(b.id);
    })
    .map((agent) => ({ agent, outcome: agent.outcomes.find((outcome) => outcome.at > at) }))[0];
}

function alternativeJob(target: Agent, agents: Agent[], beforeByAgent: Map<string, Outcome[]>, current: Outcome, loss: number) {
  const alternative = bestAlternative(target, agents, beforeByAgent, current.at);
  if (!alternative?.outcome) return { cost: loss, fee: 0, done: false, observed: false };
  const failed = alternative.outcome.outcome !== "paid";
  return { cost: alternative.agent.priceAda + (failed ? loss : 0), fee: alternative.agent.priceAda, done: !failed, observed: true };
}

const emptyDecisionTypes = (): Record<DecisionType, DecisionTypeResult> => Object.fromEntries(["hire_as_is", "backup", "coverage", "do_not_hire", "insufficient_data"].map((type) => [type, { decisions: 0, jobsDone: 0, doneRate: 0 }])) as Record<DecisionType, DecisionTypeResult>;
function addDecisionType(types: Record<DecisionType, DecisionTypeResult>, type: DecisionType, done: boolean): void {
  const row = types[type]; row.decisions++; row.jobsDone += done ? 1 : 0; row.doneRate = row.jobsDone / row.decisions;
}
function resultFromMetrics(metrics: { jobsAttempted: number; jobsSkipped: number; jobsDone: number; realizedFailures: number; realizedAdaLost: number; undoneWorkAda: number; feesPaid: number; totalCostAda: number; observedBackupLegs: number; modelledBackupLegs: number; decisionTypes: Record<DecisionType, DecisionTypeResult> }, decisions: number): PolicyResult {
  return { ...metrics, jobsDoneRate: decisions ? metrics.jobsDone / decisions : 0, totalCostPer100Decisions: decisions ? metrics.totalCostAda / decisions * 100 : 0, adaSavedVsP0: 0 };
}

export function calibratedPrior(agents: Agent[], splitAt: number): CapabilityPolicy & { failureRate: number; observations: number } {
  const training = agents.flatMap((agent) => agent.outcomes.filter((outcome) => outcome.at < splitAt));
  const failures = training.filter((outcome) => outcome.outcome !== "paid").length;
  const failureRate = training.length ? failures / training.length : 0.2;
  const strength = 10;
  return { alpha0: Math.max(0.5, failureRate * strength), beta0: Math.max(0.5, (1 - failureRate) * strength), failureRate, observations: training.length };
}

function nextOutcome(agent: Agent, at: number): Outcome | undefined { return agent.outcomes.find((outcome) => outcome.at > at); }
export function walkForwardHistory(outcomes: readonly Outcome[], at: number): readonly Outcome[] {
  return outcomes.filter((outcome) => outcome.at < at);
}

function onePolicyNew(agents: Agent[], loss: number, prior: CapabilityPolicy, splitAt: number, heldOut: boolean): { result: PolicyResult; savedByAgent: Map<string, number> } {
  const metrics = { jobsAttempted: 0, jobsSkipped: 0, jobsDone: 0, realizedFailures: 0, realizedAdaLost: 0, undoneWorkAda: 0, feesPaid: 0, totalCostAda: 0, observedBackupLegs: 0, modelledBackupLegs: 0, decisionTypes: emptyDecisionTypes() };
  const savedByAgent = new Map<string, number>();
  for (const target of agents) for (let k = 5; k < target.outcomes.length; k++) {
    const current = target.outcomes[k];
    if (heldOut && current.at < splitAt) continue;
    const beforeByAgent = new Map(agents.map((agent) => [agent.id, walkForwardHistory(agent.outcomes, current.at)]));
    const candidates = agents.filter((agent) => agent.policyId === target.policyId).map((agent) => seller(agent, beforeByAgent.get(agent.id) ?? []));
    const choice = decideCapabilityRoute({ downstreamLossAda: loss, sellers: candidates, prior });
    const primary = agents.find((agent) => agent.id === choice.primary.id)!;
    const primaryOutcome = primary.id === target.id ? current : nextOutcome(primary, current.at);
    const primaryFailed = !primaryOutcome || primaryOutcome.outcome !== "paid";
    let done = !primaryFailed;
    let fee = primary.priceAda;
    let cost = fee + (primaryFailed ? loss : 0);
    const type: DecisionType = choice.route === "backup" ? "backup" : "hire_as_is";
    if (choice.backup && primaryFailed) {
      const backup = agents.find((agent) => agent.id === choice.backup!.id)!;
      const backupOutcome = nextOutcome(backup, current.at);
      const backupFailed = !backupOutcome || backupOutcome.outcome !== "paid";
      fee += backup.priceAda; cost = fee + (backupFailed ? loss : 0); done = !backupFailed;
      if (backupOutcome) metrics.observedBackupLegs++; else metrics.modelledBackupLegs++;
    }
    metrics.jobsAttempted++; metrics.jobsDone += done ? 1 : 0; metrics.realizedFailures += done ? 0 : 1; metrics.undoneWorkAda += done ? 0 : loss; metrics.feesPaid += fee; metrics.realizedAdaLost += cost; metrics.totalCostAda += cost; addDecisionType(metrics.decisionTypes, type, done);
    savedByAgent.set(target.id, (savedByAgent.get(target.id) ?? 0) + (target.priceAda + (current.outcome === "paid" ? 0 : loss) - cost));
  }
  const decisions = agents.reduce((sum, agent) => sum + agent.outcomes.filter((outcome, index) => index >= 5 && (!heldOut || outcome.at >= splitAt)).length, 0);
  return { result: resultFromMetrics(metrics, decisions), savedByAgent };
}

export function skippedJobCost(target: Agent, agents: Agent[], current: Outcome, loss: number): number {
  const beforeByAgent = new Map(agents.map((agent) => [agent.id, agent.outcomes.filter((outcome) => outcome.at < current.at)]));
  return alternativeJob(target, agents, beforeByAgent, current, loss).cost;
}

export function onePolicy(name: string, agents: Agent[], loss: number, splitAt?: number, heldOut = false): { result: PolicyResult; savedByAgent: Map<string, number> } {
  let jobsAttempted = 0, jobsSkipped = 0, jobsDone = 0, realizedFailures = 0, realizedAdaLost = 0, undoneWorkAda = 0, totalCostAda = 0, feesPaid = 0, observedBackupLegs = 0, modelledBackupLegs = 0;
  const savedByAgent = new Map<string, number>();
  const decisionTypes = emptyDecisionTypes();
  for (const target of agents) for (let k = 5; k < target.outcomes.length; k++) {
    const current = target.outcomes[k];
    if (splitAt !== undefined && heldOut && current.at < splitAt) continue;
    const beforeByAgent = new Map(agents.map((agent) => [agent.id, walkForwardHistory(agent.outcomes, current.at)]));
    const targetBefore = beforeByAgent.get(target.id) ?? [];
    const failed = current.outcome !== "paid";
    let cost = 0, fee = 0;
    let done = false;
    let skipped = false;
    let decisionType: DecisionType = "hire_as_is";
    if (name === "P0") { fee = target.priceAda; cost = fee + (failed ? loss : 0); done = !failed; }
    else if (name === "P1") { skipped = targetBefore.filter((outcome) => outcome.outcome === "disputed").length / targetBefore.length > 0.05; decisionType = skipped ? "do_not_hire" : "hire_as_is"; if (!skipped) { fee = target.priceAda; cost = fee + (failed ? loss : 0); done = !failed; } }
    else if (name === "P2") { skipped = targetBefore.filter((outcome) => outcome.outcome !== "paid").length / targetBefore.length > 0.2; decisionType = skipped ? "do_not_hire" : "hire_as_is"; if (!skipped) { fee = target.priceAda; cost = fee + (failed ? loss : 0); done = !failed; } }
    else {
      const route = routeFor(target, agents, beforeByAgent, loss);
      skipped = route.recommendation === "do_not_hire";
      decisionType = skipped ? "do_not_hire" : route.recommendation === "hire_as_is" ? "hire_as_is" : route.recommendation === "require_coverage" ? "coverage" : "backup";
      if (!skipped && route.quote) {
        fee = target.priceAda + route.quote.premiumAda;
        if (route.recommendation === "require_coverage") cost = fee + (failed ? Math.max(0, loss - route.quote.coverageAda) : 0);
        else if (route.recommendation === "hire_with_backup" && failed) {
          const backup = alternativeJob(target, agents, beforeByAgent, current, loss);
          fee += backup.fee; cost = fee + (backup.done ? 0 : loss); done = backup.done; if (backup.observed) observedBackupLegs++; else modelledBackupLegs++;
        } else cost = fee + (failed ? loss : 0);
        done ||= !failed;
      } else if (skipped) {
        const alternative = alternativeJob(target, agents, beforeByAgent, current, loss);
        cost = alternative.cost; fee = alternative.fee; done = alternative.done; if (alternative.observed) observedBackupLegs++; else modelledBackupLegs++;
      }
    }
    if (skipped && name !== "P3") {
      const alternative = alternativeJob(target, agents, beforeByAgent, current, loss);
      cost = alternative.cost; fee = alternative.fee; done = alternative.done;
    }
    if (skipped) jobsSkipped++; else jobsAttempted++;
    if (!done) { realizedFailures++; undoneWorkAda += loss; }
    jobsDone += done ? 1 : 0; feesPaid += fee; realizedAdaLost += cost; totalCostAda += cost;
    addDecisionType(decisionTypes, decisionType, done);
    if (name === "P3") savedByAgent.set(target.id, (savedByAgent.get(target.id) ?? 0) + (target.priceAda + (failed ? loss : 0) - cost));
  }
  const decisions = agents.reduce((sum, agent) => sum + Math.max(0, agent.outcomes.length - 5), 0);
  return { result: resultFromMetrics({ jobsAttempted, jobsSkipped, jobsDone, realizedFailures, realizedAdaLost, undoneWorkAda, feesPaid, totalCostAda, observedBackupLegs, modelledBackupLegs, decisionTypes }, decisions), savedByAgent };
}

export function decisionHistory(outcomes: readonly Outcome[], k: number): readonly Outcome[] { return outcomes.slice(0, k); }
export function decideFromHistory(history: readonly Outcome[]): "hire" | "skip" { const disputes = history.filter((outcome) => outcome.outcome === "disputed").length; return disputes / history.length <= 0.05 ? "hire" : "skip"; }

export async function main(): Promise<Backtest> {
  const get = await cachedRequest();
  const agents = await loadAgents(get);
  if (!agents.length) throw new Error("No mainnet registry agent has six resolved escrows");
  const decisions = agents.reduce((sum, agent) => sum + agent.outcomes.length - 5, 0);
  const allOutcomes = agents.flatMap((agent) => agent.outcomes);
  const from = Math.min(...allOutcomes.map((item) => item.at));
  const to = Math.max(...allOutcomes.map((item) => item.at));
  const splitAt = (from + to) / 2;
  const prior = calibratedPrior(agents, splitAt);
  const policies: Backtest["policies"] = {};
  const heldOut: Backtest["heldOut"] = {};
  for (const loss of LOSSES) {
    const base = onePolicy("P0", agents, loss).result;
    const heldBase = onePolicy("P0", agents, loss, splitAt, true).result;
    for (const name of ["P0", "P1", "P2"] as const) {
      const run = onePolicy(name, agents, loss).result;
      run.adaSavedVsP0 = base.realizedAdaLost - run.realizedAdaLost;
      (policies[name] ??= {})[String(loss)] = run;
      const heldRun = onePolicy(name, agents, loss, splitAt, true).result;
      heldRun.adaSavedVsP0 = heldBase.realizedAdaLost - heldRun.realizedAdaLost;
      (heldOut[name] ??= {})[String(loss)] = heldRun;
    }
    const newRun = onePolicyNew(agents, loss, prior, splitAt, false).result;
    newRun.adaSavedVsP0 = base.realizedAdaLost - newRun.realizedAdaLost;
    (policies["P3-new"] ??= {})[String(loss)] = newRun;
    const newHeldRun = onePolicyNew(agents, loss, prior, splitAt, true).result;
    newHeldRun.adaSavedVsP0 = heldBase.realizedAdaLost - newHeldRun.realizedAdaLost;
    (heldOut["P3-new"] ??= {})[String(loss)] = newHeldRun;
  }
  let beta = 0, dispute = 0, observations = 0;
  for (const agent of agents) for (let k = 5; k < agent.outcomes.length; k++) {
    const current = agent.outcomes[k];
    const past = decisionHistory(agent.outcomes, k);
    const historySeller = seller(agent, past);
    const predicted = posteriorFailure(historySeller, prior);
    const disputeRate = past.filter((item) => item.outcome === "disputed").length / past.length;
    const actual = current.outcome === "paid" ? 0 : 1;
    beta += (predicted - actual) ** 2; dispute += (disputeRate - actual) ** 2; observations++;
  }
  const p3Diagnosis = onePolicy("P3", agents, 100).result.decisionTypes;
  const p3ForDrivers = onePolicyNew(agents, 100, prior, splitAt, false);
  const drivers = agents.map((agent) => ({ agent: agent.id, name: agent.name, adaSaved: p3ForDrivers.savedByAgent.get(agent.id) ?? 0, decisions: agent.outcomes.length - 5 })).sort((a, b) => b.adaSaved - a.adaSaved).slice(0, 5);
  return { generatedAt: new Date().toISOString(), sourcePolicyIds: POLICY_IDS, agents: agents.length, escrows: allOutcomes.length, eligibleDecisions: decisions, agentsWithSameCapabilityAlternative: agents.filter((agent) => agents.some((other) => other.id !== agent.id && other.policyId === agent.policyId)).length, timeWindow: { from: new Date(from * 1000).toISOString(), to: new Date(to * 1000).toISOString() }, splitAt: new Date(splitAt * 1000).toISOString(), policies, heldOut, calibration: { alpha0: prior.alpha0, beta0: prior.beta0, failureRate: prior.failureRate, betaBinomialBrier: beta / observations, disputeRateBrier: dispute / observations, observations }, diagnosis: p3Diagnosis, drivers, caveat: "Mainnet Masumi escrow spends are observed from the bounded newest 1,000 transactions per payment contract. The time-window midpoint is the held-out split. The prior is calibrated only from first-half outcomes; each decision then uses outcomes strictly before that decision. P3-new never refuses: it ranks same-policy capability alternatives by posterior failure probability and adds a staggered backup only when primary posterior failure times loss exceeds the backup fee. Chosen alternatives use their next observed escrow when available; missing legs are modelled as failed and reported separately. Registry prices without a lovelace quote are 0 ADA rather than guessed. The requested agent remains the decision's sampled job, so selecting another primary is evaluated against that primary's next observed outcome." };
}

function printSummary(result: Backtest): void {
  console.log("Policy | L ADA | attempted | skipped | jobs done | done rate | undone ADA | fees ADA | total cost / 100 | P3 saved vs P0");
  for (const name of ["P0", "P1", "P2", "P3-new"] as const) for (const loss of LOSSES) { const row = result.policies[name][String(loss)]; console.log(`${name} | ${loss} | ${row.jobsAttempted} | ${row.jobsSkipped} | ${row.jobsDone} | ${(row.jobsDoneRate * 100).toFixed(1)}% | ${row.undoneWorkAda.toFixed(2)} | ${row.feesPaid.toFixed(2)} | ${row.totalCostPer100Decisions.toFixed(2)} | ${row.adaSavedVsP0.toFixed(2)}`); }
}

if (import.meta.main) {
  const result = await main();
  await mkdir(new URL("../web/src/data/", import.meta.url), { recursive: true });
  await writeFile(new URL("../web/src/data/backtest.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
  printSummary(result);
  console.log(JSON.stringify({ agents: result.agents, escrows: result.escrows, decisions: result.eligibleDecisions, timeWindow: result.timeWindow, splitAt: result.splitAt, calibration: result.calibration, diagnosis: result.diagnosis, drivers: result.drivers }, null, 2));
}
