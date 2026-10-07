"use client";
import { useEffect, useMemo, useState } from "react";
import type { SlideProps } from "./shared";
import { int } from "./shared";
import base from "./styles.module.css";
import s from "./early.module.css";

const COLS0 = 24;
const PAID_COLS = 6;
const REF_COLS = 18;
const REF_X = PAID_COLS + 2;
const START_MS = 1500;
const STAGGER_MS = 8;
const DUR_MS = 700;

export function Escrow({ data, active, run, reduced }: SlideProps) {
  const { paid, refunded, disputed, medianSeconds, name } = data.knight;
  const total = paid + refunded + disputed;
  const pct = Math.round((refunded / total) * 100);
  const [replay, setReplay] = useState(0);
  const [shown, setShown] = useState({ paid, refunded });

  const dots = useMemo(() => {
    let p = 0;
    let r = 0;
    return Array.from({ length: total }, (_, i) => {
      const isPaid = Math.floor(((i + 1) * paid) / total) > Math.floor((i * paid) / total);
      const k = isPaid ? p++ : r++;
      const x0 = i % COLS0;
      const y0 = Math.floor(i / COLS0);
      const x1 = isPaid ? k % PAID_COLS : REF_X + (k % REF_COLS);
      const y1 = Math.floor(k / (isPaid ? PAID_COLS : REF_COLS));
      return { i, isPaid, x0, y0, dx: x1 - x0, dy: y1 - y0 };
    });
  }, [paid, total]);
  const rows = Math.max(Math.ceil(refunded / REF_COLS), Math.ceil(paid / PAID_COLS), Math.ceil(total / COLS0));

  useEffect(() => {
    if (!active) return;
    if (reduced) { setShown({ paid, refunded }); return; }
    setShown({ paid: 0, refunded: 0 });
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - t0 - DUR_MS * 0.6;
      let np = 0;
      let nr = 0;
      for (const d of dots) if (START_MS + d.i * STAGGER_MS <= t) (d.isPaid ? np++ : nr++);
      setShown({ paid: np, refunded: nr });
      if (np < paid || nr < refunded) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, run, replay, reduced, dots, paid, refunded]);

  return (
    <div className={s.escrow}>
      <div className={s.escrowText}>
        <h1 className={base.h1}>Agent pays agent. Nobody knows if the work arrives.</h1>
        <p className={base.lede}>
          Masumi holds the payment in escrow until the work lands or a refund is requested. {name} has {disputed} disputes on its record, so a dispute rate calls it flawless.
        </p>
        <div className={s.ledger} role="table" aria-label={`${name} escrow record`}>
          <div className={base.entry} role="row"><span role="cell">Disputes</span><i className={base.lead} aria-hidden="true" /><span className={base.val} role="cell">{disputed}</span></div>
          <div className={base.entry} role="row"><span role="cell">Paid</span><i className={base.lead} aria-hidden="true" /><span className={base.val} role="cell">{shown.paid}</span></div>
          <div className={`${base.entry} ${base.loss}`} role="row"><span role="cell">Refunded</span><i className={base.lead} aria-hidden="true" /><span className={base.val} role="cell">{shown.refunded}</span></div>
          <div className={`${base.entry} ${base.total}`} role="row"><span role="cell">Refunded of {total} resolved</span><i className={base.lead} aria-hidden="true" /><span className={`${base.val} ${base.loss}`} role="cell">{pct}%</span></div>
        </div>
        <p className={base.src}>{name}, Masumi mainnet registry. Median {medianSeconds} s from escrow to result on the paid jobs. Counts from web/src/data/showcase.json.</p>
      </div>

      <div className={s.field} style={{ "--rows": rows, "--cols": PAID_COLS + 2 + REF_COLS } as React.CSSProperties}>
        <div key={`${run}-${replay}`} className={s.dots} role="img" aria-label={`${total} resolved escrows: ${paid} paid, ${refunded} refunded`}>
          {dots.map((d) => (
            <i key={d.i} className={d.isPaid ? s.paid : s.refund} style={{ "--x": d.x0, "--y": d.y0, "--dx": d.dx, "--dy": d.dy, "--i": d.i } as React.CSSProperties} />
          ))}
          <span className={`${s.tag} ${s.tagPaid}`} aria-hidden="true">Paid {paid}</span>
          <span className={`${s.tag} ${s.tagRef}`} aria-hidden="true">Refunded {refunded}</span>
        </div>
        <button type="button" className={`${base.btn} ${s.replay}`} onClick={() => setReplay((n) => n + 1)}>Replay</button>
        <p className={base.src}>One dot per resolved escrow, grouped by outcome. {int(total)} resolved, none disputed.</p>
      </div>
    </div>
  );
}
