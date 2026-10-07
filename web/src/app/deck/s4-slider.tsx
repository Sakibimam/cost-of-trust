"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SlideProps } from "./shared";
import { ada } from "./shared";
import { ROUTES, costOf, verdict } from "./routes";
import type { RouteKey } from "./routes";
import type { SliderRow } from "./data";
import base from "./styles.module.css";
import s from "./early.module.css";

const MIN = 5;
const MAX = 500;
const SWEEP_TO = 100;

// The purchase with the lowest risk-adjusted cost at this stake, whatever the recommendation says.
const cheapest = (row: SliderRow): RouteKey => ROUTES.reduce((best, r) => (costOf(row, r.key) < costOf(row, best) ? r.key : best), ROUTES[0].key);

export function SliderSlide({ data, active, run, reduced }: SlideProps) {
  const [value, setValue] = useState(reduced ? SWEEP_TO : MIN);
  const [tight, setTight] = useState(true);
  const touched = useRef(false);
  const rows = tight ? data.slider.tight : data.slider.open;
  const row = rows[value - MIN];
  const v = verdict(row);
  const costs = ROUTES.filter((r) => r.key !== "underwritten").map((r) => ({ ...r, cost: costOf(row, r.key) }));
  const top = Math.max(...costs.map((c) => c.cost));

  const flip = useMemo(() => rows.find((r) => r[5] < r[3])?.[0], [rows]);
  const bands = useMemo(() => {
    const out: Array<{ from: number; to: number; route: string }> = [];
    for (const r of rows) {
      const route = cheapest(r);
      const last = out[out.length - 1];
      if (last && last.route === route) last.to = r[0];
      else out.push({ from: r[0], to: r[0], route });
    }
    return out;
  }, [rows]);

  useEffect(() => {
    if (!active) return;
    touched.current = false;
    if (reduced) { setValue(SWEEP_TO); return; }
    setValue(MIN);
    const t0 = performance.now();
    const dur = 2200;
    let raf = 0;
    const tick = (now: number) => {
      if (touched.current) return;
      const k = Math.min(1, (now - t0 - 600) / dur);
      if (k > 0) setValue(Math.round(MIN + (SWEEP_TO - MIN) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, run, reduced]);

  const pos = (x: number) => ((x - MIN) / (MAX - MIN)) * 100;
  const minutes = data.slider.deadlineMinutes;
  return (
    <div className={s.slide4}>
      <div className={s.s4head}>
        <h1 className={base.h1}>The stake changes the answer.</h1>
        <p className={base.lede}>
          {data.agent.name}: {data.agent.paid} paid, {data.agent.refunded} refunded, median {data.agent.medianSeconds} s, live API up. From {MIN} to {MAX} ADA at risk, the answer stays hire or hire a backup. The caller&apos;s deadline is what buys the backup.
        </p>
      </div>

      <div className={s.panel}>
        <div className={s.sliderRow}>
          <label htmlFor="stake" className={s.sliderLabel}>ADA at risk</label>
          <output htmlFor="stake" className={`${base.fig} ${s.stakeOut}`}>{value}<span> ADA</span></output>
        </div>
        <div className={s.rangeWrap}>
          <input id="stake" className={s.range} type="range" min={MIN} max={MAX} step={1} value={value} onChange={(e) => { touched.current = true; setValue(Number(e.target.value)); }} aria-valuetext={`${value} ADA at risk, ${v.label}`} />
          {flip ? <span className={s.flip} style={{ left: `${pos(flip)}%` }} aria-hidden="true" /> : null}
        </div>
        <div className={s.bands} aria-hidden="true">
          {bands.map((b) => (
            <i key={b.from} data-route={b.route} style={{ left: `${pos(b.from)}%`, width: `${pos(b.to + 1) - pos(b.from)}%` }} />
          ))}
        </div>
        <div className={s.rangeEnds} aria-hidden="true"><span className={base.fig}>{MIN}</span><span className={base.fig}>{MAX}</span></div>

        <div className={s.verdict} aria-live="polite" aria-atomic="true">
          <span className={s.verdictK}>Cost of Trust says</span>
          <strong className={s.verdictV} data-route={v.route}>{v.label}</strong>
          <span className={`${base.fig} ${s.verdictE}`}>expected cost {ada(row[7])} ADA</span>
        </div>

        <div className={s.quotes} role="table" aria-label="Risk-adjusted cost by purchase">
          {costs.map((c) => (
            <div key={c.key} role="row" className={s.q} data-chosen={c.key === v.route}>
              <span role="cell" className={s.qName}>{c.short}{c.key === v.route ? <b className={s.chosen}> chosen</b> : null}</span>
              <span role="cell" className={s.qBar}><i style={{ transform: `scaleX(${c.cost / top})` }} /></span>
              <span role="cell" className={`${base.fig} ${s.qVal}`}>{ada(c.cost)}</span>
            </div>
          ))}
        </div>
        <div className={s.opts}>
          <button type="button" className={base.btn} role="switch" aria-checked={tight} onClick={() => setTight((x) => !x)}>
            Caller needs the result within {minutes} minute: {tight ? "yes" : "no"}
          </button>
          <span className={s.optNote}>
            {tight ? `The usual result takes ${data.agent.medianSeconds} s, so the check pays a backup.` : "No deadline pressure, so the check hires the agent alone."}
            {flip ? ` From ${flip} ADA at risk the backup is the cheaper purchase after risk.` : ""}
          </span>
        </div>
      </div>
      <p className={base.src}>Each point is a run of decide() in coworker/src/report.ts over the {data.agent.name} escrow record in web/src/data/escrow-index.json and the agent&apos;s live /availability, risk aversion {data.slider.riskAversion}. The 5, 100 and 500 ADA points equal the answer GET /api/check gives for the same agent, with and without a {minutes} minute deadline. Risk-adjusted ADA = price + premium + expected loss + risk aversion x loss standard deviation.</p>
    </div>
  );
}
