import { expect, test } from "bun:test";
import { evaluateRoutes, sellerRisk, type RouteResult, type Seller } from "../src/routes.ts";
import underwriter from "../underwriter.json" with { type: "json" };

const make = (id: string, priceAda: number, provider: string, extra: Partial<Seller> = {}): Seller => ({ id, name: id, priceAda, provider, payTo: id, endpoint: id, successes: 0, failures: 0, evidence: [], dependencyRiskPenalty: 0, ...extra });
const a = make("seller-a", 8, "koios-shared");
const b = make("seller-b", 10, "own-node", { successes: 18, failures: 2, bondDiscount: 0.033333 });
const c = make("seller-c", 8, "koios-shared");
const cIndependent = { ...c, provider: "other" };
const config = underwriter;

const run = (sellers: Seller[], riskAversion: number, constraints = { allowRedundancy: true }, sharedInfrastructure = false): RouteResult => evaluateRoutes({ downstreamLossAda: 100, candidateSellers: sellers, constraints, underwriter: config, riskAversion, sharedInfrastructure });
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

const winner = (r: RouteResult) => find(r, r.selectedRoute, ...r.selectedSellers);
test("2x2 selection table, sharedInfrastructure false", () => {
  const r0 = run([a, b, c], 0);
  expect([r0.selectedRoute, r0.selectedSellers]).toEqual(["redundant", ["seller-a", "seller-b"]]);
  expect(winner(r0).riskAdjustedCostAda).toBeCloseTo(20, 2);
  expect(winner(r0).sdLossAda).toBeCloseTo(14, 2);
  const r25 = run([a, b, c], 0.25);
  expect([r25.selectedRoute, r25.selectedSellers]).toEqual(["redundant", ["seller-a", "seller-b"]]);
  expect(winner(r25).riskAdjustedCostAda).toBeCloseTo(23.5, 2);
});
test("2x2 selection table, sharedInfrastructure true", () => {
  const r0 = run([a, b, c], 0, { allowRedundancy: true }, true);
  expect([r0.selectedRoute, r0.selectedSellers]).toEqual(["single", ["seller-b"]]);
  expect(winner(r0).riskAdjustedCostAda).toBeCloseTo(20, 2);
  const r25 = run([a, b, c], 0.25, { allowRedundancy: true }, true);
  expect([r25.selectedRoute, r25.selectedSellers]).toEqual(["underwritten", ["seller-b"]]);
  expect(winner(r25).riskAdjustedCostAda).toBeCloseTo(25.9, 2);
  const ab = find(r25, "redundant", "seller-a", "seller-b");
  expect(ab.jointFailureProbability).toBeCloseTo(0.08, 4);
  expect(ab.expectedTotalCostAda).toBeCloseTo(26, 2);
  expect(ab.sdLossAda).toBeCloseTo(27.13, 2);
  expect(ab.riskAdjustedCostAda).toBeCloseTo(32.78, 2);
});
test("ties break by lower sd then route id", () => {
  const r = run([a, b, c], 0);
  expect(find(r, "redundant", "seller-b", "seller-c").riskAdjustedCostAda).toBeCloseTo(find(r, "redundant", "seller-a", "seller-b").riskAdjustedCostAda, 2);
  expect(r.alternatives[0].sellers).toEqual(["seller-b", "seller-c"]);
});
test("reason names the mechanism", () => {
  expect(run([a, b, c], 0.25).reason).toContain("sellers fail independently, so a backup keeper (redundant seller-a+seller-b) caps the tail cheaper than coverage");
  expect(run([a, b, c], 0.25, { allowRedundancy: true }, true).reason).toContain("sellers share infrastructure, so backups fail together; coverage caps the 30.00 ADA loss swing of seller-b");
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
