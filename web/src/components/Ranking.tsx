"use client";

import { useState } from "react";
import { fmt } from "@/lib/format";
import { type RouteQuote, type RouteResult, rankedRoutes, riskChargeAda, routeGloss, routeKey, routeNames, upfrontAda } from "@/lib/router";

const niceMax = (v: number) => Math.max(10, Math.ceil(v / 10) * 10);
const COLLAPSED_ROWS = 3;

export function Legend({ riskAversion }: { riskAversion: number }) {
  const items = [
    ["seg-price", "Price", "what the seller charges"],
    ["seg-premium", "Premium", "what coverage costs"],
    ["seg-loss", "Expected loss", "chance the keeper fails times L"],
    ["seg-risk", "Risk charge", `${riskAversion} x the typical swing of the loss`],
  ] as const;
  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-2 p-0 text-[13px] xs:grid-cols-2 lg:grid-cols-4">
      {items.map(([cls, name, def]) => (
        <li key={name} className="flex items-start gap-2">
          <span aria-hidden className={`mt-[3px] h-3 w-5 shrink-0 ${cls}`} />
          <span><b className="font-semibold">{name}</b> <span className="text-muted">{def}</span></span>
        </li>
      ))}
    </ul>
  );
}

function Figures({ r }: { r: RouteQuote }) {
  const parts = [
    ["seg-price", "price", r.servicePriceAda],
    ["seg-premium", "premium", r.premiumAda],
    ["seg-loss", "expected loss", r.expectedLossAda],
    ["seg-risk", "risk charge", riskChargeAda(r)],
  ] as const;
  return (
    <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
      {parts.map(([cls, name, v]) => (
        <span key={name} className="fig inline-flex items-center gap-1 !text-[13px] !font-medium">
          <span aria-hidden className={`h-2.5 w-2.5 ${cls}`} />
          <span className="sr-only">{name} </span>{fmt(v)}
        </span>
      ))}
    </p>
  );
}

function Bar({ r, axis }: { r: RouteQuote; axis: number }) {
  const segs = [["seg-price", r.servicePriceAda], ["seg-premium", r.premiumAda], ["seg-loss", r.expectedLossAda], ["seg-risk", Math.max(riskChargeAda(r), 0)]] as const;
  return (
    <div className="relative h-8 w-full" style={{ backgroundImage: `repeating-linear-gradient(to right, var(--color-rule) 0 1px, transparent 1px calc(100% / ${axis / 10}))` }}>
      <div className="grow bar-t flex h-full" style={{ width: `${(r.riskAdjustedCostAda / axis) * 100}%` }}>
        {segs.map(([cls, v]) => <div key={cls} className={`bar-t ${cls}`} style={{ flexGrow: v < 0.004 ? 0 : v, flexShrink: 1, flexBasis: 0 }} />)}
      </div>
    </div>
  );
}

export function Ranking({ result, riskAversion, names }: { result: RouteResult; riskAversion: number; names: Record<string, string> }) {
  const [showAll, setShowAll] = useState(false);
  const ranked = rankedRoutes(result);
  const rankOf = new Map(ranked.map((r, i) => [routeKey(r), i]));
  const axis = niceMax(Math.max(...ranked.map((r) => r.riskAdjustedCostAda)));
  const minUpfront = Math.min(...ranked.map(upfrontAda));
  const ticks = Array.from({ length: axis / 10 + 1 }, (_, i) => i * 10);
  const selectedKey = routeKey({ route: result.selectedRoute, sellers: result.selectedSellers });
  return (
    <div>
      <Legend riskAversion={riskAversion} />
      <div className="mt-6 hidden grid-cols-[2.5rem_minmax(0,17rem)_minmax(0,1fr)_8rem] gap-x-4 border-b border-ink pb-2 pl-[14px] md:grid" aria-hidden>
        <span />
        <span className="label">Route</span>
        <span className="relative h-4">
          {ticks.map((t) => <span key={t} className="label absolute top-0 -translate-x-1/2 first:translate-x-0 last:-translate-x-full" style={{ left: `${(t / axis) * 100}%` }}>{t}</span>)}
        </span>
        <span className="label text-right">True cost</span>
      </div>
      <ol id="route-list" className="m-0 mt-6 flex list-none flex-col p-0 md:mt-0" aria-label="Routes, best first. Each row states its rank.">
        {result.routes.map((r) => {
          const key = routeKey(r);
          const rank = rankOf.get(key) ?? 0;
          const selected = key === selectedKey;
          const lowest = upfrontAda(r) === minUpfront;
          return (
            <li key={key} data-route={r.route} data-sellers={r.sellers.join("+")} data-selected={selected} data-rank={rank + 1} data-total={r.riskAdjustedCostAda.toFixed(2)} style={{ order: rank }}
              className={`grid-cols-[2rem_minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-b border-rule border-l-[6px] py-3 pl-2 md:grid-cols-[2.5rem_minmax(0,17rem)_minmax(0,1fr)_8rem] md:items-start md:gap-x-4 ${rank >= COLLAPSED_ROWS && !showAll ? "hidden sm:grid" : "grid"} ${selected ? "border-l-ink bg-paper-2" : "border-l-transparent"}`}>
              <span className={`fig flex h-8 w-8 items-center justify-center ${selected ? "bg-ink text-paper" : "border border-ink"}`}><span className="sr-only">Rank </span>{rank + 1}</span>
              <div className="min-w-0">
                <p className="m-0 text-[16px] font-extrabold leading-tight"><span className="text-muted">{r.route}</span> {routeNames(r, names)}</p>
                {r.route === "staggered" && <p className="m-0 mt-1 text-[13px] leading-snug text-muted" data-testid="staggered-gloss">{routeGloss(r, names)}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {selected && <span className="label !text-ink">Chosen</span>}
                  {lowest && <span className={`label ${selected ? "!text-ink" : "!text-signal-ink"}`}>{selected ? "Also lowest price" : "Lowest price, rejected"}</span>}
                </div>
              </div>
              <p className="m-0 self-start text-right md:order-4"><span className={selected ? "text-[22px] font-extrabold" : "fig text-[17px]"}>{fmt(r.riskAdjustedCostAda)}</span><span className="label ml-1">ADA</span></p>
              <div className="col-span-3 col-start-1 min-w-0 md:order-3 md:col-span-1 md:col-start-auto"><Bar r={r} axis={axis} /><div className="mt-2"><Figures r={r} /></div></div>
            </li>
          );
        })}
      </ol>
      <button type="button" aria-expanded={showAll} aria-controls="route-list" onClick={() => setShowAll((v) => !v)} className="btn mt-4 w-full sm:hidden">
        {showAll ? `Show the top ${COLLAPSED_ROWS} routes only` : `Show all ${ranked.length} routes`}
      </button>
      <p className="mt-3 text-[13px] text-muted">Bar length is true cost on one shared axis, 0 to {axis} ADA, gridlines every 10 ADA. True cost = price + premium + expected loss + risk charge.</p>
    </div>
  );
}
