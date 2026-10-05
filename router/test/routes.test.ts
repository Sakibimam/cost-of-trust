import { expect, test } from "bun:test";
import { evaluateRoutes, sellerRisk, type RouteResult, type Seller } from "../src/routes.ts";
import underwriter from "../underwriter.json" with { type: "json" };

const make = (id: string, priceAda: number, provider: string, extra: Partial<Seller> = {}): Seller => ({ id, name: id, priceAda, provider, payTo: id, endpoint: id, successes: 0, failures: 0, evidence: [], dependencyRiskPenalty: 0, ...extra });
const a = make("seller-a", 8, "koios-shared");
const b = make("seller-b", 10, "own-node", { successes: 18, failures: 2, bondDiscount: 0.033333 });
const c = make("seller-c", 8, "koios-shared");
const cIndependent = { ...c, provider: "other" };
const config = underwriter;

const run = (sellers: Seller[], riskAversion: number, constraints = { allowRedundancy: true }): RouteResult => evaluateRoutes({ downstreamLossAda: 100, candidateSellers: sellers, constraints, underwriter: config, riskAversion });
const find = (result: RouteResult, route: string, ...ids: string[]) => {
  const hit = result.routes.find((r) => r.route === route && r.sellers.join("+") === ids.join("+"));
  if (!hit) throw new Error(`missing route ${route} ${ids}`);
  return hit;
};

const table: [string, string, string[], boolean, number, number, number, number][] = [
  ["single A", "single", ["seller-a"], false, 28, 40, 28, 38],
  ["single B", "single", ["seller-b"], false, 20, 30, 20, 27.5],
  ["redundant A+C shared", "redundant", ["seller-a", "seller-c"], false, 28, 32.5, 28, 36.12],
  ["redundant A+C independent", "redundant", ["seller-a", "seller-c"], true, 20, 19.6, 20, 24.9],
  ["underwritten B", "underwritten", ["seller-b"], false, 22.2, 14.8, 22.2, 25.9],
];
for (const [name, route, ids, independent, mean, sd, lambda0, lambda25] of table) {
  test(`golden ${name}`, () => {
    const sellers = independent ? [a, b, cIndependent] : [a, b, c];
    const zero = find(run(sellers, 0), route, ...ids);
    const quarter = find(run(sellers, 0.25), route, ...ids);
    expect(zero.expectedTotalCostAda).toBeCloseTo(mean, 2);
    expect(zero.sdLossAda).toBeCloseTo(sd, 2);
    expect(zero.riskAdjustedCostAda).toBeCloseTo(lambda0, 2);
    expect(quarter.riskAdjustedCostAda).toBeCloseTo(lambda25, 2);
  });
}

test("underwritten B premium and covered expected loss", () => {
  const q = find(run([a, b, c], 0), "underwritten", "seller-b");
  expect(q.premiumAda).toBeCloseTo(8.6, 2);
  expect(q.expectedLossAda).toBeCloseTo(3.6, 2);
  expect(q.sdLossAda).toBeCloseTo(14.8, 2);
  expect(q.pClaim).toBeCloseTo(0.08, 4);
});

test("every route is quoted, none pruned", () => {
  const result = run([a, b, c], 0);
  expect(result.routes).toHaveLength(3 + 3 + 3);
  expect(run([a, b, c], 0, { allowRedundancy: false }).routes).toHaveLength(6);
});

// SPEC section 3 selections name single B / underwritten B / redundant A+C as winners. With every pair quoted,
// redundant A+B and B+C (independent providers, pJ 0.02, sd 14.00) cost 20.00 at lambda 0 and 23.50 at 0.25 and beat all of them.
// These tests pin the measured winners and the spec's named route values.
test("four selections as computed with every route quoted", () => {
  for (const [sellers, lambda, cost, sdWinner] of [[[a, b, c], 0, 20, 14], [[a, b, cIndependent], 0, 20, 14], [[a, b, c], 0.25, 23.5, 14], [[a, b, cIndependent], 0.25, 23.5, 14]] as const) {
    const r = run([...sellers], lambda);
    expect(r.selectedRoute).toBe("redundant");
    expect(r.selectedSellers).toContain("seller-b");
    const winner = find(r, "redundant", ...r.selectedSellers);
    expect(winner.riskAdjustedCostAda).toBeCloseTo(cost, 2);
    expect(winner.sdLossAda).toBeCloseTo(sdWinner, 2);
  }
  expect(find(run([a, b, c], 0.25), "underwritten", "seller-b").riskAdjustedCostAda).toBeCloseTo(25.9, 2);
  expect(find(run([a, b, cIndependent], 0.25), "redundant", "seller-a", "seller-c").riskAdjustedCostAda).toBeCloseTo(24.9, 2);
});

test("risk-neutral tie goes to lower sd, and coverage wins when the cheaper routes are removed", () => {
  const r = run([a, b, c], 0);
  expect(find(r, "single", "seller-b").riskAdjustedCostAda).toBeCloseTo(find(r, "redundant", "seller-a", "seller-b").riskAdjustedCostAda, 2);
  expect(r.selectedSellers).toEqual(["seller-a", "seller-b"]);
  const covered = run([a, b, c], 0.25, { allowRedundancy: false });
  expect([covered.selectedRoute, covered.selectedSellers]).toEqual(["underwritten", ["seller-b"]]);
  expect(covered.reason).toContain("coverage wins because riskAversion 0.25 penalises the 30.00 ADA loss sd of single seller-b");
  expect(run([a, b, c], 0, { allowRedundancy: false }).reason).toContain("minimum risk-adjusted cost 20.00");
});

test("constraints filter route families", () => {
  const covered = run([a, b, c], 0, { allowRedundancy: true, requireCoverage: true } as never);
  expect(covered.selectedRoute).toBe("underwritten");
  const capped = run([a, b, c], 0, { allowRedundancy: true, maxServiceSpendAda: 9 } as never);
  expect(capped.selectedSellers).not.toContain("seller-b");
  expect(capped.alternatives.every((r) => r.servicePriceAda <= 9)).toBe(true);
  expect(() => evaluateRoutes({ downstreamLossAda: 100, candidateSellers: [b], constraints: { maxServiceSpendAda: 5 }, underwriter: config })).toThrow("no route satisfies constraints");
  expect(() => evaluateRoutes({ downstreamLossAda: 100, candidateSellers: [b], underwriter: config, riskAversion: -1 })).toThrow("riskAversion");
});

test("beta posterior examples", () => {
  expect(sellerRisk({ ...a, successes: 2, failures: 0 }, config)).toMatchObject({ pLoss: 1 / 6, confidence: 12 });
  expect(sellerRisk({ ...a, successes: 1000, failures: 10 }, config).pLoss).toBeCloseTo(12 / 1020, 4);
  expect(sellerRisk({ ...a, successes: 1000, failures: 10 }, config).confidence).toBe(1020);
});
