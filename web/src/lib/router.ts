export const ROUTER_URL = (process.env.NEXT_PUBLIC_ROUTER_URL ?? "http://localhost:8787").replace(/\/$/, "");

export type RouteId = "single" | "redundant" | "underwritten";

export type RouteQuote = {
  route: RouteId;
  sellers: string[];
  servicePriceAda: number;
  premiumAda: number;
  premiumBreakdown: Record<string, number>;
  coverageAda: number;
  pLoss: number;
  pClaim: number;
  confidence: number;
  expectedLossAda: number;
  sdLossAda: number;
  expectedTotalCostAda: number;
  riskAdjustedCostAda: number;
  jointFailureProbability?: number;
  arithmetic: string;
};

export type Assumption = { value: number | boolean; status: string };
export type RouteResult = {
  selectedRoute: RouteId;
  selectedSellers: string[];
  reason: string;
  routes: RouteQuote[];
  alternatives: RouteQuote[];
  assumptions: Record<string, Assumption | string | { alpha0: number; beta0: number; status: string }>;
  quoteId: string;
  termsHash: string;
};

export type SellerRecord = {
  id: string;
  name: string;
  priceAda: number;
  provider: string;
  successes: number;
  failures: number;
  evidence: string[];
  bondDiscount?: number;
  risk: { alpha0: number; beta0: number; alpha: number; beta: number; pLoss: number; pClaim: number; confidence: number };
};

export type RouteRequest = { downstreamLossAda: number; riskAversion: number; sharedInfrastructure: boolean; candidateSellers: string[] };

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `router answered HTTP ${res.status}`);
  return body;
}

export async function fetchSellers(signal: AbortSignal): Promise<SellerRecord[]> {
  return readJson<SellerRecord[]>(await fetch(`${ROUTER_URL}/sellers`, { signal, cache: "no-store" }));
}

export async function fetchBestRoute(req: RouteRequest, signal: AbortSignal): Promise<RouteResult> {
  const res = await fetch(`${ROUTER_URL}/best-route`, {
    method: "POST",
    signal,
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task: "claim-before-expiry", serviceType: "cardano-deadline-execution", deadline: new Date(Date.now() + 10 * 60_000).toISOString(), constraints: { allowRedundancy: true }, ...req }),
  });
  return readJson<RouteResult>(res);
}

export const routeKey = (r: Pick<RouteQuote, "route" | "sellers">) => `${r.route}:${r.sellers.join("+")}`;
export const routeLabel = (r: Pick<RouteQuote, "route" | "sellers">) => `${r.route} ${r.sellers.join(" + ")}`;
export const riskChargeAda = (r: RouteQuote) => r.riskAdjustedCostAda - r.expectedTotalCostAda;

export function rankedRoutes(result: RouteResult): RouteQuote[] {
  const selected = result.routes.find((r) => r.route === result.selectedRoute && r.sellers.join(",") === result.selectedSellers.join(","));
  return selected ? [selected, ...result.alternatives] : [...result.routes].sort((a, b) => a.riskAdjustedCostAda - b.riskAdjustedCostAda);
}

export const upfrontAda = (r: RouteQuote) => r.servicePriceAda + r.premiumAda;
