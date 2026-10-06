import { env, loadEnv } from "./config.ts";
import { betaBinomialRisk } from "../../router/src/risk.ts";
import { deliveryHistory, detectNetwork, registryFromChain, type Network } from "./koios.ts";
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

// Masumi CIP-25 metadata stores api_base_url as a list of <=64 byte chunks.
function advertisedUrl(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data)) return data.map(advertisedUrl).find(Boolean) ?? null;
  const record = data as Record<string, unknown>;
  for (const key of ["api_base_url", "apiBaseUrl", "apiUrl", "endpoint", "url"]) {
    const value = Array.isArray(record[key]) && record[key].every((part) => typeof part === "string") ? record[key].join("") : record[key];
    if (typeof value === "string" && /^https?:\/\//.test(value)) return value.replace(/\/$/, "");
  }
  for (const value of Object.values(record)) {
    const found = advertisedUrl(value);
    if (found) return found;
  }
  return null;
}

const privateHost = (url: string) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?$)/.test(new URL(url).hostname);

async function gather(input: CheckInput): Promise<Evidence[]> {
  const network: Network = input.network ?? await detectNetwork(input.agentIdentifier);
  const registryFact = env("REGISTRY_API_KEY") ? await registryEntry(input.agentIdentifier) : await registryFromChain(input.agentIdentifier, network);
  const endpoint = advertisedUrl(registryFact.data);
  const unreachable = (error: string) => ["agent_availability", "agent_health"].map((source) => ({ source, status: "unavailable", observedAt: now(), error } as Evidence));
  const endpointFacts = !endpoint
    ? unreachable("registry did not advertise an API URL")
    : privateHost(endpoint)
      ? unreachable(`registry advertises a private API URL (${endpoint}) that buyers cannot reach`)
      : await Promise.all([getJson("agent_availability", `${endpoint}/availability`), getJson("agent_health", `${endpoint}/health`)]);
  return [registryFact, ...endpointFacts, await deliveryHistory(input.agentIdentifier, network)];
}

type Delivery = { paid: number; refunded: number; disputed: number };

// ponytail: fixed policy bands on the router's Beta(2,8) posterior; tune once buyers report their own loss tolerance.
export function decide(facts: Evidence[], atRisk: number): { recommendation: TrustReport["recommendation"]; expectedCostAda: number | null } {
  const delivery = facts.find((fact) => fact.source === "masumi_delivery_history");
  const record = delivery?.status === "ok" ? delivery.data as Delivery : undefined;
  if (!record || record.paid + record.refunded + record.disputed === 0) return { recommendation: "insufficient_data", expectedCostAda: null };
  const { pLoss } = betaBinomialRisk(record.paid, record.refunded + record.disputed);
  const expectedCostAda = Math.round(pLoss * atRisk * 100) / 100;
  const endpointDown = facts.some((fact) => fact.source === "agent_health" && fact.status !== "ok" && fact.error !== "registry did not advertise an API URL");
  if (endpointDown || pLoss >= 0.5) return { recommendation: "do_not_hire", expectedCostAda };
  if (pLoss >= 0.2) return { recommendation: "hire_with_backup_keeper", expectedCostAda };
  if (pLoss >= 0.1) return { recommendation: "require_coverage", expectedCostAda };
  return { recommendation: "hire_as_is", expectedCostAda };
}

async function summarize(input: CheckInput, facts: Evidence[], decision: ReturnType<typeof decide>): Promise<string> {
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
  const decision = decide(facts, input.taskValueAtRiskAda);
  let summary: string;
  try { summary = await summarize(input, facts, decision); } catch (error) { summary = `Plain-language summary unavailable because the configured model failed: ${error instanceof Error ? error.message : "request failed"}. Structured facts remain authoritative.`; }
  return { input, ...decision, facts, summary, generatedAt: now() };
}
