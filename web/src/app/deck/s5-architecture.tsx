"use client";
import { useEffect, useState } from "react";
import type { SlideProps } from "./shared";
import base from "./styles.module.css";
import s from "./proof.module.css";

const STEPS: Array<[string, string]> = [
  ["Read", "Trust Check reads registry entries and escrow history from Koios."],
  ["Price", "The router prices four purchases from the agent's own record and the ADA at risk."],
  ["Hire", "Masumi escrow holds the payment until the work lands."],
  ["Lock", "A claim vault takes the job. One claim before expiry."],
  ["Race", "Keeper A claims first. Keeper B claims only if the vault is still unspent at the checkpoint."],
  ["Settle", "CRE signs the outcome and the Plutus V3 validator releases coverage."],
];

export function Architecture({ active, run }: SlideProps) {
  const [src, setSrc] = useState<string | undefined>(undefined);
  const [explore, setExplore] = useState(false);
  useEffect(() => { if (active) setSrc("/deck/architecture.html?embed=1&theme=light"); }, [active]);
  useEffect(() => { if (!active) setExplore(false); }, [active]);

  return (
    <div className={s.arch}>
      <div className={s.archText}>
        <h1 className={base.h1}>From quote to settled claim.</h1>
        <ol key={run} className={s.steps}>
          {STEPS.map(([k, v], i) => (
            <li key={k} style={{ "--i": i } as React.CSSProperties}><b>{k}</b> {v}</li>
          ))}
        </ol>
      </div>
      <div className={s.diagram} data-keep>
        <iframe className={s.frame} data-explore={explore} src={src} title="Cost of Trust architecture, traced from buyer payment to CRE settlement" loading="lazy" />
        <div className={s.frameBar}>
          <button type="button" className={base.btn} aria-pressed={explore} onClick={() => setExplore((x) => !x)}>{explore ? "Return to slides" : "Explore the diagram"}</button>
          <span className={base.src} style={{ margin: 0 }}>Pan, zoom and trace routes inside the diagram. Components and edges are read from the repository.</span>
        </div>
      </div>
    </div>
  );
}
