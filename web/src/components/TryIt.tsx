"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { fmt } from "@/lib/format";

type Option = { route: string; label: string; plain: string; sellers: string[]; expectedCostAda: number; riskAdjustedCostAda: number; selected: boolean };
type Result = {
  agent: { name: string; identifier: string; network: string; otherMatches: number };
  input: { valueAda: number; deadlineMinutes: number | null };
  history: { paid: number; refunded: number; disputed: number; medianSeconds: number | null; p90Seconds: number | null };
  options: Option[];
  decision: "hire_as_is" | "hire_with_backup_keeper" | "require_coverage" | "do_not_hire" | "insufficient_data";
  expectedCostAda: number | null;
  withinDeadline: { deadlineMinutes: number; jobsMeasured: number; jobsWithin: number } | null;
  headline: string;
  sentence: string;
  note: string;
};
type View =
  | { status: "loading"; agent: string }
  | { status: "ready"; data: Result }
  | { status: "missing"; agent: string; suggestions: string[] }
  | { status: "error"; message: string };

const DEFAULTS = { agent: "dpa Research Agent", value: "100", deadline: "15" };
const EXAMPLES = [
  { label: "dpa Research Agent", detail: "100 ADA, 15 min", agent: "dpa Research Agent", value: "100", deadline: "15" },
  { label: "Knight", detail: "500 ADA, 15 min", agent: "Knight", value: "500", deadline: "15" },
  { label: "Company Researcher", detail: "100 ADA, 1 min", agent: "Company Researcher (Bansumi)", value: "100", deadline: "1" },
];
const VERDICT_TEXT: Record<Result["decision"], string> = {
  hire_as_is: "Safe to hire alone",
  hire_with_backup_keeper: "Hire it, with a backup",
  require_coverage: "Hire it only with cover",
  do_not_hire: "Skip this agent",
  insufficient_data: "Not enough history",
};

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="label block">{label}</label>
      <div className="mt-2">{children}</div>
      {hint && <p id={`${id}-hint`} className="m-0 mt-1 text-[13px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

const input = "block h-11 w-full min-w-0 border-2 border-ink bg-paper px-3 text-[16px] text-ink placeholder:text-muted";

export function TryIt({ names }: { names: string[] }) {
  const uid = useId();
  const [agent, setAgent] = useState(DEFAULTS.agent);
  const [value, setValue] = useState(DEFAULTS.value);
  const [deadline, setDeadline] = useState(DEFAULTS.deadline);
  const [view, setView] = useState<View>({ status: "loading", agent: DEFAULTS.agent });
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(async (q: { agent: string; value: string; deadline: string }) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    const name = q.agent.trim();
    if (!name) { setView({ status: "error", message: "Type the name of an agent first, for example Knight." }); return; }
    setView({ status: "loading", agent: name });
    const params = new URLSearchParams({ agent: name, valueAda: q.value.trim() || "100" });
    if (q.deadline.trim()) params.set("deadlineMinutes", q.deadline.trim());
    try {
      const response = await fetch(`/api/check?${params}`, { signal: ctl.signal });
      const body = await response.json();
      if (ctl.signal.aborted) return;
      if (response.status === 404) setView({ status: "missing", agent: name, suggestions: body.suggestions ?? [] });
      else if (!response.ok) setView({ status: "error", message: body.error ?? "Something went wrong with that check. Please try again." });
      else setView({ status: "ready", data: body as Result });
    } catch {
      if (!ctl.signal.aborted) setView({ status: "error", message: "The check could not be reached. Check your connection and ask again." });
    }
  }, []);

  useEffect(() => {
    void run(DEFAULTS);
    return () => abort.current?.abort();
  }, [run]);

  const pick = (e: { agent: string; value: string; deadline: string }) => { setAgent(e.agent); setValue(e.value); setDeadline(e.deadline); void run(e); };
  const submit = (event: React.FormEvent) => { event.preventDefault(); void run({ agent, value, deadline }); };
  const busy = view.status === "loading";

  return (
    <section id="try" aria-labelledby="try-h" className="scroll-mt-6 border-t-[6px] border-ink bg-paper-2">
      <div className="wrap grid grid-cols-1 gap-x-10 gap-y-8 py-10 md:py-14 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-5">
          <h2 id="try-h" className="head max-w-[24ch]">Before your agent pays another agent, check how to buy the job.</h2>
          <p className="mt-4 max-w-[46ch] text-[16px] leading-[1.45] text-muted">Masumi is the marketplace where AI agents hire and pay each other on Cardano. Pick a real agent from it and see the answer your agent would get. Free, no wallet.</p>

          <form onSubmit={submit} className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4" aria-label="Check an agent">
            <div className="col-span-2">
              <Field id={`${uid}-agent`} label="Agent" hint="Start typing a name, or paste a registry asset id.">
                <input id={`${uid}-agent`} name="agent" type="text" list={`${uid}-names`} value={agent} onChange={(e) => setAgent(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="dpa Research Agent" aria-describedby={`${uid}-agent-hint`} className={input} />
                <datalist id={`${uid}-names`}>{names.map((n) => <option key={n} value={n} />)}</datalist>
              </Field>
            </div>
            <Field id={`${uid}-value`} label="Value at risk (ADA)" hint="What you lose if the job fails.">
              <input id={`${uid}-value`} name="valueAda" type="number" inputMode="decimal" min={0} step="any" value={value} onChange={(e) => setValue(e.target.value)} required aria-describedby={`${uid}-value-hint`} className={input} />
            </Field>
            <Field id={`${uid}-deadline`} label="Deadline (minutes)" hint="Leave empty for no deadline.">
              <input id={`${uid}-deadline`} name="deadlineMinutes" type="number" inputMode="decimal" min={0.1} step="any" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-describedby={`${uid}-deadline-hint`} className={input} />
            </Field>
            <div className="col-span-2">
              <button type="submit" className="btn !bg-ink !text-paper hover:!bg-blue hover:!border-blue" aria-busy={busy}>{busy ? "Checking" : "Check this agent"}</button>
            </div>
          </form>

          <div className="mt-6">
            <p className="label m-0">Or start from an example</p>
            <ul className="m-0 mt-2 flex list-none flex-col p-0">
              {EXAMPLES.map((e) => (
                <li key={e.label} className="border-t border-rule first:border-t-0">
                  <button type="button" onClick={() => pick(e)} className="flex min-h-[44px] w-full cursor-pointer items-baseline justify-between gap-4 py-2 text-left text-[15px] hover:bg-paper-3">
                    <span className="font-extrabold">{e.label}</span>
                    <span className="text-muted">{e.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="min-w-0 lg:col-span-7" aria-live="polite" aria-atomic="false">
          <Answer view={view} onRetry={() => void run({ agent, value, deadline })} onPick={(name) => pick({ agent: name, value, deadline })} />
        </div>
      </div>
    </section>
  );
}

function Answer({ view, onRetry, onPick }: { view: View; onRetry: () => void; onPick: (name: string) => void }) {
  if (view.status === "loading") {
    return (
      <div className="border-t-[6px] border-ink pt-5">
        <p className="m-0 text-[17px] font-extrabold">Reading the job history of {view.agent}.</p>
        <p className="m-0 mt-1 text-[14px] text-muted">Every paid and refunded Masumi job, pricing the four ways to buy.</p>
        <div className="progress mt-4" />
      </div>
    );
  }
  if (view.status === "error") {
    return (
      <div className="border-l-[6px] border-signal bg-paper p-4">
        <p className="m-0 text-[17px] font-extrabold">Something went wrong with that check.</p>
        <p className="m-0 mt-1 text-[15px] text-muted">{view.message}</p>
        <button type="button" onClick={onRetry} className="btn mt-4">Ask again</button>
      </div>
    );
  }
  if (view.status === "missing") {
    return (
      <div className="border-l-[6px] border-signal bg-paper p-4">
        <p className="m-0 text-[17px] font-extrabold">No Masumi agent is called &ldquo;{view.agent}&rdquo;.</p>
        <p className="m-0 mt-1 text-[15px] text-muted">{view.suggestions.length ? "Did you mean one of these?" : "Check the spelling, or paste the agent's registry asset id."}</p>
        <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
          {view.suggestions.map((s) => <li key={s}><button type="button" onClick={() => onPick(s)} className="btn">{s}</button></li>)}
        </ul>
      </div>
    );
  }
  return <Ready data={view.data} />;
}

function Ready({ data }: { data: Result }) {
  const { history: h, decision, options, withinDeadline: w } = data;
  const settled = h.paid + h.refunded + h.disputed;
  const skip = decision === "do_not_hire";
  const rest = data.sentence.slice(data.headline.length).trim();
  return (
    <div>
      <div className={`border-t-[6px] pt-5 ${skip ? "border-signal" : "border-ink"}`}>
        <p className="label m-0">{VERDICT_TEXT[decision]}</p>
        <h3 className="mt-2 max-w-[22ch] text-[28px] font-extrabold leading-[1.05] tracking-[-0.025em] md:text-[34px]">{data.headline}</h3>
        <p className="m-0 mt-3 max-w-[56ch] text-[18px] leading-[1.4]">{rest}</p>
        {skip && h.refunded + h.disputed > settled / 5 && <p className="m-0 mt-2 max-w-[56ch] text-[15px] font-semibold text-signal-ink">{h.refunded + h.disputed} of {settled} past jobs ({Math.round(((h.refunded + h.disputed) / settled) * 100)}%) ended in a refund, past the one-in-five line where Trust Check says skip.</p>}
        {w && w.jobsMeasured > 0 && <p className="m-0 mt-2 max-w-[56ch] text-[15px] text-muted">{w.jobsWithin} of {w.jobsMeasured} recorded jobs landed inside {w.deadlineMinutes} {w.deadlineMinutes === 1 ? "minute" : "minutes"}.</p>}
        <p className="m-0 mt-2 max-w-[56ch] text-[15px] text-muted">{h.paid} paid out to the agent, {h.refunded + h.disputed} refunded to the buyer, out of {settled} finished jobs.{h.p90Seconds !== null && <> Nine in ten answered within {Math.round(h.p90Seconds)} s.</>}{data.agent.otherMatches > 0 && <> {data.agent.otherMatches} other {data.agent.otherMatches === 1 ? "agent shares" : "agents share"} this name; this is the one with the most jobs.</>}</p>
      </div>

      {options.length > 0 && (
        <div className="mt-8">
          <table className="w-full border-collapse text-left">
            <caption className="pb-3 text-left text-[15px] text-muted">
              Four ways to buy a {fmt(data.input.valueAda)} ADA job. Expected cost is the fee plus the loss you should expect if the agent misses.{skip && " Shown for comparison. None is recommended."}
            </caption>
            <thead>
              <tr className="border-b-[3px] border-ink">
                <th scope="col" className="label py-2 pl-3 pr-2 font-semibold">Way to buy</th>
                <th scope="col" className="label w-[26%] py-2 pl-2 text-right font-semibold sm:w-[22%]">Expected cost</th>
              </tr>
            </thead>
            <tbody>
              {options.map((o) => (
                <tr key={o.route} className="border-b border-rule align-top">
                  <td className={`border-l-[6px] py-3 pl-3 pr-2 ${o.selected ? "border-ink" : "border-transparent"}`}>
                    <p className="m-0 text-[16px] font-extrabold leading-tight">{o.label}{o.selected && <span className="label ml-2 !text-ink">Recommended</span>}</p>
                    <p className="m-0 mt-1 max-w-[52ch] text-[14px] leading-snug text-muted">{o.plain}</p>
                  </td>
                  <td className="py-3 pl-2 text-right align-top"><span className="fig">{fmt(o.expectedCostAda)}</span><span className="block text-[12px] text-muted">ADA</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="m-0 mt-5 max-w-[60ch] text-[14px] leading-snug text-muted">Read from the escrow history of Masumi mainnet jobs. The paid report adds a live check of the agent&apos;s own service and its registry price, signed so another program can verify it.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <a href="#api" className="btn inline-flex items-center !bg-ink !text-paper no-underline hover:!bg-blue hover:!border-blue">Get the paid, signed report over x402</a>
        <a href="https://preprod.sokosumi.com" className="btn inline-flex items-center no-underline">Hire Trust Check on Sokosumi</a>
      </div>
    </div>
  );
}
