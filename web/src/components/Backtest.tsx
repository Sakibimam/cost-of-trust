import backtest from "@/data/backtest.json";

type Policy = { jobsDone: number; undoneWorkAda: number };

// Source: web/src/data/backtest.json. Full sample at 100 ADA at risk.
const hireAll = backtest.policies.P0["100"];
const skipRefunds = backtest.policies.P2["100"];
const policies: Array<[string, string, Policy]> = [
  ["P0", "Hire every agent", hireAll],
  ["P2", "Skip agents with more than one refund in five", skipRefunds],
];

const ada = (value: number) => `${value.toFixed(0)} ADA`;
const date = (value: string) => new Date(value).toLocaleDateString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });

export function Backtest() {
  return (
    <section id="backtest" aria-labelledby="backtest-h" className="scroll-mt-6 border-t border-ink py-12 md:py-16">
      <div className="wrap">
        <p className="label">Mainnet escrow history</p>
        <h2 id="backtest-h" className="mt-2 max-w-[22ch] text-[32px] font-extrabold leading-[1.05] md:text-[40px]">Measured on Masumi mainnet</h2>
        <p className="mt-4 max-w-[70ch] text-[17px] leading-[1.45]">{backtest.escrows} resolved escrows from {date(backtest.timeWindow.from)} to {date(backtest.timeWindow.to)}. At 100 ADA at risk, skipping agents with more than one refund in five finishes {skipRefunds.jobsDone} of {backtest.eligibleDecisions} later jobs. Hiring every agent finishes {hireAll.jobsDone}.</p>

        <div className="mt-8 overflow-hidden border-t-[6px] border-ink">
          <table className="w-full table-fixed border-collapse text-left text-[13px] sm:text-[15px]">
            <caption className="sr-only">Mainnet backtest policy comparison at 100 ADA at risk</caption>
            <thead>
              <tr className="border-b border-rule">
                <th scope="col" className="w-[45%] py-3 pr-3 font-extrabold">Policy</th>
                <th scope="col" className="w-[25%] py-3 px-2 text-right font-extrabold">Jobs done</th>
                <th scope="col" className="w-[30%] py-3 pl-2 text-right font-extrabold">Work undone</th>
              </tr>
            </thead>
            <tbody>
              {policies.map(([id, label, policy]) => (
                <tr key={id} className="border-b border-rule align-top">
                  <th scope="row" className="py-3 pr-3 font-semibold"><span className="fig mr-2 text-muted">{id}</span>{label}</th>
                  <td className="fig py-3 px-2 text-right">{policy.jobsDone} of {backtest.eligibleDecisions}</td>
                  <td className="fig py-3 pl-2 text-right">{ada(policy.undoneWorkAda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-b border-rule py-3 text-[15px] leading-snug">
          <p className="m-0"><span className="font-extrabold">Calibration.</span> Trust Check Brier {backtest.calibration.betaBinomialBrier.toFixed(3)} versus dispute rate {backtest.calibration.disputeRateBrier.toFixed(3)} across {backtest.calibration.observations} observations; lower is better.</p>
        </div>
        <div className="border-b border-rule py-3 text-[15px] leading-snug">
          <p className="m-0"><span className="font-extrabold">What changes the hire.</span> A dispute count still hires an agent that refunds every job. Trust Check reads paid, refunded and disputed escrows, and a coworker asks it before paying.</p>
        </div>
      </div>
    </section>
  );
}
