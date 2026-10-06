import { cardanoscanTx, fmt, shortHash } from "@/lib/format";
import { type SellerRecord, priorGloss, providerLabel } from "@/lib/router";

function RecordBar({ s }: { s: SellerRecord }) {
  const prior = s.risk.alpha0 + s.risk.beta0;
  return (
    <div>
      <div className="flex h-6 w-full gap-px" role="img" aria-label={`Starting assumption, ${s.successes} delivered, ${s.failures} failed`}>
        <div className="seg-prior" style={{ flex: `${prior} 1 0` }} />
        {s.successes > 0 && <div className="seg-price" style={{ flex: `${s.successes} 1 0` }} />}
        {s.failures > 0 && <div className="seg-loss" style={{ flex: `${s.failures} 1 0` }} />}
      </div>
      <p className="m-0 mt-2 text-[13px] leading-snug text-muted"><span className="fig !text-[13px] text-ink">{s.successes}</span> delivered, <span className="fig !text-[13px] text-ink">{s.failures}</span> failed. Hatched: {priorGloss(s.risk.alpha0, s.risk.beta0)} (Beta({s.risk.alpha0}, {s.risk.beta0}), configured). Solid blocks are observed outcomes.</p>
    </div>
  );
}

export function Sellers({ sellers }: { sellers: SellerRecord[] }) {
  return (
    <ul className="m-0 list-none border-t-[6px] border-ink p-0" aria-label="Seller track records">
      {sellers.map((s) => (
        <li key={s.id} data-seller={s.id} className="grid grid-cols-1 gap-x-8 gap-y-4 border-b border-rule py-6 md:grid-cols-12">
          <div className="min-w-0 md:col-span-3">
            <h3 className="m-0 text-[22px] font-extrabold leading-none">{s.name}</h3>
            <p className="mt-2 text-[14px] text-muted">{providerLabel(s.provider)}. Quotes <span className="fig !text-[14px] text-ink">{fmt(s.priceAda)} ADA</span>. <span className="text-[12px]">({s.id})</span></p>
            <p className="mt-1 text-[14px] text-muted">Chance it fails <span className="fig !text-[14px] text-ink">{(s.risk.pLoss * 100).toFixed(2)}%</span>{s.bondDiscount ? `, bond discount ${s.bondDiscount.toFixed(3)}` : ""}.</p>
          </div>
          <div className="min-w-0 md:col-span-5"><RecordBar s={s} /></div>
          <div className="min-w-0 md:col-span-4">
            <p className="label">Evidence on preprod</p>
            {s.evidence.length ? (
              <ul className="m-0 mt-2 list-none p-0">
                {s.evidence.map((h) => (
                  <li key={h} className="py-1"><a href={h.endsWith(".json") ? `/evidence/${h}` : cardanoscanTx(h)} target="_blank" rel="noreferrer" className="fig break-all !font-medium">{h.endsWith(".json") ? "Measured probe JSON" : shortHash(h)}<span className="sr-only"> (opens preprod evidence)</span></a></li>
                ))}
              </ul>
            ) : (
              <p className="m-0 mt-2 text-[14px] leading-snug text-muted">No transaction linked yet. Each outcome the router ingests appends its settle transaction hash here.</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
