"use client";
import { useState } from "react";
import type { SlideProps } from "./shared";
import { Tx, utc } from "./shared";
import base from "./styles.module.css";
import s from "./proof.module.css";

const T = (iso: string) => Date.parse(iso.match(/^\d{4}-\d\d-\d\dT[\d:.]+Z/)![0]);
const clock = (ms: number) => utc(new Date(ms).toISOString());
const span = (sec: number) => `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, "0")} s`;

export function Stall({ data, run }: SlideProps) {
  const tl = data.run.timeline;
  const at = {
    quote: Date.parse(data.run.quoteAt),
    aHired: T(tl.A_hired),
    checkpoint: T(tl.buyer_checkpoint),
    bHired: T(tl.B_hired),
    bResult: T(tl.B_result_on_chain),
    deadline: Date.parse(data.run.buyerDeadline),
    refundAsk: T(tl.A_refund_requested),
    refundDone: T(tl.A_refund_withdrawn_confirmed),
  };
  const tx = (role: string) => data.run.txs.find((t) => t.id === role)!;
  const lockA = Date.parse(tx("masumi-lockA").at);
  const lockB = Date.parse(tx("masumi-lockB").at);
  const reqTx = Date.parse(tx("masumi-refundReq").at);
  const T0 = Math.floor(at.quote / 60000) * 60000;
  const T1 = Math.ceil((at.refundDone + 30000) / 60000) * 60000;
  const f = (ms: number) => (ms - T0) / (T1 - T0);
  const slack = Math.round((at.deadline - at.bResult) / 1000);
  const [replay, setReplay] = useState(0);
  const ticks: number[] = [];
  for (let m = Math.ceil(T0 / 600000) * 600000; m <= T1; m += 600000) ticks.push(m);

  const entries: Array<{ at: number; text: string; tx?: string; mark?: "ok" | "loss" }> = [
    { at: at.quote, text: "Trust Check prices the job and recommends a backup" },
    { at: at.aHired, text: "Agent A hired through Masumi escrow" },
    { at: at.checkpoint, text: "Buyer checkpoint: A has returned nothing, backup B is hired" },
    { at: lockA, text: "A escrow locked on chain", tx: "masumi-lockA" },
    { at: lockB, text: "B escrow locked on chain", tx: "masumi-lockB" },
    { at: at.bResult, text: `B result on chain, deadline met with ${span(slack)} to spare`, tx: "masumi-resultB", mark: "ok" },
    { at: at.deadline, text: "Buyer deadline", mark: "loss" },
    { at: at.refundAsk, text: "A refund requested from the payment service" },
    { at: reqTx, text: "A refund request on chain", tx: "masumi-refundReq" },
    { at: at.refundDone, text: "A refund withdrawn on chain", tx: "masumi-refundDone" },
  ];

  return (
    <div className={s.st}>
      <div className={s.stHead}>
        <button type="button" className={`${base.btn} ${s.tlReplay}`} onClick={() => setReplay((n) => n + 1)}>Replay</button>
        <h1 className={base.h1}>On Masumi itself: A stalls, B delivers, the deadline holds.</h1>
        <p className={base.lede}>Real escrows on Cardano preprod through the Masumi payment service. B&apos;s result lands <b className={base.fig}>{span(slack)}</b> before the caller&apos;s deadline, and A&apos;s payment returns as a refund.</p>
      </div>

      <div key={`${run}-${replay}`} className={s.tl}>
        <span className={s.vlab} data-kind="checkpoint" style={{ left: `${f(at.checkpoint) * 100}%` }}>checkpoint</span>
        <span className={`${s.vlab} ${s.loss}`} data-kind="deadline" style={{ left: `${f(at.deadline) * 100}%` }}>deadline</span>
        <div className={s.tlBody}>
          <div className={s.tlLane}>
            <span className={s.tlWho}>Agent A <b>no result, then refund</b></span>
            <span className={s.tlRail}>
              <i className={s.wait} style={{ left: `${f(at.aHired) * 100}%`, width: `${(f(at.refundAsk) - f(at.aHired)) * 100}%` }} />
              <i className={s.refund} style={{ left: `${f(at.refundAsk) * 100}%`, width: `${(f(at.refundDone) - f(at.refundAsk)) * 100}%` }} />
            </span>
          </div>
          <div className={s.tlLane}>
            <span className={s.tlWho}>Agent B <b>hired at the checkpoint, result on chain {clock(at.bResult)}</b></span>
            <span className={s.tlRail}>
              <i className={s.work} style={{ left: `${f(at.bHired) * 100}%`, width: `${(f(at.bResult) - f(at.bHired)) * 100}%` }} />
            </span>
          </div>
          <i className={s.vline} data-kind="checkpoint" style={{ left: `${f(at.checkpoint) * 100}%` }} />
          <i className={s.vline} data-kind="deadline" style={{ left: `${f(at.deadline) * 100}%` }} />
        </div>
        <div className={s.tlAxis} aria-hidden="true">
          {ticks.map((m) => (<span key={m} className={base.fig} style={{ left: `${f(m) * 100}%` }}>{clock(m).slice(0, 5)}</span>))}
        </div>
        <i className={s.cover} aria-hidden="true" />
      </div>
      <ol className={s.log}>
        {entries.map((e) => (
          <li key={e.at + e.text} data-mark={e.mark} style={{ "--p": f(e.at) } as React.CSSProperties}>
            <time className={base.fig} dateTime={new Date(e.at).toISOString()}>{clock(e.at)}</time>
            <span>{e.text}</span>
            <i className={base.fig}>{e.tx ? <Tx data={data} id={e.tx} className={base.fig} /> : null}</i>
          </li>
        ))}
      </ol>
      <p className={base.src}>Source: agents/runs/2026-10-07T07-36-20Z-masumi-backup-stall-final.json. Times are UTC from the run record and the confirmed Koios tx_status reads. Chain rows show each transaction&apos;s on-chain time.</p>
    </div>
  );
}
