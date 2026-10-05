import { fmt } from "@/lib/format";
import { type RouteResult, rankedRoutes, riskChargeAda, routeLabel, upfrontAda } from "@/lib/router";

export function Verdict({ result, lossAda }: { result: RouteResult; lossAda: number }) {
  const rows = rankedRoutes(result);
  const selected = rows.find((r) => r.route === result.selectedRoute && r.sellers.join(",") === result.selectedSellers.join(","))!;
  const minPrice = Math.min(...rows.map(upfrontAda));
  const cheapest = rows.find((r) => upfrontAda(r) === minPrice)!;
  const won = cheapest === selected;
  const gap = cheapest.riskAdjustedCostAda - selected.riskAdjustedCostAda;
  return (
    <div className="grid grid-cols-1 border-t-[6px] border-ink lg:grid-cols-12" data-testid="verdict" data-selected-route={result.selectedRoute} data-selected-sellers={result.selectedSellers.join("+")}>
      <div className="min-w-0 border-b border-rule py-6 lg:col-span-7 lg:border-b-0 lg:border-r lg:pr-8">
        <p className="label">The router selected, against a downstream loss L of {fmt(lossAda)} ADA</p>
        <h2 className="head mt-2" data-testid="selected-label"><span className="text-muted">{selected.route}</span> {selected.sellers.join(" + ")}</h2>
        <p className="mt-3 max-w-[62ch] text-[17px] leading-snug first-letter:uppercase" data-testid="reason">{result.reason}.</p>
        <p className="mt-3 text-[13px] text-muted">Price {fmt(selected.servicePriceAda)} ADA{selected.premiumAda > 0 ? `, premium ${fmt(selected.premiumAda)} ADA` : ""}. Risk-adjusted cost <span className="fig !text-[13px] text-ink">{fmt(selected.riskAdjustedCostAda)} ADA</span>.</p>
      </div>
      <div className="min-w-0 py-6 lg:col-span-5 lg:pl-8">
        <p className="label !text-signal-ink">{won ? "The lowest price is also the best route" : "The lowest price, rejected"}</p>
        <h2 className="head mt-2"><span className="text-muted">{cheapest.route}</span> {cheapest.sellers.join(" + ")}</h2>
        {won ? (
          <p className="mt-3 text-[17px] leading-snug">At {fmt(upfrontAda(cheapest))} ADA it is the cheapest quote and the cheapest to trust under this buyer.</p>
        ) : (
          <p className="mt-3 text-[17px] leading-snug">
            It costs {fmt(upfrontAda(cheapest))} ADA up front but loses {fmt(cheapest.expectedLossAda)} ADA in expectation on a {fmt(lossAda)} ADA downstream loss
            {riskChargeAda(cheapest) > 0.004 ? `, plus a ${fmt(riskChargeAda(cheapest))} ADA risk charge` : ""}. Its risk-adjusted cost is {fmt(cheapest.riskAdjustedCostAda)} ADA, <b className="font-extrabold">{fmt(gap)} ADA</b> above the selected route.
          </p>
        )}
        <p className="mt-3 text-[13px] text-muted">Ranked {rows.indexOf(cheapest) + 1} of {rows.length}: {routeLabel(cheapest)}.</p>
      </div>
    </div>
  );
}
