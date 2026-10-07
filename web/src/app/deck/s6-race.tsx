"use client";
import { useState } from "react";
import type { SlideProps } from "./shared";
import { Tx, utc } from "./shared";
import base from "./styles.module.css";
import s from "./proof.module.css";

type Mode = "stall" | "delivers" | "race";
const MODES: Array<{ id: Mode; label: string }> = [
  { id: "stall", label: "A stalls" },
  { id: "delivers", label: "A delivers" },
  { id: "race", label: "Both race" },
];

const LEDGER: Record<Mode, Array<{ at: number; id: string; label: string; bad?: boolean }>> = {
  stall: [
    { at: 0.2, id: "stall-lock", label: "Claim vault locked" },
    { at: 0.9, id: "stall-payA", label: "Keeper A paid" },
    { at: 4.2, id: "stall-payB", label: "Keeper B paid at the checkpoint" },
    { at: 5.4, id: "stall-claimB", label: "Keeper B claims the vault" },
  ],
  delivers: [
    { at: 0.2, id: "delivers-lock", label: "Claim vault locked" },
    { at: 0.9, id: "delivers-pay", label: "Keeper A paid" },
    { at: 2.8, id: "delivers-claim", label: "Keeper A claims the vault" },
  ],
  race: [
    { at: 0.2, id: "race-lock", label: "Claim vault locked" },
    { at: 0.9, id: "race-payA", label: "Keeper A paid" },
    { at: 1.1, id: "race-payB", label: "Keeper B paid" },
    { at: 3.0, id: "race-claimA", label: "Keeper A claims, first spend wins" },
  ],
};

export function Race({ data, run, reduced }: SlideProps) {
  const [mode, setMode] = useState<Mode>("stall");
  const [replay, setReplay] = useState(0);
  const cp = mode === "stall" ? utc(data.proofs.races.stall.checkpointAt) : mode === "delivers" ? utc(data.proofs.races.delivers.checkpointAt) : null;
  const saved = data.proofs.races.delivers.savedFeeAda;

  return (
    <div className={s.race}>
      <div className={s.raceHead}>
        <h1 className={base.h1}>One claim, two keepers. The chain picks the one that lands.</h1>
        <p className={base.lede}>Cardano preprod, real transactions. Keeper A holds the first window on a one-claim vault. Keeper B is paid only if the vault is still unspent at the checkpoint.</p>
      </div>

      <div className={s.modes} role="group" aria-label="Scenario">
        {MODES.map((m) => (
          <button key={m.id} type="button" className={base.btn} aria-pressed={mode === m.id} onClick={() => { setMode(m.id); setReplay((n) => n + 1); }}>{m.label}</button>
        ))}
        <button type="button" className={base.btn} onClick={() => setReplay((n) => n + 1)}>Replay</button>
      </div>

      <div key={`${run}-${mode}-${replay}`} className={s.lanes} data-mode={mode} data-reduced={reduced}>
        {cp ? <div className={s.checkpoint}><span className={base.fig}>checkpoint {cp} UTC</span></div> : null}
        <div className={s.lane}>
          <span className={s.who}>Claim vault</span>
          <span className={s.vault}>
            <i className={s.utxo} />
            <b className={s.vUnspent}>unspent</b>
            <b className={s.vSpent}>{mode === "stall" ? "spent by B" : "spent by A"}</b>
          </span>
        </div>
        <div className={s.lane}>
          <span className={s.who}>Keeper A</span>
          <span className={s.track}><i className={s.fillA} /><b className={s.noteA}>{mode === "stall" ? "stalls, no claim" : mode === "delivers" ? "claims before the checkpoint" : "claims first"}</b></span>
        </div>
        <div className={s.lane}>
          <span className={s.who}>Keeper B</span>
          <span className={s.track}><i className={s.fillB} /><b className={s.noteB}>{mode === "stall" ? "paid, claims" : mode === "delivers" ? `never paid, ${saved} ADA fee saved` : "refused by the ledger: BadInputsUTxO"}</b></span>
        </div>
      </div>

      <ol key={`l-${run}-${mode}-${replay}`} className={s.txs}>
        {LEDGER[mode].map((e) => (
          <li key={e.id} style={{ "--at": `${e.at}s` } as React.CSSProperties}>
            <span>{e.label}</span><i className={base.fig} /><Tx data={data} id={e.id} className={base.fig} />
          </li>
        ))}
        {mode === "race" ? <li style={{ "--at": "3.4s" } as React.CSSProperties} className={base.loss}><span>Keeper B claim</span><i /><span className={base.fig}>rejected, no transaction confirmed</span></li> : null}
      </ol>
      <p className={base.src}>Stall and delivers: agents/runs/2026-10-07T02-20-00-676Z.json and 2026-10-07T02-11-35-743Z.json. Both race: README keeper race. Every hash is confirmed on Cardano preprod through Koios and opens on preprod.cardanoscan.io.</p>
    </div>
  );
}
