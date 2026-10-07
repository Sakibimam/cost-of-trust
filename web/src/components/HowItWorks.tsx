const STEPS = [
  {
    title: "Your agent asks before it pays.",
    body: "It sends Trust Check three things: the agent it wants to hire, how much ADA is at risk, and the deadline.",
  },
  {
    title: "Trust Check reads the agent's real record.",
    body: "It reads that agent's paid, refunded, and disputed escrows on Cardano, plus how long results took and the latest time the seller set. The answer is hire, hire a backup, or do not hire.",
  },
  {
    title: "A backup is paid only if it is needed.",
    body: "If you buy a backup, Cardano makes sure only one agent gets paid, and Masumi refunds the one that missed. Masumi refunds the fee when an agent misses, but it cannot refund lost time. The backup protects the deadline.",
  },
];

const WORDS = [
  { term: "Escrow", gloss: "A payment locked until the work arrives. If the agent misses, the buyer gets it back." },
  { term: "UTxO", gloss: "Cardano's unit of money. Each one can be spent exactly once, so two agents cannot both be paid from the same payment." },
  { term: "x402", gloss: "A web standard where a server answers 402 Payment Required, the caller pays, and the same request then succeeds." },
];

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-h" className="scroll-mt-6 border-t border-ink py-12 md:py-16">
      <div className="wrap grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-4">
          <h2 id="how-h" className="head max-w-[14ch]">How a check works</h2>
          <dl className="m-0 mt-8 hidden lg:block">
            {WORDS.map((w) => (
              <div key={w.term} className="border-t border-rule py-3">
                <dt className="label">{w.term}</dt>
                <dd className="m-0 mt-1 text-[14px] leading-snug text-muted">{w.gloss}</dd>
              </div>
            ))}
          </dl>
        </div>

        <ol className="m-0 min-w-0 list-none p-0 lg:col-span-8">
          {STEPS.map((s, i) => (
            <li key={s.title} className="grid grid-cols-[auto_1fr] gap-x-4 border-t-[6px] border-ink py-5 first:mt-0 sm:gap-x-6">
              <span className="fig w-[4.5rem] pt-1 text-[14px] uppercase tracking-[0.09em] text-muted">Step {i + 1}</span>
              <div className="min-w-0">
                <h3 className="m-0 max-w-[28ch] text-[22px] font-extrabold leading-[1.1] tracking-[-0.02em] md:text-[26px]">{s.title}</h3>
                <p className="m-0 mt-2 max-w-[58ch] text-[16px] leading-[1.45]">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <dl className="m-0 min-w-0 lg:hidden">
          {WORDS.map((w) => (
            <div key={w.term} className="border-t border-rule py-3">
              <dt className="label">{w.term}</dt>
              <dd className="m-0 mt-1 text-[14px] leading-snug text-muted">{w.gloss}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div id="api" className="wrap mt-12 scroll-mt-6 md:mt-16">
        <h3 className="m-0 text-[22px] font-extrabold leading-[1.1] tracking-[-0.02em] md:text-[26px]">Call it from your own agent</h3>
        <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
          <div className="min-w-0 border-t-[6px] border-ink pt-4">
            <p className="label m-0">Free preview</p>
            <p className="m-0 mt-2 max-w-[52ch] text-[15px] leading-snug text-muted">Reads the same escrow history. Answers in under a second with plain JSON: hire, hire a backup, or do not hire, plus the expected cost.</p>
            <pre className="m-0 mt-3 overflow-x-auto bg-paper-3 p-3 text-[13px] leading-snug"><code>{`curl "https://cost-of-trust.vercel.app/api/check\\
?agent=Knight&valueAda=500&deadlineMinutes=15"`}</code></pre>
          </div>
          <div className="min-w-0 border-t-[6px] border-ink pt-4">
            <p className="label m-0">Paid, signed report over x402</p>
            <p className="m-0 mt-2 max-w-[52ch] text-[15px] leading-snug text-muted">Costs 1 ADA on Cardano preprod, settled by the request itself. Adds a live check of the agent&apos;s own service and its registry price, and returns a report another program can verify.</p>
            <pre className="m-0 mt-3 overflow-x-auto bg-paper-3 p-3 text-[13px] leading-snug"><code>{`POST /api/x402/trust-check
{ "agentName": "Knight",
  "taskValueAtRiskAda": 500,
  "deadlineMinutes": 15 }`}</code></pre>
          </div>
        </div>
      </div>
    </section>
  );
}
