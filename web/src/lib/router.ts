export const ROUTER_URL = (process.env.NEXT_PUBLIC_ROUTER_URL ?? "http://localhost:8787").replace(/\/$/, "");

export type RouteId = "single" | "redundant" | "staggered" | "underwritten";

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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export function providerLabel(provider: string): string {
  const words = provider.split("-").filter(Boolean);
  const rest = words.filter((w) => w !== "shared" && w !== "node");
  return [...(words.includes("shared") ? ["shared"] : []), ...rest, "node"].map((w, i, all) => (w === "node" && i === all.length - 1 ? w : cap(w))).join(" ");
}

export function priorGloss(alpha0: number, beta0: number): string {
  const ratio = (alpha0 + beta0) / alpha0;
  const odds = Number.isInteger(ratio) ? `1 in ${ratio}` : `${Math.round((alpha0 / (alpha0 + beta0)) * 100)} in 100`;
  return `starting assumption: ${odds} jobs fail until a seller has a track record`;
}

export const roundArithmetic = (s: string) => s.replace(/\d+(?:\.\d+)?(?:e-?\d+)?/g, (m) => Number(m).toFixed(2));

export const KIND_GLOSS: Record<RouteId, string> = {
  single: "one keeper, no backup and no cover",
  redundant: "two keepers, either one can finish the job",
  staggered: "two keepers, one after the other, one claim and one fee",
  underwritten: "one keeper, with an insurer paying out if it fails",
};

export const nameOf = (names: Record<string, string>, id: string) => names[id] ?? id;
export const routeNames = (r: Pick<RouteQuote, "sellers"> & { route?: RouteId }, names: Record<string, string>) => r.sellers.map((id) => nameOf(names, id)).join(r.route === "staggered" ? " then " : " + ");

export function routeGloss(r: Pick<RouteQuote, "route" | "sellers">, names: Record<string, string>): string {
  if (r.route !== "staggered") return KIND_GLOSS[r.route];
  const [first, second] = r.sellers.map((id) => nameOf(names, id));
  return `${first} gets the first window; if it misses, ${second} may claim. The chain lets exactly one claim through and pays only the keeper who landed it.`;
}
