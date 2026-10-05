"use client";

export type Buyer = "bot" | "treasury";
export const RISK_AVERSION: Record<Buyer, number> = { bot: 0, treasury: 0.25 };

const BUYERS: { id: Buyer; name: string; note: string }[] = [
  { id: "bot", name: "Risk-neutral bot", note: "riskAversion 0. Cares about the mean loss only." },
  { id: "treasury", name: "Treasury", note: "riskAversion 0.25. Cannot absorb the loss, so variance costs it." },
];

export function Controls({ buyer, onBuyer, shared, onShared, busy }: {
  buyer: Buyer; onBuyer: (b: Buyer) => void; shared: boolean; onShared: (s: boolean) => void; busy: boolean;
}) {
  return (
    <form aria-label="Re-price the routes" aria-busy={busy} onSubmit={(e) => e.preventDefault()} className="relative z-10 border-t-[6px] border-ink bg-paper">
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="label w-full border-b border-rule py-3">Who is buying</legend>
        <div className="grid grid-cols-1 xs:grid-cols-2">
          {BUYERS.map((b, i) => (
            <label key={b.id} className={`group relative block cursor-pointer border-rule p-4 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue ${i === 0 ? "xs:border-r" : "border-t xs:border-t-0"} ${buyer === b.id ? "bg-ink text-paper" : "bg-paper hover:bg-paper-2"}`}>
              <input type="radio" name="buyer" value={b.id} checked={buyer === b.id} onChange={() => onBuyer(b.id)} className="sr-only" />
              <span className="block text-[17px] font-extrabold leading-tight">{b.name}</span>
              <span className={`mt-1 block text-[13px] leading-snug ${buyer === b.id ? "text-paper/80" : "text-muted"}`}>{b.note}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-start justify-between gap-4 border-y border-rule p-4">
        <div className="min-w-0">
          <p id="shared-label" className="m-0 text-[17px] font-extrabold leading-tight">Keepers share infrastructure</p>
          <p id="shared-note" className="mt-1 text-[13px] leading-snug text-muted">{shared ? "On. One provider outage takes a backup down with the primary, so coverage can beat a backup." : "Off. Keepers fail independently, and a UTxO can only be spent once, so a backup is safe."}</p>
        </div>
        <button type="button" role="switch" aria-checked={shared} aria-labelledby="shared-label" aria-describedby="shared-note" onClick={() => onShared(!shared)} className={`flex h-11 min-w-[88px] shrink-0 cursor-pointer items-center justify-between gap-2 border-2 border-ink px-3 text-[13px] font-semibold ${shared ? "bg-ink text-paper" : "bg-paper text-ink hover:bg-paper-2"}`}>
          <span>{shared ? "On" : "Off"}</span>
          <span aria-hidden className={`block h-4 w-4 ${shared ? "bg-yellow" : "bg-ink"}`} />
        </button>
      </div>
    </form>
  );
}
