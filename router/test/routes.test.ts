import { describe, expect, test } from "bun:test";
import { evaluateRoutes, sellerRisk, type Seller } from "../src/routes.ts";
import underwriter from "../underwriter.json" with { type: "json" };

const make = (id: string, priceAda: number, p: number, provider: string): Seller => ({ id, name: id, priceAda, provider, payTo: id, endpoint: id, successes: 0, failures: 0, evidence: [], dependencyRiskPenalty: p - 0.2 });
const a = make("seller-a", 8, 0.2, "koios-shared");
const b: Seller = { ...make("seller-b", 10, 0.1, "own-node"), successes: 18, failures: 2, bondDiscount: 0.033333, dependencyRiskPenalty: 0 };
const c = make("seller-c", 8, 0.2, "koios-shared");
const config = underwriter;

test("golden vector cheapest single", () => {
  const result = evaluateRoutes({ downstreamLossAda: 100, candidateSellers: [a], underwriter: config });
  expect(result.routes[0].expectedTotalCostAda).toBeCloseTo(28, 2);
});
test("shared and independent redundant vectors", () => {
  const shared = evaluateRoutes({ downstreamLossAda: 100, candidateSellers: [a, c], constraints: { allowRedundancy: true }, underwriter: config });
  const sharedQuote = shared.routes.find((route) => route.route === "redundant-two")!;
  expect(sharedQuote.jointFailureProbability).toBeCloseTo(0.12, 2);
  expect(sharedQuote.expectedTotalCostAda).toBeCloseTo(28, 2);
  const independent = evaluateRoutes({ downstreamLossAda: 100, candidateSellers: [a, { ...c, provider: "other" }], constraints: { allowRedundancy: true }, underwriter: config });
  const independentQuote = independent.routes.find((route) => route.route === "redundant-two")!;
  expect(independentQuote.jointFailureProbability).toBeCloseTo(0.04, 2);
  expect(independentQuote.expectedTotalCostAda).toBeCloseTo(20, 2);
});
test("underwritten golden vector", () => {
  const result = evaluateRoutes({ downstreamLossAda: 100, candidateSellers: [b], underwriter: config });
  const quote = result.routes.find((route) => route.route === "underwritten-single")!;
  expect(quote.pLoss).toBeCloseTo(0.1, 4);
  expect(quote.pClaim).toBeCloseTo(0.08, 4);
  expect(quote.premiumAda).toBeCloseTo(8.6, 2);
  expect(quote.expectedTotalCostAda).toBeCloseTo(20.6, 2);
});
test("selection changes from underwritten to redundant when provider separates", () => {
  const shared = evaluateRoutes({ downstreamLossAda: 100, candidateSellers: [a, b, c], constraints: { allowRedundancy: true }, underwriter: config });
  expect(shared.selectedRoute).toBe("underwritten-single");
  const independent = evaluateRoutes({ downstreamLossAda: 100, candidateSellers: [a, b, { ...c, provider: "other" }], constraints: { allowRedundancy: true }, underwriter: config });
  expect(independent.selectedRoute).toBe("redundant-two");
  expect(independent.selectedSellers).toEqual(["seller-a", "seller-c"]);
});
test("constraints filter route families", () => {
  const covered = evaluateRoutes({ downstreamLossAda: 100, candidateSellers: [a, b, c], constraints: { allowRedundancy: true, requireCoverage: true }, underwriter: config });
  expect(covered.selectedRoute).toBe("underwritten-single");
  const limited = evaluateRoutes({ downstreamLossAda: 100, candidateSellers: [a, b, c], constraints: { allowRedundancy: true, maxServiceSpendAda: 15 }, underwriter: config });
  expect(limited.routes.filter((route) => route.route === "redundant-two")).toHaveLength(1);
  const tight = evaluateRoutes({ downstreamLossAda: 100, candidateSellers: [a, b, c], constraints: { allowRedundancy: true, maxServiceSpendAda: 9 }, underwriter: config });
  expect(tight.selectedSellers).not.toContain("seller-b");
  expect(tight.alternatives.every((route) => route.servicePriceAda <= 9)).toBe(true);
  expect(() => evaluateRoutes({ downstreamLossAda: 100, candidateSellers: [b], constraints: { maxServiceSpendAda: 5 }, underwriter: config })).toThrow("no route satisfies constraints");
});
test("beta posterior examples", () => {
  expect(sellerRisk({ ...a, successes: 2, failures: 0 }, config)).toMatchObject({ pLoss: 1 / 6, confidence: 12 });
  expect(sellerRisk({ ...a, successes: 1000, failures: 10 }, config).pLoss).toBeCloseTo(12 / 1020, 4);
  expect(sellerRisk({ ...a, successes: 1000, failures: 10 }, config).confidence).toBe(1020);
});
