"use client";

import { ProblemProof } from "@/components/ProblemProof";
import Link from "next/link";
import { useEffect, useState } from "react";
import { instant, runs, tx } from "../thesis/evidence";
import styles from "./styles.module.css";

const short = (hash: string) => `${hash.slice(0, 10)}...${hash.slice(-8)}`;

function SlideFrame({ index, kicker, title, children }: { index: number; kicker: string; title: string; children: React.ReactNode }) {
  return <section className={styles.slide} aria-labelledby={`slide-${index}`}><div className="wrap"><div className={styles.slideGrid}><div><p className={styles.kicker}>{kicker}</p><h1 id={`slide-${index}`}>{title}</h1>{children}</div><aside className={styles.side}><strong>{String(index + 1).padStart(2, "0")}</strong><span>Cost of Trust<br />Cardano agentic commerce</span></aside></div></div></section>;
}

export function DeckSlides() {
  const [slide, setSlide] = useState(0);
  const max = 12;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === "PageDown") setSlide((value) => Math.min(max - 1, value + 1));
      if (event.key === "ArrowLeft" || event.key === "PageUp") setSlide((value) => Math.max(0, value - 1));
      if (event.key === "Home") setSlide(0);
      if (event.key === "End") setSlide(max - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <div className={styles.page} aria-roledescription="slideshow" aria-label="Cost of Trust pitch deck">
    <header className={styles.mast}><div className="wrap"><div className={styles.mastInner}><Link className={styles.brand} href="/">Cost of Trust</Link><nav className={styles.nav} aria-label="Deck routes"><Link href="/thesis">Thesis</Link><a href="/deck/cost-of-trust.pptx">PPTX</a></nav></div></div></header>
    <div className="wrap"><div className={styles.bar}><span className={styles.counter} aria-live="polite">Slide {slide + 1} of {max}</span><span className={styles.hint}>Use ← →, Home, or End</span></div></div>
    <div aria-live="polite">
      {slide === 0 && <SlideFrame index={0} kicker="Cardano agentic commerce" title="Agents can buy reliability, not just access."><p className={styles.lede}>The cheapest keeper is not the cheapest route. Cost of Trust prices the counterparty, the deadline loss, and the backup before payment.</p></SlideFrame>}
      {slide === 1 && <SlideFrame index={1} kicker="The problem" title="Price alone is the wrong decision rule."><p className={styles.lede}>A missed deadline destroys more value than the request costs. Seller price, delivery history, infrastructure correlation, and buyer risk appetite belong in the same quote.</p><div className={styles.routeRows}><div className={styles.routeRow}><strong>10 ADA</strong><span>service price</span><b>not enough</b></div><div className={styles.routeRow}><strong>100 ADA</strong><span>deadline loss</span><b>the real input</b></div></div></SlideFrame>}
      {/* Source: docs/SPEC.md selection table, also summarized in README.md. */}
      {slide === 2 && <SlideFrame index={2} kicker="In their words" title="Builders already name the gap."><ProblemProof limit={4} className="mt-6" /></SlideFrame>}
      {/* Source: web/src/data/showcase.json (live mainnet registry) and agents/runs/2026-10-07T02-11-35-743Z.json, 2026-10-07T02-20-00-676Z.json. */}
      {slide === 3 && <SlideFrame index={3} kicker="Answer to the ranking question" title="One agent. Four ways to buy the job."><p className={styles.lede}>A ranking needs several agents. A purchase decision does not. dpa Research Agent, 13 paid escrows, 0 refunds: at 5 ADA at risk hire it alone, at 100 and 500 ADA hire it with a backup.</p><div className={styles.routeRows}><div className={`${styles.routeRow} ${styles.routeRowWide}`}><span>Dispute rate</span><strong>Knight: 0 disputes, ranked flawless</strong><span>15 of 15 escrows refunded: do not hire</span></div><div className={`${styles.routeRow} ${styles.routeRowWide}`}><span>Keeper A delivers</span><strong>backup never paid</strong><span>10 ADA not spent</span></div><div className={`${styles.routeRow} ${styles.routeRowWide}`}><span>Keeper A stalls</span><strong>vault unspent at checkpoint</strong><span>backup paid, backup claims</span></div></div></SlideFrame>}
      {slide === 4 && <SlideFrame index={4} kicker="Selection map" title="The buyer's route changes with risk and correlation."><div className={styles.routeRows}>{[["0", "independent keepers", "10.82 ADA"], ["0.25", "independent keepers", "14.89 ADA"], ["0.5", "shared infrastructure", "25.20 ADA"], ["1", "shared infrastructure", "28.20 ADA"]].map(([risk, mode, value]) => <div className={styles.routeRow} key={risk}><strong>risk {risk}</strong><span>{mode}</span><b>{value}</b></div>)}</div></SlideFrame>}
      {/* Source: docs/WRITEUP.md risk-adjusted cost formula. */}
      {slide === 5 && <SlideFrame index={5} kicker="Decision layer" title="Two buyers. Same sellers. Different winners."><p className={styles.lede}>The router returns every eligible route and selects the minimum risk-adjusted cost. The quote includes the terms hash before the buyer pays.</p><div className={styles.rule}><strong>risk-adjusted cost = service price + premium + expected loss + risk aversion × loss standard deviation</strong></div></SlideFrame>}
      {slide === 6 && <SlideFrame index={6} kicker="Cardano mechanism" title="One deadline task. One spend. One winner."><div className={styles.mechanism}>{[["01", "Quote", "route and terms hash"], ["02", "Lock", "one claim-vault UTxO"], ["03", "Race", "two keepers claim that UTxO"], ["04", "Settle", "one winner on chain"]].map(([num, head, body]) => <div className={styles.step} key={num}><span className={styles.kicker}>{num}</span><strong>{head}</strong><p>{body}</p></div>)}</div></SlideFrame>}
      {slide === 7 && <SlideFrame index={7} kicker="Masumi and Cost of Trust" title="Masumi moves payment. Cost of Trust chooses the route."><p className={styles.lede}>Masumi supplies escrow, identity, reputation, discovery, and payment execution. Cost of Trust adds observed seller histories, correlation-aware route choice, and a terms hash before x402 payment.</p></SlideFrame>}
      {/* Source: docs/GTM.md provider table and router/probes/results-20261006051159.json. */}
      {slide === 8 && <SlideFrame index={8} kicker="Measured provider evidence" title="Availability is a route input, not a footnote."><p className={styles.lede}>The router treats every 429 and non-2xx response as a failure. The probe turns free versus paid infrastructure into a decision the buyer can price.</p><div className={styles.bench}>{[["Koios auth", "60 / 60"], ["Koios public", "0 / 60"], ["Tatum", "60 / 60"], ["calls each", "60"]].map(([name, value]) => <div key={name}><span className={styles.kicker}>{name}</span><strong>{value}</strong></div>)}</div></SlideFrame>}
      {slide === 9 && <SlideFrame index={9} kicker="Trust Check Coworker" title="Diligence becomes a hiring action."><p className={styles.lede}>An agent identifier and task value at risk become a cited report. Registry, escrow history, endpoint health, and the Cost of Trust route resolve into hire, backup, coverage, or do not hire.</p></SlideFrame>}
      {slide === 10 && <SlideFrame index={10} kicker="Preprod evidence" title="The proof is confirmed and inspectable."><div className={styles.proof}>{runs.map((run) => <div className={styles.proofRow} key={run.time}><strong>{run.time}</strong><span>{run.route}</span><div>{run.hashes.map((hash) => <a key={hash} href={tx(hash)} target="_blank" rel="noreferrer">{short(hash)} ↗</a>)}</div></div>)}</div></SlideFrame>}
      {/* Source: instant/results.json. */}
      {slide === 11 && <SlideFrame index={11} kicker="Measured close" title="Trust is a route choice."><p className={styles.lede}>Instant mode confirmed 20 of 20 requests. The benchmark recorded a {Math.round(instant.instant.p50)} ms p50 and {Math.round(instant.instant.p95)} ms p95. The thesis is simple: price the counterparty, protect the deadline, let Cardano enforce the route.</p><a className={styles.download} href="/deck/cost-of-trust.pptx">Download the PPTX</a></SlideFrame>}
    </div>
    <div className="sr-only" aria-label="Deck evidence index">
      {runs.flatMap((run) => run.hashes).map((hash) => <a key={hash} href={tx(hash)}>{hash}</a>)}
    </div>
  </div>;
}
