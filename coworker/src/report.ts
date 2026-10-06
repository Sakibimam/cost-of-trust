import { env, loadEnv } from "./config.ts";
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

function koiosPath(identifier: string): string {
  if (/^asset1[a-z0-9]+$/i.test(identifier)) return `/asset_txs?_asset_fingerprint=${encodeURIComponent(identifier)}`;
  if (/^[0-9a-f]{56}$/i.test(identifier)) return `/credential_txs?_payment_credentials=${encodeURIComponent(identifier)}`;
  return `/asset_txs?_asset_policy=${encodeURIComponent(identifier.slice(0, 56))}`;
}

async function gather(input: CheckInput): Promise<Evidence[]> {
  const id = encodeURIComponent(input.agentIdentifier);
  const registry = env("REGISTRY_URL");
  const koios = env("KOIOS_URL");
  const router = env("ROUTER_URL");
  const seller = input.sellerId ?? input.agentIdentifier;
  const facts = await Promise.all([
    getJson("registry", `${registry}/agents/${id}`),
    getJson("masumi_escrow_history", `${koios}${koiosPath(input.agentIdentifier)}`),
    getJson("agent_availability", `${registry}/agents/${id}/availability`),
    getJson("agent_health", `${registry}/agents/${id}/health`),
    getJson("router_quote", `${router}/quotes/${encodeURIComponent(seller)}`),
  ]);
  return facts;
}

function routeFromQuote(facts: Evidence[], atRisk: number): { recommendation: TrustReport["recommendation"]; expectedCostAda: number | null } {
  const quote = facts.find((fact) => fact.source === "router_quote");
  const data = quote?.status === "ok" ? quote.data as Record<string, unknown> : undefined;
  const route = data?.riskAdjustedCostAda ?? data?.expectedTotalCostAda;
  const expectedCostAda = typeof route === "number" && Number.isFinite(route) ? route : null;
  if (expectedCostAda === null) return { recommendation: "insufficient_data", expectedCostAda: null };
  if (expectedCostAda > atRisk) return { recommendation: "do_not_hire", expectedCostAda };
  const selected = String(data?.selectedRoute ?? data?.route ?? "");
  if (selected.includes("underwritten")) return { recommendation: "require_coverage", expectedCostAda };
  if (selected.includes("redundant") || selected.includes("staggered")) return { recommendation: "hire_with_backup_keeper", expectedCostAda };
  return { recommendation: "hire_as_is", expectedCostAda };
}

async function summarize(input: CheckInput, facts: Evidence[], decision: ReturnType<typeof routeFromQuote>): Promise<string> {
  const key = env("ZAI_API_KEY") || env("OPENAI_API_KEY");
  if (!key) return "Plain-language summary unavailable: no model credential is configured. The structured facts and recommendation are authoritative.";
  const endpoint = env("ZAI_API_KEY") ? "https://api.z.ai/api/paas/v4/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const evidence = JSON.stringify({ input, decision, facts });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: env("MODEL", "glm-5.3-flash"), temperature: 0, messages: [
      { role: "system", content: "Write one concise due-diligence summary. Use only the supplied facts. Cite facts inline as [source]. Never invent numbers or fill missing values." },
      { role: "user", content: evidence },
    ] }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`model HTTP ${response.status}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content?.trim() || "Model returned no summary.";
}

export async function createReport(input: CheckInput): Promise<TrustReport> {
  if (!input.agentIdentifier || !Number.isFinite(input.taskValueAtRiskAda) || input.taskValueAtRiskAda < 0) throw new Error("agentIdentifier and non-negative taskValueAtRiskAda are required");
  const facts = await gather(input);
  const decision = routeFromQuote(facts, input.taskValueAtRiskAda);
  let summary: string;
  try { summary = await summarize(input, facts, decision); } catch (error) { summary = `Plain-language summary unavailable because the configured model failed: ${error instanceof Error ? error.message : "request failed"}. Structured facts remain authoritative.`; }
  return { input, ...decision, facts, summary, generatedAt: now() };
}
