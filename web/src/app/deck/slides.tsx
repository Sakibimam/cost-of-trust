"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { DeckData } from "./data";
import { body, display, figures } from "./fonts";
import { useReducedMotion, useRun, type SlideProps } from "./shared";
import { Escrow } from "./s1-escrow";
import { Ranking } from "./s2-ranking";
import { Purchases } from "./s3-purchases";
import { SliderSlide } from "./s4-slider";
import { Architecture } from "./s5-architecture";
import { Race } from "./s6-race";
import { Backtest } from "./s7-backtest";
import { Stall } from "./s8-stall";
import { Close } from "./s9-close";
import styles from "./styles.module.css";

const SLIDES: Array<{ id: string; title: string; Comp: (p: SlideProps & { go: (n: number) => void }) => React.ReactNode }> = [
  { id: "escrow", title: "Agent pays agent", Comp: Escrow },
  { id: "ranking", title: "Nothing to rank", Comp: Ranking },
  { id: "purchases", title: "Four ways to buy one job", Comp: Purchases },
  { id: "slider", title: "Move the stake", Comp: SliderSlide },
  { id: "architecture", title: "Quote to settled claim", Comp: Architecture },
  { id: "race", title: "Proof: the backup race", Comp: Race },
  { id: "backtest", title: "Proof: held-out mainnet", Comp: Backtest },
  { id: "stall", title: "Proof: the stall on Masumi", Comp: Stall },
  { id: "close", title: "Who buys it", Comp: Close },
];

const fromHash = () => {
  const n = parseInt(window.location.hash.replace(/^#/, ""), 10);
  return Number.isFinite(n) && n >= 1 && n <= SLIDES.length ? n - 1 : 0;
};

function SlideHost({ index, current, data, go, reduced }: { index: number; current: number; data: DeckData; go: (n: number) => void; reduced: boolean }) {
  const active = index === current;
  const run = useRun(active);
  const { Comp, id, title } = SLIDES[index];
  return (
    <section className={styles.slide} data-active={active} data-slide={id} aria-label={`${index + 1} of ${SLIDES.length}: ${title}`} inert={!active} tabIndex={-1}>
      <div className={styles.inner}>
        <Comp data={data} active={active} run={run} reduced={reduced} go={go} />
      </div>
    </section>
  );
}

export function DeckShell({ data }: { data: DeckData }) {
  const [current, setCurrent] = useState(0);
  const reduced = useReducedMotion();

  const go = useCallback((n: number) => {
    const next = Math.max(0, Math.min(SLIDES.length - 1, n));
    setCurrent(next);
    const hash = `#${next + 1}-${SLIDES[next].id}`;
    if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
  }, []);

  useEffect(() => {
    setCurrent(fromHash());
    const onHash = () => setCurrent(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t?.closest("input, textarea, select")) return;
      const onControl = !!t?.closest("button, a");
      if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && !onControl)) go(current + 1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(current - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(SLIDES.length - 1);
      else if (/^[1-9]$/.test(e.key)) go(Number(e.key) - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, go]);

  const onStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("a, button, input, label, select, iframe, svg [data-keep], [data-keep]")) return;
    if (window.getSelection()?.toString()) return;
    const rect = e.currentTarget.getBoundingClientRect();
    go(e.clientX - rect.left < rect.width * 0.12 ? current - 1 : current + 1);
  };

  return (
    <div className={`${styles.deck} ${display.variable} ${body.variable} ${figures.variable}`} aria-roledescription="slide deck" aria-label="Cost of Trust pitch deck">
      <header className={styles.mast}>
        <Link className={styles.brand} href="/">Cost of Trust</Link>
        <nav className={styles.mastLinks} aria-label="Site">
          <Link href="/">Live app</Link>
          <Link href="/thesis">Thesis</Link>
        </nav>
      </header>

      <div className={styles.stage} onClick={onStageClick}>
        {SLIDES.map((_, i) => (
          <SlideHost key={SLIDES[i].id} index={i} current={current} data={data} go={go} reduced={reduced} />
        ))}
      </div>

      <footer className={styles.foot}>
        <div className={styles.bar} role="group" aria-label="Slide progress">
          {SLIDES.map((s, i) => (
            <button key={s.id} type="button" className={styles.seg} data-state={i < current ? "past" : i === current ? "now" : "future"} onClick={() => go(i)} aria-label={`Go to slide ${i + 1}: ${s.title}`} aria-current={i === current ? "step" : undefined} />
          ))}
        </div>
        <div className={styles.footRow}>
          <span className={styles.title}>{SLIDES[current].title}</span>
          <span className={styles.hint}>Arrow keys, click or tap to move</span>
          <div className={styles.controls}>
            <button type="button" className={styles.step} onClick={() => go(current - 1)} disabled={current === 0} aria-label="Previous slide">&larr;</button>
            <span className={styles.counter} aria-live="polite" aria-atomic="true">
              <span aria-hidden="true">{String(current + 1).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")}</span>
              <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Slide {current + 1} of {SLIDES.length}</span>
            </span>
            <button type="button" className={styles.step} onClick={() => go(current + 1)} disabled={current === SLIDES.length - 1} aria-label="Next slide">&rarr;</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
