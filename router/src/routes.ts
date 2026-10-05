import { betaBinomialRisk, type Risk } from "./risk.ts";

export type Seller = {
  id: string; name: string; priceAda: number; provider: string; payTo: string; endpoint: string;
  successes: number; failures: number; evidence: string[]; bondDiscount?: number;
  dependencyRiskPenalty?: number; recentIncidentPenalty?: number;
};

export type UnderwriterConfig = {
  underwriter: string; coverageLimitAda: number; deductibleAda: number; collateralRef: string;
  capitalCostRate: number; fraudRiskAda: number; correlationRiskAda: number; marginAda: number;
  coverageApplicabilityRate: number; sharedProviderCorrelation: number;
};

export type RouteConstraints = { allowRedundancy?: boolean; requireCoverage?: boolean; maxServiceSpendAda?: number };
export type RouteInput = { downstreamLossAda: number; candidateSellers: Seller[]; constraints?: RouteConstraints; underwriter: UnderwriterConfig };
export type RouteQuote = {
  route: "cheapest-single" | "redundant-two" | "underwritten-single";
  sellers: string[]; servicePriceAda: number; premiumAda: number; premiumBreakdown: Record<string, number>;
  coverageAda: number; pLoss: number; pClaim: number; confidence: number; expectedUncoveredLossAda: number;
  expectedTotalCostAda: number; jointFailureProbability?: number; arithmetic: string;
};

export type RouteResult = { selectedRoute: RouteQuote["route"]; selectedSellers: string[]; reason: string; routes: RouteQuote[]; alternatives: RouteQuote[]; assumptions: Record<string, unknown> };

function riskFor(seller: Seller, underwriter: UnderwriterConfig): Risk {
  return betaBinomialRisk(seller.successes, seller.failures, {
    bondDiscount: seller.bondDiscount,
    dependencyRiskPenalty: seller.dependencyRiskPenalty,
    recentIncidentPenalty: seller.recentIncidentPenalty,
    coverageApplicabilityRate: underwriter.coverageApplicabilityRate,
  });
}

function single(seller: Seller, loss: number, underwriter: UnderwriterConfig): RouteQuote {
  const risk = riskFor(seller, underwriter);
  const expectedUncoveredLossAda = risk.pLoss * loss;
  return { route: "cheapest-single", sellers: [seller.id], servicePriceAda: seller.priceAda, premiumAda: 0, premiumBreakdown: {}, coverageAda: 0, pLoss: risk.pLoss, pClaim: risk.pClaim, confidence: risk.confidence, expectedUncoveredLossAda, expectedTotalCostAda: seller.priceAda + expectedUncoveredLossAda, arithmetic: `${seller.priceAda} + ${risk.pLoss} * ${loss}` };
}

function redundant(a: Seller, b: Seller, loss: number, underwriter: UnderwriterConfig): RouteQuote {
  const ra = riskFor(a, underwriter); const rb = riskFor(b, underwriter);
  const shared = a.provider === b.provider;
  const covariance = underwriter.sharedProviderCorrelation * Math.sqrt(ra.pLoss * (1 - ra.pLoss) * rb.pLoss * (1 - rb.pLoss));
  const jointFailureProbability = shared ? ra.pLoss * rb.pLoss + covariance : ra.pLoss * rb.pLoss;
  const expectedUncoveredLossAda = jointFailureProbability * loss;
  return { route: "redundant-two", sellers: [a.id, b.id], servicePriceAda: a.priceAda + b.priceAda, premiumAda: 0, premiumBreakdown: {}, coverageAda: 0, pLoss: (ra.pLoss + rb.pLoss) / 2, pClaim: (ra.pClaim + rb.pClaim) / 2, confidence: ra.confidence + rb.confidence, expectedUncoveredLossAda, expectedTotalCostAda: a.priceAda + b.priceAda + expectedUncoveredLossAda, jointFailureProbability, arithmetic: `${a.priceAda} + ${b.priceAda} + ${jointFailureProbability} * ${loss}` };
}

function underwritten(seller: Seller, loss: number, underwriter: UnderwriterConfig): RouteQuote {
  const risk = riskFor(seller, underwriter); const coverageAda = Math.min(loss, underwriter.coverageLimitAda);
  const premiumBreakdown = { coveredClaim: risk.pClaim * coverageAda, capitalCost: underwriter.capitalCostRate * coverageAda, fraudRisk: underwriter.fraudRiskAda, correlationRisk: underwriter.correlationRiskAda, margin: underwriter.marginAda };
  const premiumAda = Object.values(premiumBreakdown).reduce((sum, value) => sum + value, 0);
  const expectedUncoveredLossAda = risk.pLoss * Math.max(loss - coverageAda, 0);
  return { route: "underwritten-single", sellers: [seller.id], servicePriceAda: seller.priceAda, premiumAda, premiumBreakdown, coverageAda, pLoss: risk.pLoss, pClaim: risk.pClaim, confidence: risk.confidence, expectedUncoveredLossAda, expectedTotalCostAda: seller.priceAda + premiumAda + expectedUncoveredLossAda, arithmetic: `${seller.priceAda} + (${Object.values(premiumBreakdown).join(" + ")}) + ${risk.pLoss} * max(${loss} - ${coverageAda}, 0)` };
}

export function evaluateRoutes(input: RouteInput): RouteResult {
  if (input.downstreamLossAda < 0 || input.candidateSellers.length === 0) throw new Error("loss must be non-negative and sellers are required");
  const { downstreamLossAda: loss, candidateSellers: sellers, constraints = {}, underwriter } = input;
  const byPrice = [...sellers].sort((x, y) => x.priceAda - y.priceAda);
  // cheapest-single is the unprotected baseline: the lowest-priced seller, no cover
  const routes: RouteQuote[] = [single(byPrice[0], loss, underwriter)];
  if (constraints.allowRedundancy && sellers.length > 1 && loss > 0) {
    // ponytail: redundancy is quoted for the two cheapest sellers only; all-pairs search if the seller set grows
    routes.push(redundant(byPrice[0], byPrice[1], loss, underwriter));
  }
  routes.push(...sellers.map((seller) => underwritten(seller, loss, underwriter)));
  const eligible = routes.filter((route) => (!constraints.requireCoverage || route.route === "underwritten-single") && (constraints.maxServiceSpendAda === undefined || route.servicePriceAda <= constraints.maxServiceSpendAda));
  if (eligible.length === 0) throw new Error("no route satisfies constraints");
  eligible.sort((a, b) => a.expectedTotalCostAda - b.expectedTotalCostAda);
  const selected = eligible[0];
  return { selectedRoute: selected.route, selectedSellers: selected.sellers, reason: `minimum expected total cost ${selected.expectedTotalCostAda.toFixed(2)} ADA`, routes, alternatives: eligible.slice(1), assumptions: { prior: { alpha0: 2, beta0: 8, status: "configured" }, sharedProviderCorrelation: { value: underwriter.sharedProviderCorrelation, status: "configured" }, coverageApplicabilityRate: { value: underwriter.coverageApplicabilityRate, status: "configured" }, penalties: "seller-specific values are configured; outcome counts are measured" } };
}

export function sellerRisk(seller: Seller, underwriter: UnderwriterConfig): Risk { return riskFor(seller, underwriter); }
