import run from "@/data/subhire.json";

// Source: agents/runs/2026-10-07T11-06-36-167Z-subhire.json (copied byte for byte to src/data/subhire.json), produced by subhire/agent.ts.
const tx = (hash: string) => `https://preprod.cardanoscan.io/transaction/${hash}`;
const WORDS: Record<string, string> = { hire_as_is: "Hire", hire_with_backup_keeper: "Hire with backup", require_coverage: "Hire only with coverage", do_not_hire: "Do not hire", insufficient_data: "Not enough history" };

export function Subhire() {
  const { job, payments, choice, hire } = run;
  return (
    <section id="subhire" aria-labelledby="subhire-h" className="scroll-mt-6 border-t border-ink py-12 md:py-16">
      <div className="wrap">
        <p className="label">Sokosumi Coworker pattern, Trust Check paid over x402</p>
        <h2 id="subhire-h" className="mt-2 max-w-[24ch] text-[32px] font-extrabold leading-[1.05] md:text-[40px]">A Coworker that checks before it sub-hires</h2>
        <p className="mt-4 max-w-[64ch] leading-[1.45]">The job is a {job.title} with {job.taskValueAtRiskAda} ADA at risk. Before the coworker pays another agent, it buys a Trust Check: a 402 quote, a signed payment, and one answer, hire, hire a backup, or do not hire, from paid, refunded and disputed escrows.</p>
        <div className="mt-8">
          <table className="w-full table-fixed border-collapse text-left text-[13px] sm:text-[15px]">
            <caption className="sr-only">Trust Check result for each sub-hire candidate</caption>
            <thead><tr className="border-b-[6px] border-ink"><th scope="col" className="w-[32%] py-2 pr-2 font-extrabold sm:pr-4">Candidate</th><th scope="col" className="w-[26%] py-2 pr-2 font-extrabold sm:pr-4">Trust Check x402 payment</th><th scope="col" className="py-2 pr-2 font-extrabold sm:pr-4">Decision</th><th scope="col" className="py-2 text-right font-extrabold">Expected</th></tr></thead>
            <tbody>
              {payments.map((p) => {
                const pick = choice?.agent === p.candidate;
                return (
                  <tr key={p.identifier} className="border-b border-rule align-top">
                    <th scope="row" className="py-3 pr-2 font-semibold sm:pr-4">{p.candidate}{pick && <span className="sr-only"> sub-hired</span>}<span className="mt-1 block text-[13px] font-normal text-muted">{p.paid} paid, {p.refunded} refunded</span></th>
                    <td className="py-3 pr-2 sm:pr-4">{p.txHash ? <a href={tx(p.txHash)} className="fig break-all !font-medium">{p.txHash.slice(0, 10)}…{p.txHash.slice(-4)}</a> : null}</td>
                    <td className={`py-3 pr-2 sm:pr-4 ${pick ? "font-extrabold" : ""}`}>{WORDS[p.decision ?? ""] ?? p.decision}</td>
                    <td className={`fig py-3 text-right ${pick ? "font-extrabold !text-ink underline decoration-[3px] underline-offset-4" : "text-muted"}`}>{p.expectedCostAda === null ? "n/a" : `${p.expectedCostAda.toFixed(2)} ADA`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {choice && hire && (
          <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-3 border-l-[6px] border-signal bg-paper-2 p-5 lg:grid-cols-12">
            <p className="m-0 font-extrabold lg:col-span-4">Sub-hired {choice.agent}: {WORDS[choice.decision]?.toLowerCase()}, expected {choice.expectedCostAda.toFixed(2)} ADA.</p>
            <p className="m-0 text-[15px] lg:col-span-8">The only one of {payments.length} registry entries the policy cleared. The other {run.refused.length} came back do not hire ({[...new Set(run.refused)].join(", ")}). The agent builds the MIP-003 <span className="fig">start_job</span> request from the registry entry, <a href={hire.request.url} className="fig break-all">{hire.request.url}</a>, and its <span className="fig">/availability</span> answers {hire.availability.status} in {hire.availability.ms} ms. Every Trust Check payment is confirmed on Cardano preprod through Koios.</p>
          </div>
        )}
      </div>
    </section>
  );
}
