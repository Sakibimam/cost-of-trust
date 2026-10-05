import { cardanoscanTx, shortHash } from "@/lib/format";
import { RUN_COMMAND, buyerAgentExists, readRuns, stepWords } from "@/lib/runs";

export async function Runs() {
  const [{ runs, error }, hasBuyer] = await Promise.all([readRuns(), buyerAgentExists()]);
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
        {hasBuyer ? (
          <>
            <p className="m-0 max-w-[60ch] text-[17px] leading-snug">No run is recorded yet. One run locks a claim, buys the route the router picks, waits for the keeper or the deadline, and lists every transaction here with its confirmation.</p>
            <p className="label mt-6">Produce a run, from the repo root</p>
            <pre className="m-0 mt-2 overflow-x-auto border-l-[6px] border-ink bg-paper-2 p-4 text-[14px]"><code>{RUN_COMMAND}</code></pre>
          </>
        ) : (
          <p className="m-0 max-w-[60ch] text-[17px] leading-snug">Agent runs appear here once the buyer agent has paid a keeper on preprod.</p>
        )}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-8 border-t-[6px] border-ink pt-6 lg:grid-cols-12" data-testid="run" data-run-file={run.file}>
      <div className="min-w-0 lg:col-span-4">
        <p className="label">Settlement outcome</p>
        <dl className="m-0 mt-2 border-t border-ink">
          {run.route && <div className="flex justify-between gap-4 border-b border-rule py-2 text-[14px]"><dt>route taken</dt><dd className="fig m-0 text-right">{run.route}</dd></div>}
          <div className="flex justify-between gap-4 border-b border-rule py-2 text-[14px]"><dt>transactions confirmed</dt><dd className="fig m-0 text-right">{run.txs.filter((t) => t.confirmed).length} of {run.txs.length}</dd></div>
          {run.ingest && <div className="flex justify-between gap-4 border-b border-rule py-2 text-[14px]"><dt>outcome</dt><dd className="fig m-0 text-right">{run.ingest}</dd></div>}
          {run.problems.map((p) => <div key={p.step} className="border-b border-rule py-2 text-[14px] !text-signal-ink"><dt className="font-semibold">{stepWords(p.step)}</dt><dd className="m-0 break-words">{p.error}</dd></div>)}
        </dl>
        <p className="mt-4 break-all text-[12px] text-muted">{run.file}{run.startedAt ? `, started ${run.startedAt}` : ""}. {runs.length} record{runs.length === 1 ? "" : "s"}.</p>
      </div>
      <ol className="m-0 min-w-0 list-none p-0 lg:col-span-8" aria-label="Transactions in the latest run">
        {run.txs.map((t, i) => (
          <li key={t.hash} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 border-b border-rule py-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto]">
            <span className="fig flex h-8 w-8 items-center justify-center border border-ink">{i + 1}</span>
            <div className="min-w-0">
              <p className="m-0 text-[16px] font-extrabold leading-tight">{stepWords(t.step)}</p>
              <a href={cardanoscanTx(t.hash)} target="_blank" rel="noreferrer" className="fig mt-1 inline-block break-all !font-medium">{shortHash(t.hash)}<span className="sr-only"> (opens preprod.cardanoscan.io)</span></a>
            </div>
            <p className={`label col-start-2 mt-2 self-start sm:col-start-3 sm:mt-0 ${t.confirmed ? "!text-ink" : "!text-signal-ink"}`}>{t.confirmed ? "Confirmed on preprod" : "Not confirmed"}</p>
          </li>
        ))}
        {run.txs.length === 0 && <li className="py-3 text-[14px] text-muted">This record lists no transactions.</li>}
      </ol>
    </div>
  );
}
