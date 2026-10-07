import backtest from "@/data/backtest.json";

type Policy = {
  jobsDoneRate: number;
  totalCostPer100Decisions: number;
  observedBackupLegs: number;
  modelledBackupLegs: number;
};

// Source: web/src/data/backtest.json; definitions and held-out split: backtest/README.md.
// Held-out: the prior is calibrated on escrows before splitAt and every policy is scored only after it.
const held = backtest.heldOut;
const trust = held["P3-new"]["100"];
const heldDecisions = trust.jobsAttempted + trust.jobsSkipped;
const policies: Array<[string, string, Policy]> = [
  ["P0", "Hire alone, always", held.P0["100"]],
  ["P1", "Skip above 5% dispute rate", held.P1["100"]],
  ["P2", "Skip above 20% refund + dispute rate", held.P2["100"]],
  ["CoT", "Cost of Trust: route to the best agent, backup when it pays", trust],
];

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const ada = (value: number) => `${value.toFixed(2)} ADA`;
const date = (value: string) => new Date(value).toLocaleDateString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });

export function Backtest() {
  return (
    <section id="backtest" aria-labelledby="backtest-h" className="scroll-mt-6 border-t border-ink py-12 md:py-16">
      <div className="wrap">
        <p className="label">Held-out walk-forward split</p>
        <h2 id="backtest-h" className="mt-2 max-w-[22ch] text-[32px] font-extrabold leading-[1.05] md:text-[40px]">Measured on Masumi mainnet</h2>
        <p className="mt-4 max-w-[70ch] text-[17px] leading-[1.45]">{backtest.escrows} resolved escrows from {date(backtest.timeWindow.from)} to {date(backtest.timeWindow.to)}. Every policy decides using only escrows before each job; the Cost of Trust prior is fitted on jobs before {date(backtest.splitAt)} and all policies are scored on the {heldDecisions} jobs after it, at 100 ADA at risk.</p>

        <div className="mt-8 overflow-hidden border-t-[6px] border-ink">
          <table className="w-full table-fixed border-collapse text-left text-[13px] sm:text-[15px]">
            <caption className="sr-only">Mainnet backtest policy comparison at 100 ADA at risk</caption>
            <thead>
              <tr className="border-b border-rule">
                <th scope="col" className="w-[45%] py-3 pr-3 font-extrabold">Policy</th>
                <th scope="col" className="w-[25%] py-3 px-2 text-right font-extrabold">Jobs done</th>
                <th scope="col" className="w-[30%] py-3 pl-2 text-right font-extrabold">Cost / 100 jobs</th>
              </tr>
            </thead>
            <tbody>
              {policies.map(([id, label, policy]) => (
                <tr key={id} className="border-b border-rule align-top">
                  <th scope="row" className="py-3 pr-3 font-semibold"><span className="fig mr-2 text-muted">{id}</span>{label}</th>
                  <td className="fig py-3 px-2 text-right">{percent(policy.jobsDoneRate)}</td>
                  <td className="fig py-3 pl-2 text-right">{ada(policy.totalCostPer100Decisions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-b border-rule py-3 text-[15px] leading-snug">
          <p className="m-0"><span className="font-extrabold">Calibration.</span> Trust Check Brier {backtest.calibration.betaBinomialBrier.toFixed(3)} versus dispute rate {backtest.calibration.disputeRateBrier.toFixed(3)} across {backtest.calibration.observations} observations; lower is better.</p>
        </div>
        <div className="border-b border-rule py-3 text-[15px] leading-snug">
          <p className="m-0"><span className="font-extrabold">Backup legs.</span> Cost of Trust uses {trust.observedBackupLegs} observed and {trust.modelledBackupLegs} modelled backup legs at this risk level. A leg is observed when the same-capability alternative has a next escrow on chain, and modelled as undone work otherwise.</p>
        </div>
      </div>
    </section>
  );
}
