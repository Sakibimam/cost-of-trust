"use client";
import Link from "next/link";
import type { SlideProps } from "./shared";
import base from "./styles.module.css";
import s from "./proof.module.css";

type CloseProps = SlideProps & { go: (n: number) => void };

export function Close({ data, run, go }: CloseProps) {
  const k = data.knight;
  const b = data.backtest.byLoss["100"];
  const slack = Math.round((Date.parse(data.run.buyerDeadline) - Date.parse(data.run.resultAt)) / 1000);
  const accounts: Array<{ n: number; text: string; fig: string }> = [
    { n: 0, text: `${k.name} escrows refunded, with zero disputes`, fig: `${k.refunded} of ${k.paid + k.refunded + k.disputed}` },
    { n: 5, text: "Backup keeper paid only when A stalls, on Cardano preprod", fig: "B paid" },
    { n: 6, text: `Held-out mainnet jobs finished, against ${b.base.done} hiring as requested`, fig: `${b.cot.done} of ${data.backtest.scored}` },
    { n: 7, text: "Masumi stall run, buyer deadline met with time to spare", fig: `${Math.floor(slack / 60)} min ${String(slack % 60).padStart(2, "0")} s` },
  ];

  return (
    <div className={s.close}>
      <div className={s.closeMain}>
        <h1 className={base.h1}>The buyer is an agent paying another agent.</h1>
        <ul key={run} className={s.buyers}>
          <li>Data</li>
          <li>Compute</li>
          <li>API calls</li>
          <li>Another agent&apos;s service</li>
        </ul>
        <p className={s.ask}>Before it pays, it buys a Trust Check.</p>
        <p className={base.lede}>One call returns hire, hire a backup, or do not hire, from that seller&apos;s paid, refunded, and disputed escrows. The check is paid over x402. The job is paid through Masumi. Live at <span className={base.fig}>/api/x402/trust-check</span>.</p>
        <div className={s.cta}>
          <Link className={base.btn} href="/">Open the live app</Link>
          <Link className={base.btn} href="/thesis">Read the thesis</Link>
        </div>
      </div>

      <div className={s.accounts}>
        <p className={s.accH}>Account of record</p>
        {accounts.map((a) => (
          <button key={a.n} type="button" className={`${base.entry} ${s.acc}`} onClick={() => go(a.n)}>
            <span>{a.text}</span><i className={base.lead} aria-hidden="true" /><span className={base.val}>{a.fig}</span>
          </button>
        ))}
        <p className={base.src}>Each line opens the slide that carries its evidence.</p>
      </div>
    </div>
  );
}
