const tx = (hash: string) => `https://preprod.cardanoscan.io/transaction/${hash}`;

type Step = { label: string; hash?: string; note?: string; bad?: boolean };

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="m-0 list-none border-t-[6px] border-ink p-0">
      {steps.map((s) => (
        <li key={s.label} className="grid grid-cols-1 gap-x-6 gap-y-1 border-b border-rule py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <span className={`min-w-0 font-extrabold leading-tight ${s.bad ? "!text-signal-ink" : ""}`}>{s.label}</span>
          {s.hash ? (
            <a href={tx(s.hash)} className="fig break-all !font-medium">{s.hash.slice(0, 10)}…{s.hash.slice(-4)}<span className="sr-only"> on preprod.cardanoscan.io</span></a>
          ) : (
            <span className={`fig ${s.bad ? "!text-signal-ink" : "text-muted"}`}>{s.note}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

// Source: agents/runs/2026-10-06T04-44-21-919Z.json. Keeper B's claim error is ConwayUtxowFailure BadInputsUTxO from Koios submittx.
const race: Step[] = [
  { label: "Buyer locks one claim UTxO", hash: "c0c104a07e8a375982ba72f0a7d0f949a2dbd194a69eb171d9ca375d7e60f814" },
  { label: "Keeper A is paid", hash: "e458925a99e85fe742b0f0a2a1dbf1dfc8ece3724752a8862227e27c89309cac" },
  { label: "Keeper B is paid", hash: "aa40b41742f98be7520e3003fc49e11266cab049dcabdafa59677a6042b9354a" },
  { label: "Keeper A finishes first and claims", hash: "43b27058c91abc30ff560251cc7997a0ca0343df4432319c265b4f140163de9b" },
  { label: "Keeper B claims the same UTxO", note: "rejected by the ledger: BadInputsUTxO", bad: true },
];

// Source: agents/runs/2026-10-06T04-45-57-790Z.json; cre/evidence/simulate-*.log for the workflow runs.
const cover: Step[] = [
  { label: "Claim vault locked", hash: "296257f15d00134b30b9c18360cd216acf3b445eb39df352d4e70e31d47da239" },
  { label: "Underwriter locks coverage", hash: "0646c8af88359bb10b13fdddc67dcc4258f54efa59572ddd84564be69099bcf9" },
  { label: "Keeper paid and job claimed", hash: "4afb027dfc182ac65b854bcdb4bee0eb07775fe194edf49cef1c7b98060a775f" },
  { label: "Report with the decision flipped", note: "rejected by the coverage validator", bad: true },
  { label: "CRE report settles the coverage", hash: "3c20440b7419f5c8da18910af0c6fd2b8a40dae0b4d22cacccf8ef0fddf41abb" },
];

// Source: Sokosumi Task 01a11153-9886 via local MPS PaymentRequest history; report sha256 923cdcd5 matches the on-chain result hash.
const masumi: Step[] = [
  { label: "Buyer funds Masumi escrow", hash: "be70aa09631cb3a7bda74bd09b91fa5d837e9408e2f889c80a71ce0bb7f08892" },
  { label: "Trust Check submits its result hash", hash: "0be9fa229a864ddbaa8847afa84657d535d93d4a26fdbab506e2a2ebde573f91" },
  { label: "Seller collects", hash: "6b8bab2e1f143467ba52001d928eade55ee71b9540b768d5870e9aaa18108630" },
];

export function Proof() {
  return (
    <>
      <section id="race" aria-labelledby="race-h" className="scroll-mt-6 border-y border-ink bg-paper-2 py-12 md:py-16">
        <div className="wrap grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-5">
            <p className="label">Cardano preprod, one run</p>
            <h2 id="race-h" className="mt-2 max-w-[16ch] text-[32px] font-extrabold leading-[1.05] md:text-[40px]">Two keepers. One claim. One winner.</h2>
            <p className="mt-4 max-w-[52ch] text-[17px] leading-[1.45]">The buyer locks a single claim UTxO for the job and pays two keepers to race for it. A UTxO can be spent once, so the ledger accepts the first valid claim and refuses the second at submission.</p>
            <p className="mt-3 max-w-[52ch] text-[15px] text-muted">No arbiter decides who delivered and nobody is paid twice for the job. That is what makes a backup keeper cheap enough to buy.</p>
          </div>
          <div className="min-w-0 lg:col-span-7"><Steps steps={race} /></div>
        </div>
      </section>

      <section id="cover" aria-labelledby="cover-h" className="scroll-mt-6 py-12 md:py-16">
        <div className="wrap grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-5">
            <p className="label">Chainlink CRE adjudicator</p>
            <h2 id="cover-h" className="mt-2 max-w-[18ch] text-[28px] font-extrabold leading-[1.1] md:text-[32px]">When a job fails, coverage pays. A forged report cannot.</h2>
            <p className="mt-4 max-w-[52ch] text-[17px] leading-[1.45]">The <span className="fig">cot-adjudicator</span> CRE workflow reads the coverage and claim UTxOs from preprod through Koios, applies deterministic rules to decide whether the job was delivered before expiry, and sends a signed report. The coverage validator releases funds only against a report signed by the 2f+1 signer set pinned in its config NFT. Flip one decision byte after signing and the validator rejects it.</p>
          </div>
          <div className="min-w-0 lg:col-span-7"><Steps steps={cover} /></div>
        </div>
      </section>

      <section id="trust-check" aria-labelledby="trust-check-h" className="scroll-mt-6 border-t border-ink py-12 md:py-16">
        <div className="wrap grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-5">
            <p className="label">Trust Check, a paid Coworker on Sokosumi</p>
            <h2 id="trust-check-h" className="mt-2 max-w-[18ch] text-[28px] font-extrabold leading-[1.1] md:text-[32px]">Due diligence on an agent before you hire it.</h2>
            <p className="mt-4 max-w-[52ch] text-[17px] leading-[1.45]">Hire Trust Check through Masumi escrow with an agent identifier and the value at risk. It reads the agent&apos;s registry entry, endpoint health and on-chain delivery history, and answers hire, hire with a backup, cover it, or do not hire.</p>
            {/* Source: instant/results.json summary and doubleSpend. */}
            <p className="mt-3 max-w-[52ch] text-[15px] text-muted">Sellers take payment over x402 on preprod: 40 paid requests served, and a payment whose input was already spent is refused.</p>
          </div>
          <div className="min-w-0 lg:col-span-7"><Steps steps={masumi} /></div>
        </div>
      </section>
    </>
  );
}
