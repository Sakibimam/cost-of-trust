import backtest from "@/data/backtest.json";

type Policy = {
  jobsDoneRate: number;
  totalCostPer100Decisions: number;
  observedBackupLegs: number;
  modelledBackupLegs: number;
};

// Source: web/src/data/backtest.json; definitions and held-out split: backtest/README.md.
const policies: Array<[string, string, Policy]> = [
  ["P0", "Hire alone, always", backtest.policies.P0["100"]],
  ["P1", "Skip above 5% dispute rate", backtest.policies.P1["100"]],
  ["P2", "Skip above 20% refund + dispute rate", backtest.policies.P2["100"]],
  ["P3", "Cost of Trust route ranking", backtest.policies.P3["100"]],
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
        <p className="mt-4 max-w-[70ch] text-[17px] leading-[1.45]">{backtest.escrows} resolved escrows and {backtest.eligibleDecisions} eligible decisions from {date(backtest.timeWindow.from)} to {date(backtest.timeWindow.to)}. At {100} ADA at risk, each policy is scored on the same held-out decisions.</p>

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

        <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-4 border-l-[6px] border-signal bg-paper-2 p-4 sm:grid-cols-2">
          <p className="m-0 text-[15px] leading-snug"><span className="font-extrabold">Calibration.</span> Trust Check Brier {backtest.calibration.betaBinomialBrier.toFixed(3)} versus dispute rate {backtest.calibration.disputeRateBrier.toFixed(3)} across {backtest.calibration.observations} observations.</p>
          <p className="m-0 text-[15px] leading-snug"><span className="font-extrabold">Backup provenance.</span> Cost of Trust records {backtest.policies.P3["100"].observedBackupLegs} observed backup legs and {backtest.policies.P3["100"].modelledBackupLegs} modelled legs at this risk level.</p>
        </div>
        <p className="mt-4 max-w-[78ch] text-[13px] leading-snug text-muted">Escrow outcomes, decisions, done rates, and primary losses are observed from the mainnet sample; backup legs are observed when same-capability alternative history exists and modelled otherwise.</p>
      </div>
    </section>
  );
}
