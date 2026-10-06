"use client";

import { useEffect, useState } from "react";
import { fmt } from "@/lib/format";
import { fetchBestRoute, routeNames, type RouteResult } from "@/lib/router";

export function SelectionMap({ sellers, names }: { sellers: string[]; names: Record<string, string> }) {
  const [cells, setCells] = useState<Array<{ risk: number; shared: boolean; result: RouteResult }> | null>(null);
  useEffect(() => {
    if (sellers.length === 0) return;
    const ctl = new AbortController();
    Promise.all([0, 0.5].flatMap((risk) => [false, true].map(async (shared) => ({ risk, shared, result: await fetchBestRoute({ downstreamLossAda: 100, riskAversion: risk, sharedInfrastructure: shared, candidateSellers: sellers }, ctl.signal) })))).then(setCells).catch(() => setCells([]));
    return () => ctl.abort();
  }, [sellers.join(",")]);
  return (
    <div className="border-t-[6px] border-ink" data-testid="selection-map">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-b border-rule text-[13px] font-semibold">
        <p className="m-0 border-r border-rule p-3">Independent infrastructure</p><p className="m-0 p-3">Shared infrastructure</p>
      </div>
      {!cells ? <p className="m-0 p-4 text-muted">Reading the four live router choices.</p> : cells.length === 0 ? <p className="m-0 p-4 text-muted">The live router map could not be read.</p> : (
        <div className="grid grid-cols-2">
          {[0, 0.5].map((risk) => <div key={risk} className="contents">
            {[false, true].map((shared) => {
              const cell = cells.find((item) => item.risk === risk && item.shared)!;
              const selected = cell.result.routes.find((r) => r.route === cell.result.selectedRoute && r.sellers.join(",") === cell.result.selectedSellers.join(","))!;
              return <div key={`${risk}-${shared}`} className="border-b border-r border-rule p-4 last:border-r-0"><p className="label">{risk === 0 ? "Can absorb a loss" : "Cannot absorb a loss"}</p><p className="m-0 mt-2 font-extrabold">{selected.route} {routeNames(selected, names)}</p><p className="m-0 mt-1 text-[14px] text-muted">{fmt(selected.riskAdjustedCostAda)} ADA risk-adjusted cost</p></div>;
            })}
          </div>)}
        </div>
      )}
    </div>
  );
}
