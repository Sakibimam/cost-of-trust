"use client";
import { useState } from "react";
import type { SlideProps } from "./shared";
import { day, int } from "./shared";
import base from "./styles.module.css";
import s from "./proof.module.css";

export function Backtest({ data, run }: SlideProps) {
  const b = data.backtest;
  const [loss, setLoss] = useState(b.losses.includes("100") ? "100" : b.losses[0]);
  const { base: p0, cot } = b.byLoss[loss];
  const saved = p0.adaLost - cot.adaLost;
  const maxLost = Math.max(...b.losses.map((l) => b.byLoss[l].base.adaLost));
  const brierMax = Math.max(b.brier.cot, b.brier.dispute);
  const to = day(b.to);
  const rows = [
    { key: "base", name: "Hire as requested", p: p0 },
    { key: "cot", name: "Cost of Trust", p: cot },
  ] as const;

  return (
    <div className={s.bt}>
      <div className={s.btHead}>
        <h1 className={base.h1}>Held out on mainnet: fewer failed jobs, better predictions.</h1>
        <p className={base.lede}>
          {int(b.escrows)} resolved escrows across {b.agents} agents, {day(b.from)} to {to} 2026. The prior is fitted on escrows before {day(b.splitAt)}. The {b.scored} jobs after it are scored, each priced from history that existed before the job.
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
          <h2 id="c1" className={s.chartH}>Jobs finished of {b.scored} scored</h2>
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
          <h2 id="c2" className={s.chartH}>ADA lost at {loss} ADA per job</h2>
          {rows.map((r) => (
            <div key={r.key} className={s.cRow}>
              <span className={s.cName}>{r.name}</span>
              <span className={s.hbar}><i data-kind={r.key} style={{ transform: `scaleX(${r.p.adaLost / maxLost})` }} /></span>
              <span className={`${base.fig} ${s.cVal}`}>{int(r.p.adaLost)} ADA</span>
            </div>
          ))}
          <p className={s.delta}>{saved > 0 ? <>Cost of Trust keeps <b className={base.fig}>{int(saved)} ADA</b> that hiring as requested loses.</> : "No difference at this stake."}</p>
        </section>

        <section className={s.chart} aria-labelledby="c3">
          <h2 id="c3" className={s.chartH}>Brier score for predicting non-delivery, walk-forward, lower is better</h2>
          {[{ key: "cot", name: "Cost of Trust", v: b.brier.cot }, { key: "base", name: "Dispute rate", v: b.brier.dispute }].map((r) => (
            <div key={r.key} className={s.cRow}>
              <span className={s.cName}>{r.name}</span>
              <span className={s.hbar}><i data-kind={r.key} style={{ transform: `scaleX(${r.v / brierMax})` }} /></span>
              <span className={`${base.fig} ${s.cVal}`}>{r.v.toFixed(3)}</span>
            </div>
          ))}
        </section>
      </div>

      <p className={base.src}>
        Source: web/src/data/backtest.json, heldOut policies P0 and P3-new, {b.scored} scored jobs, each rate computed on the same {b.scored}. At 100 ADA the backup route observes {cot.backupObserved} backup legs and models {cot.backupModelled}. Largest single saving over the full window: {b.driver.name}, {int(b.driver.adaSaved)} ADA across {b.driver.decisions} decisions. Brier over {b.brier.n} walk-forward predictions.
      </p>
    </div>
  );
}
