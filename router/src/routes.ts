import { betaBinomialRisk, type Risk } from "./risk.ts";

export type Seller = {
  id: string; name: string; priceAda: number; provider: string; payTo: string; endpoint: string;
  successes: number; failures: number; evidence: string[]; bondDiscount?: number;
  dependencyRiskPenalty?: number; recentIncidentPenalty?: number;
  type?: "agent" | "provider";
};

export type UnderwriterConfig = {
  underwriter: string; coverageLimitAda: number; deductibleAda: number; collateralRef: string;
  capitalCostRate: number; fraudRiskAda: number; correlationRiskAda: number; marginAda: number;
  coverageApplicabilityRate: number; sharedProviderCorrelation: number; lateSlotPenalty: number;
};

export type RouteConstraints = { allowRedundancy?: boolean; requireCoverage?: boolean; maxServiceSpendAda?: number };
export type RouteInput = { downstreamLossAda: number; candidateSellers: Seller[]; constraints?: RouteConstraints; underwriter: UnderwriterConfig; riskAversion?: number; sharedInfrastructure?: boolean };
export type RouteQuote = {
  route: "single" | "redundant" | "staggered" | "underwritten";
  sellers: string[]; servicePriceAda: number; premiumAda: number; premiumBreakdown: Record<string, number>;
  coverageAda: number; pLoss: number; pClaim: number; confidence: number;
  expectedLossAda: number; sdLossAda: number; expectedTotalCostAda: number; riskAdjustedCostAda: number;
  jointFailureProbability?: number; arithmetic: string;
};

export type RouteResult = { selectedRoute: RouteQuote["route"]; selectedSellers: string[]; reason: string; forcedByConstraints: boolean; routes: RouteQuote[]; alternatives: RouteQuote[]; assumptions: Record<string, unknown> };

export type CapabilityPolicy = { alpha0: number; beta0: number };
export type CapabilityDecision = {
  route: "hire_as_is" | "backup";
  primary: Seller;
  backup?: Seller;
  primaryPLoss: number;
  backupPLoss?: number;
};

const TIE_ADA = 0.005;
const label = (route: RouteQuote) => `${route.route} ${route.sellers.join("+")}`;

function riskFor(seller: Seller, underwriter: UnderwriterConfig): Risk {
  return betaBinomialRisk(seller.successes, seller.failures, {
    bondDiscount: seller.bondDiscount,
    dependencyRiskPenalty: seller.dependencyRiskPenalty,
    recentIncidentPenalty: seller.recentIncidentPenalty,
    coverageApplicabilityRate: underwriter.coverageApplicabilityRate,
  });
}

const byCost = (a: RouteQuote, b: RouteQuote) => a.riskAdjustedCostAda - b.riskAdjustedCostAda;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function posteriorFailure(seller: Pick<Seller, "successes" | "failures">, prior: CapabilityPolicy): number {
  const total = prior.alpha0 + prior.beta0 + seller.successes + seller.failures;
  return (prior.alpha0 + seller.failures) / total;
}

export function decideCapabilityRoute(input: {
  downstreamLossAda: number;
  sellers: Seller[];
  prior: CapabilityPolicy;
}): CapabilityDecision {
  if (input.downstreamLossAda < 0 || input.sellers.length === 0) throw new Error("loss must be non-negative and sellers are required");
  if (!(input.prior.alpha0 > 0 && input.prior.beta0 > 0)) throw new Error("prior must be positive");
  const ranked = input.sellers.map((seller) => ({ seller, pLoss: posteriorFailure(seller, input.prior) }))
    .sort((a, b) => a.pLoss - b.pLoss || a.seller.priceAda - b.seller.priceAda || a.seller.id.localeCompare(b.seller.id));
  const primary = ranked[0]!;
  const backup = ranked.find(({ seller }) => seller.id !== primary.seller.id && seller.priceAda < primary.pLoss * input.downstreamLossAda);
  return backup
    ? { route: "backup", primary: primary.seller, backup: backup.seller, primaryPLoss: primary.pLoss, backupPLoss: backup.pLoss }
    : { route: "hire_as_is", primary: primary.seller, primaryPLoss: primary.pLoss };
}

export function boundedJointFailureProbability(pa: number, pb: number, correlation: number): number {
  const rho = clamp(correlation, -1, 1);
  const covariance = rho * Math.sqrt(pa * (1 - pa) * pb * (1 - pb));
  return clamp(pa * pb + covariance, Math.max(0, pa + pb - 1), Math.min(pa, pb));
}

function finish(base: Omit<RouteQuote, "expectedTotalCostAda" | "riskAdjustedCostAda">, lambda: number): RouteQuote {
  const expectedTotalCostAda = base.servicePriceAda + base.premiumAda + base.expectedLossAda;
  return { ...base, expectedTotalCostAda, riskAdjustedCostAda: expectedTotalCostAda + lambda * base.sdLossAda };
}

function single(seller: Seller, loss: number, underwriter: UnderwriterConfig, lambda: number): RouteQuote {
  const risk = riskFor(seller, underwriter);
  const expectedLossAda = risk.pLoss * loss;
  const sdLossAda = loss * Math.sqrt(risk.pLoss * (1 - risk.pLoss));
  return finish({ route: "single", sellers: [seller.id], servicePriceAda: seller.priceAda, premiumAda: 0, premiumBreakdown: {}, coverageAda: 0, pLoss: risk.pLoss, pClaim: risk.pClaim, confidence: risk.confidence, expectedLossAda, sdLossAda, arithmetic: `${seller.priceAda} + ${risk.pLoss} * ${loss} + ${lambda} * ${sdLossAda}` }, lambda);
}

function redundant(a: Seller, b: Seller, loss: number, underwriter: UnderwriterConfig, lambda: number, sharedInfrastructure: boolean): RouteQuote {
  const ra = riskFor(a, underwriter); const rb = riskFor(b, underwriter);
  const shared = sharedInfrastructure || a.provider === b.provider;
  const jointFailureProbability = shared ? boundedJointFailureProbability(ra.pLoss, rb.pLoss, underwriter.sharedProviderCorrelation) : ra.pLoss * rb.pLoss;
  const expectedLossAda = jointFailureProbability * loss;
  const sdLossAda = loss * Math.sqrt(jointFailureProbability * (1 - jointFailureProbability));
  return finish({ route: "redundant", sellers: [a.id, b.id], servicePriceAda: a.priceAda + b.priceAda, premiumAda: 0, premiumBreakdown: {}, coverageAda: 0, pLoss: jointFailureProbability, pClaim: 0, confidence: ra.confidence + rb.confidence, expectedLossAda, sdLossAda, jointFailureProbability, arithmetic: `${a.priceAda} + ${b.priceAda} + ${jointFailureProbability} * ${loss} + ${lambda} * ${sdLossAda}` }, lambda);
}

function staggered(a: Seller, b: Seller, loss: number, underwriter: UnderwriterConfig, lambda: number, sharedInfrastructure: boolean): RouteQuote {
  const ra = riskFor(a, underwriter); const rb = riskFor(b, underwriter);
  const pbLate = Math.min(rb.pLoss + underwriter.lateSlotPenalty, 0.999);
  const shared = sharedInfrastructure || a.provider === b.provider;
  const jointFailureProbability = shared ? boundedJointFailureProbability(ra.pLoss, pbLate, underwriter.sharedProviderCorrelation) : ra.pLoss * pbLate;
  const expectedFeeAda = a.priceAda * (1 - ra.pLoss) + b.priceAda * ra.pLoss * (1 - pbLate);
  const expectedLossAda = jointFailureProbability * loss;
  const sdLossAda = loss * Math.sqrt(jointFailureProbability * (1 - jointFailureProbability));
  return finish({ route: "staggered", sellers: [a.id, b.id], servicePriceAda: expectedFeeAda, premiumAda: 0, premiumBreakdown: {}, coverageAda: 0, pLoss: jointFailureProbability, pClaim: 0, confidence: ra.confidence + rb.confidence, expectedLossAda, sdLossAda, jointFailureProbability, arithmetic: `${a.priceAda} * ${1 - ra.pLoss} + ${b.priceAda} * ${ra.pLoss} * ${1 - pbLate} + ${jointFailureProbability} * ${loss} + ${lambda} * ${sdLossAda}` }, lambda);
}

function underwritten(seller: Seller, loss: number, underwriter: UnderwriterConfig, lambda: number): RouteQuote {
  const risk = riskFor(seller, underwriter); const coverageAda = Math.min(loss, underwriter.coverageLimitAda);
  const premiumBreakdown = { coveredClaim: risk.pClaim * coverageAda, capitalCost: underwriter.capitalCostRate * coverageAda, fraudRisk: underwriter.fraudRiskAda, correlationRisk: underwriter.correlationRiskAda, margin: underwriter.marginAda };
  const premiumAda = Object.values(premiumBreakdown).reduce((sum, value) => sum + value, 0);
  const outcomes = [[1 - risk.pLoss, 0], [risk.pClaim, loss - coverageAda], [risk.pLoss - risk.pClaim, loss]] as const;
  const expectedLossAda = outcomes.reduce((sum, [p, x]) => sum + p * x, 0);
  const sdLossAda = Math.sqrt(Math.max(outcomes.reduce((sum, [p, x]) => sum + p * x * x, 0) - expectedLossAda ** 2, 0));
  return finish({ route: "underwritten", sellers: [seller.id], servicePriceAda: seller.priceAda, premiumAda, premiumBreakdown, coverageAda, pLoss: risk.pLoss, pClaim: risk.pClaim, confidence: risk.confidence, expectedLossAda, sdLossAda, arithmetic: `${seller.priceAda} + ${premiumAda} + (${risk.pLoss} * ${loss} - ${risk.pClaim} * ${coverageAda}) + ${lambda} * ${sdLossAda}` }, lambda);
}

function explain(selected: RouteQuote, eligible: RouteQuote[], lambda: number, shared: boolean): string {
  const cost = `${selected.riskAdjustedCostAda.toFixed(2)} ADA`;
  const cover = eligible.filter((r) => r.route === "underwritten").sort(byCost)[0];
  if (selected.route === "staggered") {
    return `${shared ? "sellers share infrastructure, so the late keeper is correlated, yet" : "sellers fail independently, so"} an escrowed schedule (${selected.sellers[0]} first, ${selected.sellers[1]} as late backup) pays only the keeper that lands and caps the tail cheaper than coverage or parallel backups; risk-adjusted cost ${cost}`;
  }
  if (selected.route === "redundant") {
    const mechanism = shared ? "backups still beat coverage despite shared infrastructure" : "sellers fail independently, so a backup keeper";
    const tail = cover ? ` caps the tail cheaper than coverage (${cover.riskAdjustedCostAda.toFixed(2)} ADA for ${label(cover)})` : " caps the tail";
    return `${mechanism}${shared ? "" : ` (${label(selected)})`}${tail}; risk-adjusted cost ${cost}`;
  }
  if (selected.route === "underwritten") {
    const own = eligible.concat().find((r) => r.route === "single" && r.sellers[0] === selected.sellers[0]);
    const tail = own ? `caps the ${own.sdLossAda.toFixed(2)} ADA loss sd of ${selected.sellers[0]}` : "caps the tail";
    return `${shared ? "sellers share infrastructure, so backups fail together; " : (eligible.some((r) => r.route === "redundant") ? "no backup pair is cheaper at this riskAversion; " : "no backup pair is quoted; ")}coverage ${tail}; risk-adjusted cost ${cost} at riskAversion ${lambda}`;
  }
  return `${label(selected)} has the minimum risk-adjusted cost ${cost}; at riskAversion ${lambda} neither a backup nor coverage pays for itself${cover ? ` (best coverage ${cover.riskAdjustedCostAda.toFixed(2)} ADA)` : ""}`;
}

export function evaluateRoutes(input: RouteInput): RouteResult {
  const lambda = input.riskAversion ?? 0;
  const sharedInfrastructure = input.sharedInfrastructure ?? false;
  if (!(lambda >= 0)) throw new Error("riskAversion must be a number >= 0");
  if (input.downstreamLossAda < 0 || input.candidateSellers.length === 0) throw new Error("loss must be non-negative and sellers are required");
  const { downstreamLossAda: loss, candidateSellers: sellers, constraints = {}, underwriter } = input;
  const routes: RouteQuote[] = sellers.map((seller) => single(seller, loss, underwriter, lambda));
  if (constraints.allowRedundancy) {
    for (let i = 0; i < sellers.length; i++) for (let j = i + 1; j < sellers.length; j++) routes.push(redundant(sellers[i], sellers[j], loss, underwriter, lambda, sharedInfrastructure));
    for (let i = 0; i < sellers.length; i++) for (let j = 0; j < sellers.length; j++) if (i !== j) routes.push(staggered(sellers[i], sellers[j], loss, underwriter, lambda, sharedInfrastructure));
  }
  routes.push(...sellers.map((seller) => underwritten(seller, loss, underwriter, lambda)));
  const eligible = routes.filter((route) => (!constraints.requireCoverage || route.route === "underwritten") && (constraints.maxServiceSpendAda === undefined || route.servicePriceAda <= constraints.maxServiceSpendAda));
  if (eligible.length === 0) throw new Error("no route satisfies constraints");
  eligible.sort((a, b) => {
    if (Math.abs(a.riskAdjustedCostAda - b.riskAdjustedCostAda) >= TIE_ADA) return a.riskAdjustedCostAda - b.riskAdjustedCostAda;
    if (Math.abs(a.sdLossAda - b.sdLossAda) >= TIE_ADA) return a.sdLossAda - b.sdLossAda;
    return label(a).localeCompare(label(b));
  });
  const selected = eligible[0];
  const cheapest = routes.concat().sort((a, b) => a.riskAdjustedCostAda - b.riskAdjustedCostAda)[0];
  const forced = constraints.requireCoverage && cheapest.riskAdjustedCostAda + TIE_ADA < selected.riskAdjustedCostAda;
  const reason = forced
    ? `coverage required by buyer; ${label(selected)} costs ${selected.riskAdjustedCostAda.toFixed(2)} ADA, the unconstrained best route (${label(cheapest)}) would cost ${cheapest.riskAdjustedCostAda.toFixed(2)} ADA`
    : explain(selected, eligible, lambda, sharedInfrastructure);
  return { selectedRoute: selected.route, selectedSellers: selected.sellers, reason, forcedByConstraints: !!forced, routes, alternatives: eligible.slice(1), assumptions: { sharedInfrastructure: { value: sharedInfrastructure, status: "buyer-supplied" }, riskAversion: { value: lambda, status: "buyer-supplied" }, prior: { alpha0: 2, beta0: 8, status: "configured" }, sharedProviderCorrelation: { value: underwriter.sharedProviderCorrelation, status: "configured" }, coverageApplicabilityRate: { value: 1, status: "validator pays every FAILURE" }, penalties: "seller-specific values are configured; outcome counts are measured" } };
}

export function sellerRisk(seller: Seller, underwriter: UnderwriterConfig): Risk { return riskFor(seller, underwriter); }
