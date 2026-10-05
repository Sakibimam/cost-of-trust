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
export type RouteInput = { downstreamLossAda: number; candidateSellers: Seller[]; constraints?: RouteConstraints; underwriter: UnderwriterConfig; riskAversion?: number };
export type RouteQuote = {
  route: "single" | "redundant" | "underwritten";
  sellers: string[]; servicePriceAda: number; premiumAda: number; premiumBreakdown: Record<string, number>;
  coverageAda: number; pLoss: number; pClaim: number; confidence: number;
  expectedLossAda: number; sdLossAda: number; expectedTotalCostAda: number; riskAdjustedCostAda: number;
  jointFailureProbability?: number; arithmetic: string;
};

export type RouteResult = { selectedRoute: RouteQuote["route"]; selectedSellers: string[]; reason: string; routes: RouteQuote[]; alternatives: RouteQuote[]; assumptions: Record<string, unknown> };

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

function redundant(a: Seller, b: Seller, loss: number, underwriter: UnderwriterConfig, lambda: number): RouteQuote {
  const ra = riskFor(a, underwriter); const rb = riskFor(b, underwriter);
  const shared = a.provider === b.provider;
  const covariance = underwriter.sharedProviderCorrelation * Math.sqrt(ra.pLoss * (1 - ra.pLoss) * rb.pLoss * (1 - rb.pLoss));
  const jointFailureProbability = shared ? ra.pLoss * rb.pLoss + covariance : ra.pLoss * rb.pLoss;
  const expectedLossAda = jointFailureProbability * loss;
  const sdLossAda = loss * Math.sqrt(jointFailureProbability * (1 - jointFailureProbability));
  return finish({ route: "redundant", sellers: [a.id, b.id], servicePriceAda: a.priceAda + b.priceAda, premiumAda: 0, premiumBreakdown: {}, coverageAda: 0, pLoss: jointFailureProbability, pClaim: 0, confidence: ra.confidence + rb.confidence, expectedLossAda, sdLossAda, jointFailureProbability, arithmetic: `${a.priceAda} + ${b.priceAda} + ${jointFailureProbability} * ${loss} + ${lambda} * ${sdLossAda}` }, lambda);
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

function explain(selected: RouteQuote, eligible: RouteQuote[], lambda: number): string {
  const head = `${label(selected)} has the minimum risk-adjusted cost ${selected.riskAdjustedCostAda.toFixed(2)} ADA`;
  if (selected.route === "underwritten") {
    const bare = eligible.filter((r) => r.route !== "underwritten").sort((a, b) => a.riskAdjustedCostAda - b.riskAdjustedCostAda)[0];
    if (!bare) return `${head}; coverage is the only route the constraints allow`;
    if (lambda > 0 && bare.expectedTotalCostAda <= selected.expectedTotalCostAda) return `coverage wins because riskAversion ${lambda} penalises the ${bare.sdLossAda.toFixed(2)} ADA loss sd of ${label(bare)}; ${head}`;
    return `${head}; best uncovered route ${label(bare)} costs ${bare.riskAdjustedCostAda.toFixed(2)} ADA`;
  }
  const cover = eligible.filter((r) => r.route === "underwritten").sort((a, b) => a.riskAdjustedCostAda - b.riskAdjustedCostAda)[0];
  if (!cover) return head;
  return `${head}; coverage does not pay at riskAversion ${lambda}: best underwritten route ${label(cover)} costs ${cover.riskAdjustedCostAda.toFixed(2)} ADA`;
}

export function evaluateRoutes(input: RouteInput): RouteResult {
  const lambda = input.riskAversion ?? 0;
  if (!(lambda >= 0)) throw new Error("riskAversion must be a number >= 0");
  if (input.downstreamLossAda < 0 || input.candidateSellers.length === 0) throw new Error("loss must be non-negative and sellers are required");
  const { downstreamLossAda: loss, candidateSellers: sellers, constraints = {}, underwriter } = input;
  const routes: RouteQuote[] = sellers.map((seller) => single(seller, loss, underwriter, lambda));
  if (constraints.allowRedundancy) {
    for (let i = 0; i < sellers.length; i++) for (let j = i + 1; j < sellers.length; j++) routes.push(redundant(sellers[i], sellers[j], loss, underwriter, lambda));
  }
  routes.push(...sellers.map((seller) => underwritten(seller, loss, underwriter, lambda)));
  const eligible = routes.filter((route) => (!constraints.requireCoverage || route.route === "underwritten") && (constraints.maxServiceSpendAda === undefined || route.servicePriceAda <= constraints.maxServiceSpendAda));
  if (eligible.length === 0) throw new Error("no route satisfies constraints");
  eligible.sort((a, b) => Math.abs(a.riskAdjustedCostAda - b.riskAdjustedCostAda) < TIE_ADA ? a.sdLossAda - b.sdLossAda : a.riskAdjustedCostAda - b.riskAdjustedCostAda);
  const selected = eligible[0];
  return { selectedRoute: selected.route, selectedSellers: selected.sellers, reason: explain(selected, eligible, lambda), routes, alternatives: eligible.slice(1), assumptions: { riskAversion: { value: lambda, status: "buyer-supplied" }, prior: { alpha0: 2, beta0: 8, status: "configured" }, sharedProviderCorrelation: { value: underwriter.sharedProviderCorrelation, status: "configured" }, coverageApplicabilityRate: { value: underwriter.coverageApplicabilityRate, status: "configured" }, penalties: "seller-specific values are configured; outcome counts are measured" } };
}

export function sellerRisk(seller: Seller, underwriter: UnderwriterConfig): Risk { return riskFor(seller, underwriter); }
