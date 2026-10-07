"use client";
import { useState } from "react";
import type { SlideProps } from "./shared";
import { day, int } from "./shared";
import base from "./styles.module.css";
import s from "./early.module.css";

export function Ranking({ data, run }: SlideProps) {
  const r = data.registry;
  const buckets: Array<{ label: string; tags: number; few: boolean }> = [];
  for (const [n, tags] of r.dist) {
    if (n <= 4) buckets.push({ label: n === 1 ? "1 agent" : `${n} agents`, tags, few: n <= 2 });
  }
  buckets.push({ label: "5 or more", tags: r.dist.filter(([n]) => n >= 5).reduce((a, [, t]) => a + t, 0), few: false });
  const max = Math.max(...buckets.map((b) => b.tags));
  const [pick, setPick] = useState(0);
  const sel = buckets[pick];
  const pct = Math.round((r.oneOrTwo / r.tags) * 100);

  return (
    <div className={s.rank}>
      <div>
        <h1 className={base.h1}>Most capabilities have one or two agents, so there is nothing to rank.</h1>
        <p className={base.lede}>
          Cost of Trust does not rank. The agent about to pay that seller gets one answer: hire, hire a backup, or do not hire.
        </p>
        <div className={s.callout}>
          <span className={`${base.fig} ${s.big}`}>{r.oneOrTwo}</span>
          <span>of {r.tags} capability tags on the Masumi mainnet registry list one or two agents ({pct}%).</span>
        </div>
      </div>

      <div className={s.hist}>
        <p className={s.histHead} id="hist-h">Capability tags by number of agents</p>
        <div key={run} role="group" aria-labelledby="hist-h" className={s.bars}>
          {buckets.map((b, i) => (
            <button key={b.label} type="button" className={s.barRow} data-few={b.few} data-on={pick === i} onClick={() => setPick(i)} onFocus={() => setPick(i)} onMouseEnter={() => setPick(i)} aria-pressed={pick === i}>
              <span className={s.barLabel}>{b.label}</span>
              <span className={s.track}>
                <i className={s.fill} style={{ "--w": b.tags / max, "--i": i } as React.CSSProperties} />
              </span>
              <span className={`${base.fig} ${s.barVal}`}>{b.tags}</span>
            </button>
          ))}
        </div>
        <p className={s.detail} aria-live="polite">
          {sel.tags} capability tags list {sel.label === "5 or more" ? "five or more agents" : sel.label}.{sel.few ? " A ranking has one or two entries to order." : ""}
        </p>
        <p className={base.src}>
          Read from Koios, Masumi mainnet registry policy, at block {int(r.block)} ({day(r.readAt)} 2026 UTC). {r.liveAgents} live agents, {r.taggedAgents} with capability tags, {r.tags} distinct tags (lowercased).
        </p>
      </div>
    </div>
  );
}
