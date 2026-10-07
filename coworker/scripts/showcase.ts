import { mkdir, writeFile } from "node:fs/promises";
import { env, loadEnv } from "../src/config.ts";
import { advertisedUrl, decide } from "../src/report.ts";
import { deliveryHistory, registryFromChain, request } from "../src/koios.ts";

loadEnv();

const POLICY = "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9";
// Live-endpoint agents found by probing /availability on every mainnet registry entry (2026-10-07), plus two counter-examples.
const PRIORITY_UNITS = [
  "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9b19d50033247fad1afcda379eee47cf924482e30c031d2375f311a9df037093a",
  "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9130aef218189f42447e06c1571eb6a039ea387a3c020490d34d5514b68c55fbe",
  "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b90400955cf54fddbcf102f572621b97268ab645f8f99d56f0780e98d2187865ab",
  "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9d2124fefec901e6aaaff021ff6e863323465612de6a51c81c73e7163e7825ab8",
  "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b93f7f01cd91782da0e6feb49f389afbbd36c1c2508b508971ee4a34e4fe404495",
  "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9f6991d762e2f6e7e35447d74e570791adfc7f70ce8159232199f941e3579cad3",
  "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9f72c4fd88720ace11d813fd94dc27c74034d951f8b27dbc7b871e6a048cbf495",
  "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9d2fd9dd94a1d5360ce830fb38c912b3aa46898cd2da74e36bc75713156fc0e51",
];
const scenarios = [5, 100, 500].flatMap((taskValueAtRiskAda) => [false, true].map((sharedInfrastructure) => ({ taskValueAtRiskAda, sharedInfrastructure, riskAversion: 0.25 })));
const observedAt = () => new Date().toISOString();

async function endpointFact(source: string, url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const data = response.ok ? await response.json().catch(() => undefined) : undefined;
    return { source, status: response.ok ? "ok" as const : "unavailable" as const, observedAt: observedAt(), data, error: response.ok ? undefined : `HTTP ${response.status}` };
  } catch (error) { return { source, status: "unavailable" as const, observedAt: observedAt(), error: error instanceof Error ? error.message : "request failed" }; }
}

function findValue(data: unknown, key: string): unknown {
  if (!data || typeof data !== "object") return undefined;
  if (Array.isArray(data)) for (const value of data) { const found = findValue(value, key); if (found !== undefined) return found; }
  else {
    const record = data as Record<string, unknown>;
    if (key in record) return record[key];
    for (const value of Object.values(record)) { const found = findValue(value, key); if (found !== undefined) return found; }
  }
  return undefined;
}

function agentName(data: unknown, fallback: string): string {
  const value = findValue(data, "name");
  return typeof value === "string" && value ? value : Array.isArray(value) && typeof value[0] === "string" ? value[0] : fallback;
}

async function main(): Promise<void> {
  const rows = await request(`/policy_asset_list?_asset_policy=${POLICY}&limit=1000&offset=0`, {}, "Mainnet") as Array<Record<string, unknown>>;
  const liveUnits = new Set(rows.filter((row) => Number(row.total_supply ?? 0) > 0).map((row) => `${POLICY}${String(row.asset_name ?? "")}`));
  const candidates = PRIORITY_UNITS.filter((unit) => liveUnits.has(unit));
  const agents: Array<{ identifier: string; registry: Awaited<ReturnType<typeof registryFromChain>>; delivery: Awaited<ReturnType<typeof deliveryHistory>> }> = [];
  for (let i = 0; i < candidates.length && agents.length < 8; i += 4) {
    const metadata = await Promise.all(candidates.slice(i, i + 4).map(async (identifier) => ({ identifier, registry: await registryFromChain(identifier, "Mainnet") })));
    const advertised = metadata.filter((candidate) => candidate.registry.status === "ok" && advertisedUrl(candidate.registry.data));
    const batch = await Promise.all(advertised.map(async (candidate) => ({ ...candidate, delivery: await deliveryHistory(candidate.identifier, "Mainnet") })));
    for (const candidate of batch) {
      const data = candidate.delivery.data as { paid?: number; refunded?: number; disputed?: number } | undefined;
      if (candidate.delivery.status === "ok" && (data?.paid ?? 0) + (data?.refunded ?? 0) + (data?.disputed ?? 0) > 0) agents.push(candidate);
      if (agents.length >= 8) break;
    }
  }
  if (agents.length < 2) throw new Error(`found only ${agents.length} mainnet registry agents with non-empty delivery history`);

  const output = [];
  for (const agent of agents) {
    const delivery = agent.delivery.data as { paid: number; refunded: number; disputed: number };
    const registryData = agent.registry.data;
    const endpoint = advertisedUrl(registryData);
    const facts = [agent.registry, ...(endpoint ? await Promise.all([endpointFact("agent_availability", `${endpoint}/availability`), endpointFact("agent_health", `${endpoint}/health`)]) : [{ source: "agent_health", status: "unavailable" as const, observedAt: observedAt(), error: "registry did not advertise an API URL" }]), agent.delivery];
    const scenariosOutput = [];
    for (const scenario of scenarios) {
      const report = decide(facts, scenario.taskValueAtRiskAda, { agentIdentifier: agent.identifier, riskAversion: scenario.riskAversion, sharedInfrastructure: scenario.sharedInfrastructure });
      scenariosOutput.push({ ...scenario, options: report.options, recommendation: report.recommendation, expectedCostAda: report.expectedCostAda, pricingNote: report.pricingNote });
    }
    output.push({ agentName: agentName(registryData, agent.identifier), identifier: agent.identifier, apiHost: advertisedUrl(registryData) ? new URL(advertisedUrl(registryData)!).host : null, delivery: { paid: delivery.paid, onTime: (agent.delivery.data as { onTime?: number } | undefined)?.onTime ?? 0, late: (agent.delivery.data as { late?: number } | undefined)?.late ?? 0, responseSecondsMedian: (agent.delivery.data as { responseSecondsMedian?: number | null } | undefined)?.responseSecondsMedian ?? null, distinctBuyers: (agent.delivery.data as { buyers?: string[] } | undefined)?.buyers?.length ?? 0, sellingWallet: (agent.delivery.data as { sellerCredentials?: string[] } | undefined)?.sellerCredentials?.[0] ?? null, walletOnlyOutcomes: (agent.delivery.data as { walletOnly?: number } | undefined)?.walletOnly ?? 0, refunded: delivery.refunded, disputed: delivery.disputed, disputeRate: delivery.disputed / Math.max(delivery.paid + delivery.refunded + delivery.disputed, 1) }, scenarios: scenariosOutput });
  }
  await mkdir(new URL("../../web/src/data/", import.meta.url), { recursive: true });
  await writeFile(new URL("../../web/src/data/showcase.json", import.meta.url), `${JSON.stringify({ generatedAt: new Date().toISOString(), network: "Mainnet", registryPolicy: POLICY, agents: output }, null, 2)}\n`);
  console.table(output.flatMap((agent) => agent.scenarios.map((scenario) => ({ agent: agent.agentName, atRisk: scenario.taskValueAtRiskAda, shared: scenario.sharedInfrastructure, recommendation: scenario.recommendation, expectedCostAda: scenario.expectedCostAda }))));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "showcase failed"); process.exitCode = 1; });
