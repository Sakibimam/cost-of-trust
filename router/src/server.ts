import { blake2b } from "@noble/hashes/blake2.js";
import sellersSeed from "../sellers.json" with { type: "json" };
import underwriter from "../underwriter.json" with { type: "json" };
import { evaluateRoutes, sellerRisk, type RouteResult, type Seller, type UnderwriterConfig } from "./routes.ts";

let sellerFile: string | URL = new URL("../sellers.json", import.meta.url);
const sellers: Seller[] = structuredClone(sellersSeed as Seller[]);
const underwriterConfig = underwriter as UnderwriterConfig;
const quotes = new Map<string, { result: RouteResult; task: string; serviceType: string; deadline: string }>();

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortKeys(item)]));
  return value;
}

export function canonicalJson(value: unknown): string { return JSON.stringify(sortKeys(value)); }
export function termsHash(value: unknown): string { return Buffer.from(blake2b(new TextEncoder().encode(canonicalJson(value)), { dkLen: 32 })).toString("hex"); }

export async function useSellersFile(path: string) {
  sellerFile = path;
  sellers.splice(0, sellers.length, ...(await Bun.file(path).json() as Seller[]));
}

export async function useSellersFile(path: string) {
  sellerFile = path;
  sellers.splice(0, sellers.length, ...(await Bun.file(path).json() as Seller[]));
}

async function persistSellers() { await Bun.write(sellerFile, `${JSON.stringify(sellers, null, 2)}\n`); }

export async function ingestOutcome(sellerId: string, success: boolean, txHash: string): Promise<Seller> {
  if (!txHash || /\s/.test(txHash)) throw new Error("txHash is required");
  const seller = sellers.find((item) => item.id === sellerId);
  if (!seller) throw new Error("seller not found");
  if (success) seller.successes += 1; else seller.failures += 1;
  seller.evidence.push(txHash);
  await persistSellers();
  return structuredClone(seller);
}

function json(data: unknown, status = 200): Response { return new Response(data === null ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" } }); }
function selectedTerms(result: RouteResult) { const route = result.routes.find((item) => item.route === result.selectedRoute && item.sellers.join(",") === result.selectedSellers.join(",")); return { route: result.selectedRoute, sellers: result.selectedSellers, servicePriceAda: route?.servicePriceAda, premiumAda: route?.premiumAda, coverageAda: route?.coverageAda }; }

export function startServer(port = 8787) {
  return Bun.serve({ port, fetch: async (request) => {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return json(null, 204);
    try {
      if (request.method === "GET" && url.pathname === "/health") return json({ ok: true });
      if (request.method === "GET" && url.pathname === "/sellers") return json(sellers.map((seller) => ({ ...seller, risk: sellerRisk(seller, underwriterConfig) })));
      if (request.method === "GET" && url.pathname.startsWith("/quotes/")) {
        const id = decodeURIComponent(url.pathname.slice("/quotes/".length));
        const saved = quotes.get(id);
        const seller = sellers.find((item) => item.id === id);
        if (!saved && !seller) return json({ error: "quote not found" }, 404);
        if (seller) {
          const risk = sellerRisk(seller, underwriterConfig);
          const coverageLimitAda = underwriterConfig.coverageLimitAda;
          const premiumAda = risk.pClaim * coverageLimitAda + underwriterConfig.capitalCostRate * coverageLimitAda + underwriterConfig.fraudRiskAda + underwriterConfig.correlationRiskAda + underwriterConfig.marginAda;
          return json({ seller: seller.id, risk, coverageOffers: [{ underwriter: underwriterConfig.underwriter, premiumAda, coverageLimitAda, deductibleAda: underwriterConfig.deductibleAda, collateralRef: underwriterConfig.collateralRef, termsHash: termsHash({ seller: seller.id, coverageLimitAda, deductibleAda: underwriterConfig.deductibleAda }) }] });
        }
        return json({ ...saved, termsHash: termsHash(selectedTerms(saved.result)) });
      }
      if (request.method === "POST" && url.pathname === "/best-route") {
        const body = await request.json() as { task: string; serviceType: string; deadline: string; downstreamLossAda: number; riskAversion?: number; candidateSellers: string[]; constraints?: Parameters<typeof evaluateRoutes>[0]["constraints"] };
        const candidates = body.candidateSellers.map((id) => sellers.find((seller) => seller.id === id));
        if (candidates.some((seller) => !seller)) return json({ error: "unknown seller" }, 400);
        const result = evaluateRoutes({ downstreamLossAda: body.downstreamLossAda, riskAversion: body.riskAversion, candidateSellers: candidates as Seller[], constraints: body.constraints, underwriter: underwriterConfig });
        const quoteId = crypto.randomUUID();
        quotes.set(quoteId, { result, task: body.task, serviceType: body.serviceType, deadline: body.deadline });
        return json({ ...result, quoteId, termsHash: termsHash(selectedTerms(result)) });
      }
      return json({ error: "not found" }, 404);
    } catch (error) { return json({ error: error instanceof Error ? error.message : "request failed" }, 400); }
  } });
}

if (import.meta.main) startServer(Number(Bun.env.PORT ?? 8787));
