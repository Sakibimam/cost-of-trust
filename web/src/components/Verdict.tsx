import { fmt } from "@/lib/format";
import { routeGloss, type RouteQuote, type RouteResult, rankedRoutes, riskChargeAda, routeNames, upfrontAda } from "@/lib/router";

const TIE_ADA = 0.005; // same threshold the router uses to call two risk-adjusted costs a tie

function tieBreak(selected: RouteQuote, ranked: RouteQuote[], names: Record<string, string>): string | null {
  const tied = ranked.slice(1).filter((r) => Math.abs(selected.riskAdjustedCostAda - r.riskAdjustedCostAda) < TIE_ADA);
  if (tied.length === 0) return null;
  const label = (r: RouteQuote) => `${r.route} ${routeNames(r, names)}`;
  const cost = fmt(selected.riskAdjustedCostAda);
  const apart = tied.find((r) => Math.abs(selected.sdLossAda - r.sdLossAda) >= TIE_ADA);
  if (apart) return `Tied with ${label(apart)} at ${cost}; chosen because its loss swing is ${fmt(selected.sdLossAda)} vs ${fmt(apart.sdLossAda)} ADA.`;
  return `Tied with ${label(tied[0])} at ${cost} on cost and on loss swing (${fmt(selected.sdLossAda)} ADA); the router breaks the tie by name.`;
}

export function Verdict({ result, lossAda, names }: { result: RouteResult; lossAda: number; names: Record<string, string> }) {
  const rows = rankedRoutes(result);
  const selected = rows.find((r) => r.route === result.selectedRoute && r.sellers.join(",") === result.selectedSellers.join(","))!;
  const cheapest = rows.filter((r) => r.route === "single").sort((a, b) => upfrontAda(a) - upfrontAda(b))[0];
  const won = cheapest === selected;
  const gap = cheapest.riskAdjustedCostAda - selected.riskAdjustedCostAda;
  const tie = tieBreak(selected, rows, names);
  return (
    <div className="grid grid-cols-1 border-t-[6px] border-ink lg:grid-cols-12" data-testid="verdict" data-selected-route={result.selectedRoute} data-selected-sellers={result.selectedSellers.join("+")}>
      <div className="min-w-0 border-b border-rule py-6 lg:col-span-7 lg:border-b-0 lg:border-r lg:pr-8">
        <p className="label">Why it won, against a downstream loss L of {fmt(lossAda)} ADA</p>
        <h2 className="m-0 mt-2 text-[22px] font-extrabold leading-tight" data-testid="selected-label"><span className="text-muted">{selected.route}</span> {routeNames(selected, names)}</h2>
        <p className="mt-1 text-[14px] text-muted">{routeGloss(selected, names)}</p>
        <p className="mt-3 max-w-[62ch] text-[17px] leading-snug first-letter:uppercase" data-testid="reason">{result.reason}.</p>
        {tie && <p className="mt-3 max-w-[62ch] border-l-[6px] border-ink bg-paper-2 p-3 text-[15px] leading-snug" data-testid="tie-break">{tie}</p>}
      </div>
      <div className="min-w-0 py-6 lg:col-span-5 lg:pl-8">
        <p className="label !text-signal-ink">{won ? "The lowest price is also the best route" : "Why the cheapest quote lost"}</p>
        <h2 className="m-0 mt-2 text-[22px] font-extrabold leading-tight"><span className="text-muted">{cheapest.route}</span> {routeNames(cheapest, names)}</h2>
        {won ? (
          <p className="mt-3 text-[17px] leading-snug">At {fmt(upfrontAda(cheapest))} ADA it is the cheapest quote and the cheapest to trust under this buyer.</p>
        ) : (
          <p className="mt-3 text-[17px] leading-snug">
            It costs {fmt(upfrontAda(cheapest))} ADA up front but loses {fmt(cheapest.expectedLossAda)} ADA in expectation on a {fmt(lossAda)} ADA downstream loss
            {riskChargeAda(cheapest) > 0.004 ? `, plus a ${fmt(riskChargeAda(cheapest))} ADA risk charge` : ""}. Its true cost is {fmt(cheapest.riskAdjustedCostAda)} ADA, <b className="font-extrabold">{fmt(gap)} ADA</b> above the chosen route.
          </p>
        )}
        <p className="mt-3 text-[13px] text-muted">Ranked {rows.indexOf(cheapest) + 1} of {rows.length}.</p>
      </div>
    </div>
  );
}
