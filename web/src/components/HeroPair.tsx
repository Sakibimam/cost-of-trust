import { fmt } from "@/lib/format";
import { type RouteQuote, type RouteResult, rankedRoutes, routeNames, upfrontAda } from "@/lib/router";

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="label">{label}</p>
      <p className="m-0 mt-1 text-[clamp(56px,6.4vw,96px)] font-extrabold leading-[0.92] tracking-[-0.05em]" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(value)}</p>
    </div>
  );
}

function Card({ tone, label, r, names, note }: { tone: "ink" | "signal"; label: string; r: RouteQuote; names: Record<string, string>; note: string }) {
  return (
    <article className={`min-w-0 border-t-[6px] pt-3 ${tone === "ink" ? "border-ink" : "border-signal"}`} data-testid={tone === "ink" ? "hero-chosen" : "hero-rejected"}>
      <p className={`label ${tone === "signal" ? "!text-signal-ink" : ""}`}>{label}</p>
      <p className="m-0 mt-1 text-[15px] font-semibold leading-snug"><span className="text-muted">{r.route}</span> {routeNames(r, names)}</p>
      <div className="mt-4 grid grid-cols-2 gap-x-4">
        <Figure label="Paid, ADA" value={r.servicePriceAda} />
        <Figure label="True cost, ADA" value={r.riskAdjustedCostAda} />
      </div>
      <p className="m-0 mt-3 text-[13px] leading-snug text-muted">{note}</p>
    </article>
  );
}

export function HeroPair({ result, names }: { result: RouteResult; names: Record<string, string> }) {
  const rows = rankedRoutes(result);
  const selected = rows.find((r) => r.route === result.selectedRoute && r.sellers.join(",") === result.selectedSellers.join(","))!;
  const cheapest = rows.filter((r) => r.route === "single").sort((a, b) => upfrontAda(a) - upfrontAda(b))[0];
  const won = cheapest === selected;
  const note = (r: RouteQuote) => `${r.premiumAda > 0 ? `Plus ${fmt(r.premiumAda)} premium for cover. ` : ""}True cost adds the expected loss and the risk charge.`;
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2" aria-label="The chosen route against the cheapest quote">
      <Card tone="ink" label="The router chose" r={selected} names={names} note={note(selected)} />
      {won ? (
        <article className="min-w-0 border-t-[6px] border-signal pt-3">
          <p className="label !text-signal-ink">The lowest price</p>
          <p className="m-0 mt-3 text-[17px] leading-snug">The cheapest quote is also the cheapest to trust for this buyer. Nothing cheaper was rejected.</p>
        </article>
      ) : (
        <Card tone="signal" label="CHEAPEST QUOTE, REJECTED" r={cheapest} names={names} note={note(cheapest)} />
      )}
    </div>
  );
}
