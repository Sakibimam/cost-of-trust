// Source: agents/runs/2026-10-07T07-36-20Z-masumi-backup-stall-final.json (timeline and txs, hashes verified via POST preprod.koios.rest/api/v1/tx_status).
const tx = (hash: string) => `https://preprod.cardanoscan.io/transaction/${hash}`;

const STEPS = [
  { at: "07:36:29 UTC", what: "A hired through Masumi escrow", hash: "5d70db26db11b4e7e3711ce11febef7031b790f710e23c10927ff4ab3d9518d8" },
  { at: "07:39:30 UTC", what: "Buyer checkpoint: A has no result", hash: null },
  { at: "07:39:34 UTC", what: "Backup B hired through Masumi escrow", hash: "d9b06473307dbf9c056bc51a66637d5af2e153c63b770d4650434967ab74c63e" },
  { at: "07:51:08 UTC", what: "B result on chain", hash: "7934f7a085a4c491469994f6c7964f601219487cb6888bcefebce05862189fdf" },
  { at: "07:56:20 UTC", what: "Buyer deadline met with 5 min 12 s to spare", hash: null },
  { at: "A refund", what: "A refund requested", hash: "b6dde9c1337932dcc5fd28713cf832ccb2788c9a374a55791791da40ae04ab5a" },
  { at: "A refund", what: "A refund withdrawn", hash: "f6445aa1b4a1eae1f69516d215763fe6e4cf20e8d6e4cb94340bd9e206ae9db8" },
] as const;

export function MasumiBackup() {
  return (
    <section id="masumi-backup" aria-labelledby="masumi-backup-h" className="scroll-mt-6 border-t border-ink py-12 md:py-16">
      <div className="wrap">
        <h2 id="masumi-backup-h" className="m-0 max-w-[30ch] text-[28px] font-extrabold leading-[1.1] md:text-[32px]">On Masumi itself: the first agent stalls, the backup delivers, the first is refunded.</h2>
        <p className="mt-4 max-w-[60ch] leading-[1.45]">Masumi refunds the fee when an agent misses. Trust Check buys the deadline: at the buyer&apos;s checkpoint it hires a backup through Masumi escrow.</p>
        <ol className="m-0 mt-8 list-none border-t-[6px] border-ink p-0">
          {STEPS.map((s) => (
            <li key={s.what} className="grid grid-cols-1 gap-x-6 gap-y-1 border-b border-rule py-3 sm:grid-cols-[9rem_1fr_auto]">
              <span className="fig text-[14px] text-muted">{s.at}</span>
              <span className="font-semibold">{s.what}</span>
              {s.hash ? (
                <a href={tx(s.hash)} className="fig break-all text-[14px]">tx {s.hash.slice(0, 8)}…</a>
              ) : (
                <span aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
