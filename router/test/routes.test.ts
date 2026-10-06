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
  expect(result.routes).toHaveLength(3 + 3 + 6 + 3);
  expect(run([a, b, c], 0, { allowRedundancy: false }).routes).toHaveLength(6);
});

const winner = (r: RouteResult) => find(r, r.selectedRoute, ...r.selectedSellers);
// the pre-staggered SPEC tables rank single, redundant and underwritten routes; staggered is asserted separately below
const noStagger = (r: RouteResult) => { const w = [{ route: r.selectedRoute, sellers: r.selectedSellers }, ...r.alternatives].find((x) => x.route !== "staggered")!; return { ...r, selectedRoute: w.route, selectedSellers: w.sellers, reason: r.reason }; };
test("2x2 selection table, sharedInfrastructure false", () => {
  const r0 = noStagger(run([a, b, c], 0));
  expect([r0.selectedRoute, r0.selectedSellers]).toEqual(["redundant", ["seller-a", "seller-b"]]);
  expect(winner(r0).riskAdjustedCostAda).toBeCloseTo(20, 2);
  expect(winner(r0).sdLossAda).toBeCloseTo(14, 2);
  const r25 = noStagger(run([a, b, c], 0.25));
  expect([r25.selectedRoute, r25.selectedSellers]).toEqual(["redundant", ["seller-a", "seller-b"]]);
  expect(winner(r25).riskAdjustedCostAda).toBeCloseTo(23.5, 2);
});
test("2x2 selection table, sharedInfrastructure true", () => {
  const r0 = noStagger(run([a, b, c], 0, { allowRedundancy: true }, true));
  expect([r0.selectedRoute, r0.selectedSellers]).toEqual(["single", ["seller-b"]]);
  expect(winner(r0).riskAdjustedCostAda).toBeCloseTo(20, 2);
  const r25 = noStagger(run([a, b, c], 0.25, { allowRedundancy: true }, true));
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
  const redundants = [r.selectedRoute === "redundant" ? { sellers: r.selectedSellers } : null, ...r.alternatives.filter((x) => x.route === "redundant")].filter(Boolean);
  expect(find(r, "redundant", "seller-b", "seller-c").riskAdjustedCostAda).toBeCloseTo(find(r, "redundant", "seller-a", "seller-b").riskAdjustedCostAda, 2);
  expect(redundants.length).toBeGreaterThan(0);
  const order = r.alternatives.filter((x) => x.route === "redundant").map((x) => x.sellers.join("+"));
  expect(order.indexOf("seller-a+seller-b")).toBeLessThan(order.indexOf("seller-b+seller-c"));
  // a staggered schedule undercuts both parallel backups once quoted: A>B total 11.10 vs redundant A+B 20.00
  expect(r.selectedRoute).toBe("staggered");
});
test("reason names the mechanism", () => {
  expect(run([a, b, c], 0.25).reason).toContain("sellers fail independently, so an escrowed schedule (seller-a first, seller-b as late backup)");
  expect(run([a, b, c], 0.25, { allowRedundancy: true }, true).reason).toContain("sellers share infrastructure, so the late keeper is correlated");
  const cover = run([a, b, c], 0.25, { allowRedundancy: false }, true);
  expect(cover.reason).toContain("sellers share infrastructure, so backups fail together; coverage caps the 30.00 ADA loss sd of seller-b");
});

test("constraints filter route families", () => {
  const covered = run([a, b, c], 0, { allowRedundancy: true, requireCoverage: true } as never);
  expect(covered.selectedRoute).toBe("underwritten");
  // at riskAversion 0 coverage never wins on cost, so a forced pick must say so instead of claiming coverage is cheapest
  expect(covered.forcedByConstraints).toBe(true);
  expect(covered.reason).toStartWith("coverage required by buyer");
  const free = run([a, b, c], 0, { allowRedundancy: true } as never);
  expect(free.forcedByConstraints).toBe(false);
  const capped = run([a, b, c], 0, { allowRedundancy: true, maxServiceSpendAda: 9 } as never);
  expect(capped.routes.filter((x) => x.route !== "staggered" && x.servicePriceAda > 9).length).toBeGreaterThan(0);
  expect([capped.selectedRoute, ...capped.alternatives.map((x) => x.route)].length).toBeGreaterThan(0);
  expect(capped.alternatives.every((x) => x.servicePriceAda <= 9)).toBe(true);
  expect(capped.selectedSellers).toEqual(["seller-a", "seller-b"]);
  expect(capped.alternatives.every((r) => r.servicePriceAda <= 9)).toBe(true);
  expect(() => evaluateRoutes({ downstreamLossAda: 100, candidateSellers: [b], constraints: { maxServiceSpendAda: 5 }, underwriter: config })).toThrow("no route satisfies constraints");
  expect(() => evaluateRoutes({ downstreamLossAda: 100, candidateSellers: [b], underwriter: config, riskAversion: -1 })).toThrow("riskAversion");
});

test("beta posterior examples", () => {
  expect(sellerRisk({ ...a, successes: 2, failures: 0 }, config)).toMatchObject({ pLoss: 1 / 6, confidence: 12 });
  expect(sellerRisk({ ...a, successes: 1000, failures: 10 }, config).pLoss).toBeCloseTo(12 / 1020, 4);
  expect(sellerRisk({ ...a, successes: 1000, failures: 10 }, config).confidence).toBe(1020);
});

// staggered(a,b), L = 100, lateSlotPenalty 0.05. pbLate = pb + 0.05.
// fee = price_a*(1-pa) + price_b*pa*(1-pbLate); loss L w.p. pJ; sd = L*sqrt(pJ(1-pJ)); rho 0.5 when shared.
// Independent world (sharedInfrastructure false, A and B on different providers):
//  A then B: pa 0.2, pbLate 0.15. fee 8*0.8 + 10*0.2*0.85 = 6.4 + 1.7 = 8.10. pJ 0.2*0.15 = 0.03. E 3.00. total 11.10.
//            sd 100*sqrt(0.03*0.97) = 17.06. lambda 0.25: 11.10 + 4.26 = 15.36.
//  B then A: pa 0.1, pbLate 0.25. fee 10*0.9 + 8*0.1*0.75 = 9.00 + 0.60 = 9.60. pJ 0.1*0.25 = 0.025. E 2.50. total 12.10.
//            sd 100*sqrt(0.025*0.975) = 15.61. lambda 0.25: 12.10 + 3.90 = 16.00.
// Shared world (sharedInfrastructure true):
//  A then B: pJ 0.03 + 0.5*sqrt(0.2*0.8*0.15*0.85) = 0.03 + 0.5*0.14283 = 0.10141. E 10.14. total 8.10 + 10.14 = 18.24.
//            sd 100*sqrt(0.10141*0.89859) = 30.19. lambda 0.25: 18.24 + 7.55 = 25.79.
//  B then A: pJ 0.025 + 0.5*sqrt(0.1*0.9*0.25*0.75) = 0.025 + 0.5*0.12990 = 0.08995. E 9.00 (8.995). total 9.60 + 8.995 = 18.60.
//            sd 100*sqrt(0.08995*0.91005) = 28.61. lambda 0.25: 18.60 + 7.15 = 25.75.
test("staggered hand-computed vectors", () => {
  for (const [shared, ab, ba] of [[false, [8.1, 0.03, 11.1, 17.06, 15.36], [9.6, 0.025, 12.1, 15.61, 16.0]], [true, [8.1, 0.10141, 18.24, 30.19, 25.79], [9.6, 0.08995, 18.6, 28.61, 25.75]]] as const) {
    const r0 = run([a, b, c], 0, { allowRedundancy: true }, shared);
    const r25 = run([a, b, c], 0.25, { allowRedundancy: true }, shared);
    for (const [ids, [fee, pj, total, sd, ra25]] of [[["seller-a", "seller-b"], ab], [["seller-b", "seller-a"], ba]] as const) {
      const q = find(r0, "staggered", ...ids);
      expect(q.servicePriceAda).toBeCloseTo(fee, 2);
      expect(q.jointFailureProbability).toBeCloseTo(pj, 4);
      expect(q.expectedTotalCostAda).toBeCloseTo(total, 2);
      expect(q.sdLossAda).toBeCloseTo(sd, 2);
      expect(find(r25, "staggered", ...ids).riskAdjustedCostAda).toBeCloseTo(ra25, 2);
    }
  }
});

test("staggered selection in the four quadrants", () => {
  const pick = (lambda: number, shared: boolean) => { const r = run([a, b, c], lambda, { allowRedundancy: true }, shared); return [r.selectedRoute, r.selectedSellers.join(">"), +winner(r).riskAdjustedCostAda.toFixed(2)]; };
  expect(pick(0, false)).toEqual(["staggered", "seller-a>seller-b", 11.1]);
  expect(pick(0.25, false)).toEqual(["staggered", "seller-a>seller-b", 15.36]);
  expect(pick(0, true)).toEqual(["staggered", "seller-a>seller-b", 18.24]);
  expect(pick(0.25, true)).toEqual(["staggered", "seller-b>seller-a", 25.75]);
});
