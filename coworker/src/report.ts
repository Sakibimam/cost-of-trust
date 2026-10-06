import { env, loadEnv } from "./config.ts";
import { escrowHistory, registryFromChain } from "./koios.ts";
import type { CheckInput, Evidence, TrustReport } from "./types.ts";

loadEnv();

const now = () => new Date().toISOString();

async function getJson(source: string, url: string, init?: RequestInit): Promise<Evidence> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : null; } catch { data = text.slice(0, 1000); }
    if (response.status === 404) return { source, status: "not_found", observedAt: now(), data };
    if (!response.ok) return { source, status: "unavailable", observedAt: now(), error: `HTTP ${response.status}` };
    return { source, status: "ok", observedAt: now(), data };
  } catch (error) {
    return { source, status: "unavailable", observedAt: now(), error: error instanceof Error ? error.message : "request failed" };
  }
}

async function routerQuote(base: string, input: CheckInput): Promise<Evidence> {
  try {
    const sellers = await fetch(`${base}/sellers`, { signal: AbortSignal.timeout(15_000) });
    const sellerData = await sellers.json() as Array<Record<string, unknown>>;
    const candidateSellers = input.sellerId
      ? [input.sellerId]
      : sellerData.map((seller) => String(seller.id ?? "")).filter(Boolean);
    return await getJson("router_quote", `${base}/best-route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: input.task ?? "due diligence", serviceType: "agent execution", deadline: new Date(Date.now() + 45 * 60_000).toISOString(), downstreamLossAda: input.taskValueAtRiskAda, riskAversion: 0.5, sharedInfrastructure: true, candidateSellers, constraints: { allowRedundancy: true } }),
    });
  } catch (error) {
    return { source: "router_quote", status: "unavailable", observedAt: now(), error: error instanceof Error ? error.message : "router request failed" };
  }
}

async function registryEntry(identifier: string): Promise<Evidence> {
  if (!env("REGISTRY_API_KEY")) return registryFromChain(identifier);
  const url = `${env("REGISTRY_URL")}/registry-entry/`;
  const registryKey = env("REGISTRY_API_KEY");
  return getJson("registry", url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(registryKey ? { token: registryKey } : {}) },
    body: JSON.stringify({ network: "Preprod", filter: { assetIdentifier: identifier }, limit: 1 }),
  });
}

function advertisedUrl(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data)) return data.map(advertisedUrl).find(Boolean) ?? null;
  const record = data as Record<string, unknown>;
  for (const key of ["apiBaseUrl", "apiUrl", "endpoint", "url"]) {
    if (typeof record[key] === "string" && /^https?:\/\//.test(record[key])) return record[key].replace(/\/$/, "");
  }
  for (const value of Object.values(record)) {
    const found = advertisedUrl(value);
    if (found) return found;
  }
  return null;
}

async function gather(input: CheckInput): Promise<Evidence[]> {
  const network = input.network ?? "Preprod";
  const router = env("ROUTER_URL");
  const registryFact = env("REGISTRY_API_KEY") ? await registryEntry(input.agentIdentifier) : await registryFromChain(input.agentIdentifier, network);
  const endpoint = advertisedUrl(registryFact.data);
  const endpointFacts = endpoint
    ? await Promise.all([
      getJson("agent_availability", `${endpoint}/availability`),
      getJson("agent_health", `${endpoint}/health`),
    ])
    : [
      { source: "agent_availability", status: "unavailable", observedAt: now(), error: "registry did not advertise an API URL" } as Evidence,
      { source: "agent_health", status: "unavailable", observedAt: now(), error: "registry did not advertise an API URL" } as Evidence,
    ];
  return [
    registryFact,
    ...endpointFacts,
    await escrowHistory(input.agentIdentifier, network),
    await routerQuote(router, input),
  ];
}

function routeFromQuote(facts: Evidence[], atRisk: number): { recommendation: TrustReport["recommendation"]; expectedCostAda: number | null } {
  const quote = facts.find((fact) => fact.source === "router_quote");
  const data = quote?.status === "ok" ? quote.data as Record<string, unknown> : undefined;
  const selectedRoute = String(data?.selectedRoute ?? data?.route ?? "");
  const selected = Array.isArray(data?.routes)
    ? data.routes.find((item) => {
      const row = item as Record<string, unknown>;
      return row.route === selectedRoute && JSON.stringify(row.sellers) === JSON.stringify(data?.selectedSellers);
    }) as Record<string, unknown> | undefined
    : undefined;
  const route = selected?.riskAdjustedCostAda ?? selected?.expectedTotalCostAda ?? data?.riskAdjustedCostAda ?? data?.expectedTotalCostAda;
  const expectedCostAda = typeof route === "number" && Number.isFinite(route) ? route : null;
  if (expectedCostAda === null) return { recommendation: "insufficient_data", expectedCostAda: null };
  if (expectedCostAda > atRisk) return { recommendation: "do_not_hire", expectedCostAda };
  if (selectedRoute.includes("underwritten")) return { recommendation: "require_coverage", expectedCostAda };
  if (selectedRoute.includes("redundant") || selectedRoute.includes("staggered")) return { recommendation: "hire_with_backup_keeper", expectedCostAda };
  return { recommendation: "hire_as_is", expectedCostAda };
}

async function summarize(input: CheckInput, facts: Evidence[], decision: ReturnType<typeof routeFromQuote>): Promise<string> {
  const key = env("OPENROUTER_API_KEY") || env("ZAI_API_KEY") || env("OPENAI_API_KEY") || env("ANTHROPIC_API_KEY");
  if (!key) return "Plain-language summary unavailable: no model credential is configured. The structured facts and recommendation are authoritative.";
  const endpoint = env("OPENROUTER_API_KEY") ? `${env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")}/chat/completions` : env("ZAI_API_KEY") ? "https://api.z.ai/api/paas/v4/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const evidence = JSON.stringify({ input, decision, facts });
  const models = [env("MODEL", "nvidia/nemotron-3-ultra-550b-a55b:free"), env("MODEL_FALLBACK", "nvidia/nemotron-3-super-120b-a12b:free")];
  let lastError = "model returned no summary";
  for (const model of [...new Set(models)]) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 800, messages: [
        { role: "system", content: "Write one concise due-diligence summary. Use only the supplied facts. Cite facts inline as [source]. Never invent numbers or fill missing values." },
        { role: "user", content: evidence },
      ] }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
    const content = body.choices?.[0]?.message?.content?.trim();
    if (response.ok && content) return content;
    lastError = body.error?.message || `model HTTP ${response.status}`;
  }
  throw new Error(lastError);
}

export async function createReport(input: CheckInput): Promise<TrustReport> {
  if (!input.agentIdentifier || !Number.isFinite(input.taskValueAtRiskAda) || input.taskValueAtRiskAda < 0) throw new Error("agentIdentifier and non-negative taskValueAtRiskAda are required");
  const facts = await gather(input);
  const decision = routeFromQuote(facts, input.taskValueAtRiskAda);
  let summary: string;
  try { summary = await summarize(input, facts, decision); } catch (error) { summary = `Plain-language summary unavailable because the configured model failed: ${error instanceof Error ? error.message : "request failed"}. Structured facts remain authoritative.`; }
  return { input, ...decision, facts, summary, generatedAt: now() };
}
