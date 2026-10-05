import { cardanoscanTx, shortHash } from "@/lib/format";
import { RUN_COMMAND, RUNS_DIR, readRuns } from "@/lib/runs";

const settled = (s: string) => /confirm|success|ok|true|settled/i.test(s);

export async function Runs() {
  const { runs, error } = await readRuns();
  const run = runs[0];
  if (error && !run) {
    return (
      <div role="alert" className="border-l-[6px] border-signal bg-paper-2 p-4">
        <p className="m-0 text-[17px] font-extrabold">The run records could not be read.</p>
        <p className="mt-1 text-[14px] text-muted">{error}</p>
      </div>
    );
  }
  if (!run) {
    return (
      <div className="border-t-[6px] border-ink pt-6">
        <p className="m-0 max-w-[60ch] text-[17px] leading-snug">No run has been recorded in <span className="fig !font-medium">agents/runs</span>. One run locks a claim, buys the route the router picks, waits for the keeper or the deadline, and writes every transaction here with its Koios status.</p>
        <p className="label mt-6">Produce a run, from the repo root</p>
        <pre className="m-0 mt-2 overflow-x-auto border-l-[6px] border-ink bg-paper-2 p-4 text-[14px]"><code>{RUN_COMMAND}</code></pre>
        <p className="mt-3 text-[13px] text-muted">Reading {RUNS_DIR}. Reload after the run finishes.</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-8 border-t-[6px] border-ink pt-6 lg:grid-cols-12" data-testid="run" data-run-file={run.file}>
      <div className="min-w-0 lg:col-span-4">
        <p className="label">Settlement outcome</p>
        {run.outcome.length ? (
          <dl className="m-0 mt-2 border-t border-ink">
            {run.outcome.map((o) => (
              <div key={o.label} className="flex justify-between gap-4 border-b border-rule py-2 text-[14px]"><dt>{o.label}</dt><dd className="fig m-0 break-all text-right">{o.value}</dd></div>
            ))}
          </dl>
        ) : (
          <p className="mt-2 text-[14px] text-muted">This record carries no outcome field.</p>
        )}
        <p className="mt-4 break-all text-[12px] text-muted">{run.file}{run.startedAt ? `, started ${run.startedAt}` : ""}. {runs.length} record{runs.length === 1 ? "" : "s"} in agents/runs.</p>
      </div>
      <ol className="m-0 min-w-0 list-none p-0 lg:col-span-8" aria-label="Transactions in the latest run">
        {run.txs.map((t, i) => (
          <li key={t.hash} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 border-b border-rule py-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto]">
            <span className="fig flex h-8 w-8 items-center justify-center border border-ink">{i + 1}</span>
            <div className="min-w-0">
              <p className="m-0 text-[16px] font-extrabold leading-tight">{t.label || "transaction"}</p>
              {t.detail && <p className="mt-1 text-[14px] text-muted">{t.detail}</p>}
              <a href={cardanoscanTx(t.hash)} target="_blank" rel="noreferrer" className="fig !font-medium mt-1 inline-block break-all">{shortHash(t.hash)}<span className="sr-only"> (opens preprod.cardanoscan.io)</span></a>
            </div>
            <p className={`label col-start-2 mt-2 self-start sm:col-start-3 sm:mt-0 ${settled(t.status) ? "!text-ink" : "!text-signal-ink"}`}>{t.status || "status not recorded"}</p>
          </li>
        ))}
        {run.txs.length === 0 && <li className="py-3 text-[14px] text-muted">This record lists no transactions.</li>}
      </ol>
    </div>
  );
}
