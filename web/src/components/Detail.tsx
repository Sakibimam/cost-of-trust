import { fmt } from "@/lib/format";
import { type RouteResult, rankedRoutes } from "@/lib/router";

const pct = (p: number) => `${(p * 100).toFixed(2)}%`;

export function Detail({ result }: { result: RouteResult }) {
  const s = rankedRoutes(result).find((r) => r.route === result.selectedRoute && r.sellers.join(",") === result.selectedSellers.join(","))!;
  const premium = Object.entries(s.premiumBreakdown);
  const assumptions = Object.entries(result.assumptions).filter(([, v]) => typeof v === "object") as [string, { value?: unknown; alpha0?: number; beta0?: number; status: string }][];
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-8 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-7">
        <p className="label">Arithmetic the router signed</p>
        <p className="fig mt-2 break-words border-l-[6px] border-ink bg-paper-2 p-4 !text-[14px] !font-medium leading-snug" data-testid="arithmetic">{s.arithmetic}</p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[14px] sm:grid-cols-4">
          {([
            ["Loss probability", pct(s.pLoss)],
            ["Loss sd", `${fmt(s.sdLossAda)} ADA`],
            ["Coverage", `${fmt(s.coverageAda)} ADA`],
            ["Quote id", result.quoteId.slice(0, 8)],
          ] as const).map(([k, v]) => (
            <div key={k} className="min-w-0"><dt className="label">{k}</dt><dd className="fig m-0 mt-1">{v}</dd></div>
          ))}
        </dl>
        <p className="mt-4 break-all text-[12px] text-muted">terms hash <span className="fig !text-[12px] !font-medium">{result.termsHash}</span></p>
      </div>
      <div className="min-w-0 lg:col-span-5">
        <p className="label">{premium.length ? "Where the premium goes" : "Premium"}</p>
        {premium.length ? (
          <dl className="m-0 mt-2 border-t border-ink">
            {premium.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-rule py-2 text-[14px]"><dt>{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt><dd className="fig m-0">{fmt(v)}</dd></div>
            ))}
            <div className="flex justify-between gap-4 py-2 text-[14px] font-extrabold"><dt>premium</dt><dd className="fig m-0">{fmt(s.premiumAda)}</dd></div>
          </dl>
        ) : (
          <p className="mt-2 text-[15px] leading-snug text-muted">This route buys no coverage, so no premium is paid. Its protection is the loss probability above.</p>
        )}
        <p className="label mt-6">Inputs and their status</p>
        <ul className="m-0 mt-2 list-none border-t border-ink p-0" aria-label="Router assumptions">
          {assumptions.map(([k, v]) => (
            <li key={k} className="flex justify-between gap-4 border-b border-rule py-2 text-[14px]">
              <span>{k === "prior" ? `prior Beta(${v.alpha0}, ${v.beta0})` : `${k.replace(/([A-Z])/g, " $1").toLowerCase()} ${String(v.value)}`}</span>
              <span className="label shrink-0 !text-ink">{v.status}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
