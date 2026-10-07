"use client";
import { useState } from "react";
import type { SlideProps } from "./shared";
import { int } from "./shared";
import base from "./styles.module.css";
import s from "./proof.module.css";

export function Backtest({ data, run }: SlideProps) {
  const b = data.backtest;
  const [loss, setLoss] = useState(b.losses.includes("100") ? "100" : b.losses[0]);
  const { base: p0, cot } = b.byLoss[loss];
  const saved = p0.adaLost - cot.adaLost;
  const maxLost = Math.max(...b.losses.map((l) => b.byLoss[l].base.adaLost));
  const brierMax = Math.max(b.brier.cot, b.brier.dispute);
  const rows = [
    { key: "base", name: "Hire every agent", p: p0 },
    { key: "cot", name: "Skip high-refund agents", p: cot },
  ] as const;

  return (
    <div className={s.bt}>
      <div className={s.btHead}>
        <h1 className={base.h1}>{int(cot.done)} jobs finished. Hiring every agent finishes {int(p0.done)}.</h1>
        <p className={base.lede}>
          On {b.brier.n} later mainnet jobs, skipping agents with more than one refund in five finishes {int(cot.done)} jobs at {loss} ADA at risk. Hiring every agent finishes {int(p0.done)}. Refund-history Brier {b.brier.cot.toFixed(3)} against dispute-rate Brier {b.brier.dispute.toFixed(3)}.
        </p>
      </div>

      <div className={s.stakes} role="group" aria-label="ADA at risk per job">
        <span className={s.stakesK}>ADA at risk per job</span>
        {b.losses.map((l) => (
          <button key={l} type="button" className={`${base.btn} ${base.fig}`} aria-pressed={loss === l} onClick={() => setLoss(l)}>{l}</button>
        ))}
      </div>

      <div key={`${run}`} className={s.charts}>
        <section className={s.chart} aria-labelledby="c1">
          <h2 id="c1" className={s.chartH}>Jobs finished, of {b.scored} later decisions</h2>
          {rows.map((r) => (
            <div key={r.key} className={s.cRow}>
              <span className={s.cName}>{r.name}</span>
              <span className={s.ticks} role="img" aria-label={`${r.p.done} finished, ${r.p.failures} failed of ${r.p.attempted}`}>
                <i style={{ flexGrow: r.p.done }} />
                <i data-fail="true" style={{ flexGrow: r.p.failures }} />
              </span>
              <span className={`${base.fig} ${s.cVal}`}>{r.p.done} <em>done</em> <b className={base.loss}>{r.p.failures} failed</b></span>
            </div>
          ))}
        </section>

        <section className={s.chart} aria-labelledby="c2">
          <h2 id="c2" className={s.chartH}>Work left undone at {loss} ADA per job</h2>
          {rows.map((r) => (
            <div key={r.key} className={s.cRow}>
              <span className={s.cName}>{r.name}</span>
              <span className={s.hbar}><i data-kind={r.key} style={{ transform: `scaleX(${r.p.adaLost / maxLost})` }} /></span>
              <span className={`${base.fig} ${s.cVal}`}>{int(r.p.adaLost)} ADA</span>
            </div>
          ))}
          <p className={s.delta}>{saved > 0 ? <>Skipping high-refund agents leaves <b className={base.fig}>{int(cot.adaLost)} ADA</b> of work undone. Hiring every agent leaves {int(p0.adaLost)} ADA undone.</> : "No difference at this stake."}</p>
        </section>

        <section className={s.chart} aria-labelledby="c3">
          <h2 id="c3" className={s.chartH}>Brier score for predicting non-delivery, walk-forward, lower is better</h2>
          {[{ key: "cot", name: "Refund-history Brier", v: b.brier.cot }, { key: "base", name: "Dispute-rate Brier", v: b.brier.dispute }].map((r) => (
            <div key={r.key} className={s.cRow}>
              <span className={s.cName}>{r.name}</span>
              <span className={s.hbar}><i data-kind={r.key} style={{ transform: `scaleX(${r.v / brierMax})` }} /></span>
              <span className={`${base.fig} ${s.cVal}`}>{r.v.toFixed(3)}</span>
            </div>
          ))}
        </section>
      </div>

      <p className={base.src}>
        Source: web/src/data/backtest.json, policies P0 and P2, {b.scored} later decisions. At {loss} ADA, P2 attempts {cot.attempted} and skips the rest. Brier over {b.brier.n} walk-forward predictions.
      </p>
    </div>
  );
}
