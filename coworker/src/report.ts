import { env, loadEnv } from "./config.ts";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { evaluateRoutes, sellerRisk, type RouteQuote, type Seller, type UnderwriterConfig } from "../../router/src/routes.ts";
import sellersSeed from "../../router/sellers.json" with { type: "json" };
import underwriterSeed from "../../router/underwriter.json" with { type: "json" };
import { deliveryHistory, detectNetwork, registryFromChain, type Network } from "./koios.ts";
import type { CheckInput, Evidence, TrustReport } from "./types.ts";

loadEnv();

const now = () => new Date().toISOString();

function ipv4Private(value: string): boolean {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function ipv6Value(value: string): bigint | null {
  const groups = value.toLowerCase().split("::");
  if (groups.length > 2) return null;
  const left = groups[0] ? groups[0].split(":") : [];
  const right = groups.length === 2 && groups[1] ? groups[1].split(":") : [];
  const expand = [...left, ...right];
  if (expand.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const missing = 8 - expand.length;
  if ((groups.length === 1 && missing !== 0) || missing < 0) return null;
  return BigInt(`0x${[...left, ...Array(missing).fill("0"), ...right].join("")}`);
}

function ipv6Private(value: string): boolean {
  const parsed = ipv6Value(value);
  if (parsed === null) return false;
  const first = Number(parsed >> 120n);
  const mapped = Number((parsed >> 32n) & 0xffffffffn);
  return parsed === 0n || parsed === 1n || first >= 0xfc && first <= 0xfd || (parsed >> 118n) === 0x3fan || (parsed >> 32n) === 0xffffn && ipv4Private(`${mapped >>> 24}.${mapped >>> 16 & 255}.${mapped >>> 8 & 255}.${mapped & 255}`);
}

export async function isUnsafeUrl(url: string, resolve = lookup): Promise<boolean> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return true; }
  if (!/^https?:$/.test(parsed.protocol)) return true;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "metadata" || host === "instance-data" || host === "metadata.google.internal" || host.endsWith(".metadata.google.internal") || host === "metadata.google") return true;
  const unsafe = (address: string) => isIP(address) === 4 ? ipv4Private(address) : isIP(address) === 6 && ipv6Private(address);
  if (unsafe(host)) return true;
  try {
    const addresses = await resolve(host, { all: true, verbatim: true });
    return addresses.some(({ address }) => unsafe(address));
  } catch { return true; }
}

export async function getJson(source: string, url: string, init?: RequestInit, resolve = lookup): Promise<Evidence> {
  try {
    if (await isUnsafeUrl(url, resolve)) return { source, status: "unavailable", observedAt: now(), error: `private API URL (${url})` };
    const response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (response.status >= 300 && response.status < 400) return { source, status: "unavailable", observedAt: now(), error: `redirect refused (${response.status})` };
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
export function advertisedUrl(data: unknown): string | null {
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

function recordValue(data: unknown, key: string): unknown {
  if (!data || typeof data !== "object") return undefined;
  if (Array.isArray(data)) for (const item of data) { const found = recordValue(item, key); if (found !== undefined) return found; }
  else {
    const record = data as Record<string, unknown>;
    if (key in record) return record[key];
    for (const value of Object.values(record)) { const found = recordValue(value, key); if (found !== undefined) return found; }
  }
  return undefined;
}

function lovelacePrice(data: unknown): { priceAda: number; note: string } {
  const pricing = recordValue(data, "agentPricing");
  const pricingRecord = pricing && typeof pricing === "object" && !Array.isArray(pricing) ? pricing as Record<string, unknown> : undefined;
  const entries = Array.isArray(pricingRecord?.fixedPricing) ? pricingRecord.fixedPricing : Array.isArray(pricing) ? pricing : pricing && typeof pricing === "object" ? [pricing] : [];
  const lovelace = entries.find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    const unit = Array.isArray(item.unit) ? item.unit.join("") : item.unit ?? item.currency ?? item.asset ?? "";
    return String(unit).toLowerCase() === "lovelace";
  }) as Record<string, unknown> | undefined;
  if (!lovelace) return { priceAda: 0, note: "Registry agentPricing has no lovelace quote; router priceAda is 0 ADA." };
  const amount = Number(lovelace.amount ?? lovelace.quantity ?? lovelace.price ?? 0);
  return Number.isFinite(amount) ? { priceAda: amount / 1_000_000, note: `Registry lovelace quote converted to ${amount / 1_000_000} ADA.` } : { priceAda: 0, note: "Registry lovelace quote was not numeric; router priceAda is 0 ADA." };
}

function registryName(data: unknown, fallback: string): string {
  const name = recordValue(data, "name");
  return typeof name === "string" && name ? name : Array.isArray(name) && typeof name[0] === "string" ? name[0] : fallback;
}

const routeKinds = ["single", "redundant", "staggered", "underwritten"] as const;
type Decision = Pick<TrustReport, "recommendation" | "expectedCostAda" | "options" | "pricingNote">;
const emptyOptions = (): TrustReport["options"] => ({ single: null, redundant: null, staggered: null, underwritten: null });

function cheapestOptions(routes: RouteQuote[]): TrustReport["options"] {
  const options = emptyOptions();
  for (const kind of routeKinds) {
    const quote = routes.filter((route) => route.route === kind).sort((a, b) => a.riskAdjustedCostAda - b.riskAdjustedCostAda)[0];
    if (quote) options[kind] = { sellers: quote.sellers, expectedTotalCostAda: quote.expectedTotalCostAda, riskAdjustedCostAda: quote.riskAdjustedCostAda, arithmetic: quote.arithmetic };
  }
  return options;
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

export function decide(facts: Evidence[], atRisk: number, input: Pick<CheckInput, "agentIdentifier" | "riskAversion" | "sharedInfrastructure"> = { agentIdentifier: "registry-agent" }): Decision {
  const delivery = facts.find((fact) => fact.source === "masumi_delivery_history");
  const record = delivery?.status === "ok" ? delivery.data as Delivery : undefined;
  const pricing = facts.find((fact) => fact.source === "registry" || fact.source === "registry_chain");
  const registryData = pricing?.data;
  const registryId = input.agentIdentifier;
  const price = lovelacePrice(registryData);
  const registrySeller: Seller = { id: registryId, name: registryName(registryData, registryId), priceAda: price.priceAda, provider: advertisedUrl(registryData) ? new URL(advertisedUrl(registryData)!).host : "unknown", payTo: "registry-agent", endpoint: advertisedUrl(registryData) ?? "", successes: record?.paid ?? 0, failures: (record?.refunded ?? 0) + (record?.disputed ?? 0), evidence: [] };
  const backups = (sellersSeed as Seller[]).filter((seller) => seller.type === "agent");
  const underwriter = underwriterSeed as UnderwriterConfig;
  const routes = record && record.paid + record.refunded + record.disputed > 0
    ? evaluateRoutes({ downstreamLossAda: atRisk, candidateSellers: [registrySeller, ...backups], constraints: { allowRedundancy: true }, underwriter, riskAversion: input.riskAversion ?? 0.25, sharedInfrastructure: input.sharedInfrastructure ?? false })
    : null;
  const options = routes ? cheapestOptions(routes.routes) : emptyOptions();
  if (!record || record.paid + record.refunded + record.disputed === 0) return { recommendation: "insufficient_data", expectedCostAda: null, options, pricingNote: price.note };
  const pLoss = sellerRisk(registrySeller, underwriter).pLoss;
  // MIP-003 defines /availability, not /health, so availability decides; /health only counts when it answers and reports a fault.
  const availability = facts.find((fact) => fact.source === "agent_availability");
  const advertised = availability?.error !== "registry did not advertise an API URL";
  const availabilityStatus = String((availability?.data as { status?: unknown } | undefined)?.status ?? "").toLowerCase();
  const health = facts.find((fact) => fact.source === "agent_health");
  const healthStatus = String((health?.data as { status?: unknown } | undefined)?.status ?? "").toLowerCase();
  const endpointDown = availability
    ? advertised && (availability.status !== "ok" || !["available", "ok", "online"].includes(availabilityStatus) || (health?.status === "ok" && ["unhealthy", "down", "error"].includes(healthStatus)))
    : facts.some((fact) => fact.source === "agent_health" && fact.status !== "ok" && fact.error !== "registry did not advertise an API URL");
  const selected = routes!.routes.find((route) => route.route === routes!.selectedRoute && route.sellers.join(",") === routes!.selectedSellers.join(","))!;
  if (endpointDown || pLoss >= 0.5) return { recommendation: "do_not_hire", expectedCostAda: selected.expectedTotalCostAda, options, pricingNote: price.note };
  const recommendation = routes!.selectedRoute === "single" && routes!.selectedSellers[0] === registryId ? "hire_as_is" : routes!.selectedRoute === "underwritten" ? "require_coverage" : "hire_with_backup_keeper";
  return { recommendation, expectedCostAda: selected.expectedTotalCostAda, options, pricingNote: price.note };
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
  const decision = decide(facts, input.taskValueAtRiskAda, input);
  let summary: string;
  try { summary = await summarize(input, facts, decision); } catch (error) { summary = `Plain-language summary unavailable because the configured model failed: ${error instanceof Error ? error.message : "request failed"}. Structured facts remain authoritative.`; }
  return { input, ...decision, facts, summary, generatedAt: now() };
}
