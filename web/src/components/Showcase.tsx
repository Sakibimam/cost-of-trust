import showcase from "@/data/showcase.json";

type Option = { riskAdjustedCostAda: number; expectedTotalCostAda: number; sellers: string[] } | null;
type Scenario = { taskValueAtRiskAda: number; sharedInfrastructure: boolean; recommendation: string; options: Record<"single" | "redundant" | "staggered" | "underwritten", Option> };
type Agent = { agentName: string; apiHost: string | null; delivery: { paid: number; refunded: number; disputed: number; onTime?: number; late?: number; responseSecondsMedian?: number | null; distinctBuyers?: number }; scenarios: Scenario[] };

const tx = (hash: string) => `https://preprod.cardanoscan.io/transaction/${hash}`;
const ada = (v: number) => `${v.toFixed(2)} ADA`;
const WAYS = [
  ["single", "Hire it alone"],
  ["staggered", "Hire it, backup paid only if it misses"],
  ["redundant", "Hire it and a backup up front"],
  ["underwritten", "Hire it with coverage"],
] as const;
const VERDICT: Record<string, string> = {
  hire_as_is: "Hire it alone",
  hire_with_backup_keeper: "Hire it with a backup",
  require_coverage: "Hire it with coverage",
  do_not_hire: "Do not hire",
  insufficient_data: "Not enough history",
};
const ROUTE_OF: Record<string, keyof Scenario["options"]> = { hire_as_is: "single", require_coverage: "underwritten" };

// Source: web/src/data/showcase.json, written by coworker/scripts/showcase.ts from live mainnet Masumi registry entries,
// their escrow history on Koios and their MIP-003 /availability endpoints.
const agents = (showcase.agents as Agent[]);
const lead = agents.find((a) => a.scenarios.some((s) => s.recommendation !== "do_not_hire")) ?? agents[0];
const trap = agents.find((a) => a.delivery.disputed === 0 && a.delivery.refunded > 0 && a.delivery.paid === 0);
const independent = lead.scenarios.filter((s) => !s.sharedInfrastructure);

function chosen(s: Scenario): keyof Scenario["options"] | null {
  if (s.recommendation === "hire_with_backup_keeper") {
    const backups = (["staggered", "redundant"] as const).filter((k) => s.options[k]);
    return backups.sort((a, b) => s.options[a]!.riskAdjustedCostAda - s.options[b]!.riskAdjustedCostAda)[0] ?? null;
  }
  return ROUTE_OF[s.recommendation] ?? null;
}

// Source: agents/runs/2026-10-07T02-11-35-743Z.json (keeper A on time) and 2026-10-07T02-20-00-676Z.json (keeper A stalled).
const runs = [
  { title: "Keeper A delivers", steps: [["Claim vault locked", "502926e99ddd2f6dd15478ec1994d62ed4bded94936752c0a36fa80ad85325a5"], ["Keeper A paid", "314faaa5dc8c69f75bc53557c43f9832ce6bc833ee7bf80f835ee2dc8ca91f89"], ["Keeper A claims before the checkpoint", "8650e923c2e2fcc0684976a062079c6cea4a3fa809e1f14db1f64cf96b188cb1"]], end: "Backup never contacted. 10 ADA not spent." },
  { title: "Keeper A stalls", steps: [["Claim vault locked", "4488de11cf15ccd060bbf93be00611ca300e820b75afca8b03a6333d8166958d"], ["Keeper A paid, then silent", "791e0480e5a14165a363adb36bd10d283dde7dfd40b16f276f31352e9a837cee"], ["Checkpoint: vault unspent, backup paid", "ae6d7761d845ccff08ac29ff7ecd9beecac9ca34fbea3969ea2eb9c0c0391810"], ["Keeper B claims the job", "2851e9b2df9bfabb621376f446b2dc2fd79944540b7a415cc3140ee63aec638b"]], end: "The buyer paid for a backup only because it was needed." },
];

export function Showcase() {
  return (
    <>
      <section id="buy" aria-labelledby="buy-h" className="scroll-mt-6 border-t border-ink py-12 md:py-16">
        <div className="wrap">
          <p className="label">Live Masumi registry agent, mainnet history</p>
          <h2 id="buy-h" className="mt-2 max-w-[22ch] text-[32px] font-extrabold leading-[1.05] md:text-[40px]">One agent. Four ways to buy the job.</h2>
          <p className="mt-4 max-w-[64ch] text-[17px] leading-[1.45]">A registry ranking has nothing to rank when a field has one agent. The buyer still has a decision: how to pay for this job. {lead.agentName} has {lead.delivery.paid} paid escrows, {lead.delivery.refunded} refunds{lead.delivery.responseSecondsMedian ? ` and a median ${lead.delivery.responseSecondsMedian} s from escrow to result` : ""}. The same record leads to a different purchase as the value at risk grows.</p>
          <div className="mt-8">
            <table className="w-full table-fixed border-collapse text-left text-[13px] sm:text-[15px]">
              <caption className="sr-only">Risk-adjusted cost of each way to buy the job, by value at risk</caption>
              <thead><tr className="border-b-[6px] border-ink"><th scope="col" className="w-[38%] py-2 pr-2 font-extrabold sm:pr-4">Way to buy</th>{independent.map((s) => <th key={s.taskValueAtRiskAda} scope="col" className="py-2 pr-4 text-right font-extrabold">{s.taskValueAtRiskAda} ADA<span className="hidden sm:inline"> at risk</span></th>)}</tr></thead>
              <tbody>
                {WAYS.map(([key, label]) => (
                  <tr key={key} className="border-b border-rule">
                    <th scope="row" className="py-3 pr-2 font-semibold sm:pr-4">{label}</th>
                    {independent.map((s) => {
                      const o = s.options[key]; const pick = chosen(s) === key;
                      return <td key={s.taskValueAtRiskAda} className={`fig py-3 pr-1 text-right sm:pr-4 ${pick ? "font-extrabold !text-ink underline decoration-[3px] underline-offset-4" : "text-muted"}`}>{o ? ada(o.riskAdjustedCostAda) : "n/a"}{pick && <span className="sr-only"> chosen</span>}</td>;
                    })}
                  </tr>
                ))}
                <tr><th scope="row" className="pt-4 pr-4 font-extrabold">Decision</th>{independent.map((s) => <td key={s.taskValueAtRiskAda} className="pt-4 pr-4 text-right font-extrabold">{VERDICT[s.recommendation] ?? s.recommendation}</td>)}</tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[13px] text-muted">Risk-adjusted cost from the router at risk aversion 0.25: fees plus expected loss plus a charge for its spread. Underlined is the purchase Trust Check recommends.</p>
          {trap && (
            <div className="mt-10 grid grid-cols-1 gap-x-10 gap-y-3 border-l-[6px] border-signal bg-paper-2 p-5 lg:grid-cols-12">
              <p className="m-0 font-extrabold lg:col-span-4">A dispute rate would rank {trap.agentName} as flawless.</p>
              <p className="m-0 text-[15px] lg:col-span-8">It has 0 disputes, and 0 paid jobs: all {trap.delivery.refunded} of its escrows ended in refunds. Trust Check reads the escrow outcomes on chain and answers do not hire at every value at risk.</p>
            </div>
          )}
        </div>
      </section>

      <section id="backup" aria-labelledby="backup-h" className="scroll-mt-6 border-t border-ink py-12 md:py-16">
        <div className="wrap grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-4">
            <p className="label">Orchestration, executed on preprod</p>
            <h2 id="backup-h" className="mt-2 max-w-[16ch] text-[28px] font-extrabold leading-[1.1] md:text-[32px]">The backup is paid only if it is needed.</h2>
            <p className="mt-4 max-w-[52ch] text-[17px] leading-[1.45]">The router prices a staggered purchase: keeper A first, keeper B only if A has not claimed by a checkpoint. The buyer agent executes exactly that, reading the claim vault on chain at the checkpoint.</p>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-8 md:grid-cols-2 lg:col-span-8">
            {runs.map((r) => (
              <div key={r.title} className="min-w-0">
                <h3 className="m-0 border-b-[6px] border-ink pb-2 text-[20px] font-extrabold">{r.title}</h3>
                <ol className="m-0 list-none p-0">
                  {r.steps.map(([label, hash]) => {
                    return <li key={label} className="grid grid-cols-1 gap-1 border-b border-rule py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4"><span className="min-w-0 font-semibold">{label}</span>{hash ? <a href={tx(hash)} className="fig break-all !font-medium">{hash.slice(0, 10)}…{hash.slice(-4)}</a> : null}</li>;
                  })}
                </ol>
                <p className="mt-3 text-[15px] font-semibold">{r.end}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
