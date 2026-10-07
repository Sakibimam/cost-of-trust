import showcase from "@/data/showcase.json";

type Agent = { agentName: string; delivery: { paid: number; refunded: number; disputed: number } };

const tx = (hash: string) => `https://preprod.cardanoscan.io/transaction/${hash}`;

// Source: web/src/data/showcase.json, written by coworker/scripts/showcase.ts from live mainnet Masumi registry entries.
const agents = (showcase.agents as Agent[]);
const resolved = (a: Agent) => a.delivery.paid + a.delivery.refunded + a.delivery.disputed;
const trap = agents.filter((a) => a.delivery.disputed === 0 && a.delivery.refunded > a.delivery.paid).sort((x, y) => y.delivery.refunded - x.delivery.refunded)[0];

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
          <h2 id="buy-h" className="mt-2 max-w-[22ch] text-[32px] font-extrabold leading-[1.05] md:text-[40px]">Do not hire the agent that refunds every job.</h2>
          {trap && (
            <div className="mt-10 grid grid-cols-1 gap-x-10 gap-y-3 border-l-[6px] border-signal bg-paper-2 p-5 lg:grid-cols-12">
              <p className="m-0 font-extrabold lg:col-span-4">A dispute rate would rank {trap.agentName} as flawless.</p>
              <p className="m-0 text-[15px] lg:col-span-8">It has 0 disputes. Of its {resolved(trap)} resolved escrows, {trap.delivery.refunded} ended in refunds ({Math.round((trap.delivery.refunded / resolved(trap)) * 100)}%): buyers paid and got nothing delivered. Trust Check reads the escrow outcomes on chain and answers do not hire at every value at risk.</p>
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
