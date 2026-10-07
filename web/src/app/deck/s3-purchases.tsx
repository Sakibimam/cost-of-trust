"use client";
import { useState } from "react";
import type { SlideProps } from "./shared";
import { ada } from "./shared";
import { ROUTES, costOf, verdict } from "./routes";
import base from "./styles.module.css";
import s from "./early.module.css";

const AT = 100;

export function Purchases({ data, run }: SlideProps) {
  const row = data.slider.tight.find((r) => r[0] === AT)!;
  const choice = verdict(row).route;
  const [pick, setPick] = useState(choice);
  const sel = ROUTES.find((r) => r.key === pick)!;

  return (
    <div className={s.buy}>
      <div className={s.buyHead}>
        <h1 className={base.h1}>One agent, four ways to pay for the same job.</h1>
        <p className={base.lede}>
          Cost of Trust prices all four from the agent&apos;s own escrow history and the ADA at risk, then recommends one. Shown for {data.agent.name}: {data.agent.paid} paid, {data.agent.refunded} refunded, for a buyer who needs the result within {data.slider.deadlineMinutes} minute.
        </p>
      </div>

      <div key={run} className={s.routes} role="group" aria-label="Purchase options">
        <div className={s.routesHead} aria-hidden="true"><span>Purchase</span><span>Who holds the job</span><span className={s.costHead}>Risk-adjusted, {AT} ADA at risk</span></div>
        {ROUTES.map((r, i) => (
          <button key={r.key} type="button" aria-pressed={pick === r.key} className={s.route} data-on={pick === r.key} data-kind={r.key} onClick={() => setPick(r.key)} style={{ "--i": i } as React.CSSProperties}>
            <span className={s.routeName}>{r.name}</span>
            <span className={s.lane} aria-hidden="true">
              <i className={s.a} />
              <i className={s.b} />
              <i className={s.mark} />
              <i className={s.cover} />
            </span>
            <span className={`${base.fig} ${s.cost}`}>
              {ada(costOf(row, r.key))} ADA{r.key === choice ? <b className={s.chosen}> chosen</b> : null}
            </span>
          </button>
        ))}
      </div>
      <p className={s.pays} aria-live="polite"><b>{sel.short}.</b> {sel.pays}</p>
      <p className={base.src}>Figures from decide() in coworker/src/report.ts for {data.agent.name} at {AT} ADA at risk, a {data.slider.deadlineMinutes} minute buyer deadline, risk aversion {data.slider.riskAversion} (web/src/data/escrow-index.json). GET /api/check returns the same recommendation.</p>
    </div>
  );
}
