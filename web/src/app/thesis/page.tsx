import { ProblemProof } from "@/components/ProblemProof";
import showcase from "@/data/showcase.json";
import Link from "next/link";
import { coworker, ecosystem, footnotes, instant, measurement, measurementSentence, priorArt, quotes, race, stall, tx } from "./evidence";
import styles from "./styles.module.css";

const short = (hash: string) => `${hash.slice(0, 10)}...${hash.slice(-8)}`;

const knight = showcase.agents.find((agent) => agent.agentName === "Knight");
const knightSettled = knight ? knight.delivery.paid + knight.delivery.refunded + knight.delivery.disputed : 0;

const trustCheck = [
  ["Funds locked", coworker[0][1]],
  ["Result submitted", coworker[1][1]],
  ["Seller collects", coworker[2][1]],
] as const;

export const metadata = {
  title: "The thesis | Cost of Trust",
  description: "An agent pays Trust Check over x402 before it hires another agent. The answer is hire, hire a backup, or do not hire.",
};

function Txs({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <ul className={styles.txList}>
      {rows.map(([label, hash]) => (
        <li key={hash}>
          <div className={styles.txRow}>
            <span>{label}</span>
            <a className={styles.inlineLink} href={tx(hash)} target="_blank" rel="noreferrer">{short(hash)} ↗</a>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ThesisPage() {
  return (
    <main className={styles.page}>
      <header className={styles.mast}>
        <div className="wrap"><div className={styles.mastInner}>
          <Link className={styles.brand} href="/">Cost of Trust</Link>
          <nav className={styles.nav} aria-label="Thesis routes"><Link href="/thesis">Thesis</Link><Link href="/deck">Deck</Link></nav>
        </div></div>
      </header>

      <section className={styles.intro}>
        <div className="wrap"><div className={styles.introGrid}>
          <div><p className={styles.kicker}>The call between two agents</p><h1>Ask before the coworker pays.</h1></div>
          <p className={styles.lede}>The buyer is an agent about to pay for data, compute, an API call, or another agent&apos;s service. It buys a Trust Check over x402. The answer is hire, hire a backup, or do not hire. The job is paid through Masumi.</p>
        </div></div>
      </section>

      <section className={styles.section}>
        <div className="wrap"><div className={styles.sectionGrid}>
          <p className={styles.kicker}>01 / the payment</p>
          <div className={styles.prose}>
            <h2>Settling the transfer is not the hire.</h2>
            <p>x402 answers 402 and settles the request. Masumi holds the escrow, the refund, and the dispute. The hiring agent still chooses who receives that escrow. A dispute count hires the agent that refunds every job.</p>
            <div className={styles.pull}>A coworker asks before it pays.</div>
            <ul className={styles.quoteList} aria-label="What builders said">
              {quotes.map((quote) => <li key={quote.source}><q className={styles.quote}>{quote.text}</q><a className={styles.cite} href={quote.href} target="_blank" rel="noreferrer">{quote.source} ↗</a></li>)}
            </ul>
          </div>
        </div></div>
      </section>

      <section className={styles.section}>
        <div className="wrap">
          <div className={styles.sectionGrid}>
            <p className={styles.kicker}>02 / the answer</p>
            <div className={styles.prose}>
              <h2>One call. Three answers.</h2>
              <ul className={styles.answers} aria-label="Trust Check answers">
                <li>Hire</li>
                <li>Hire a backup</li>
                <li>Do not hire</li>
              </ul>
              <p>The record is paid, refunded, and disputed. The check reports the average and the variance of how long results actually took, and of the latest time the seller set on the escrow. A caller deadline tighter than that usual response buys a backup. More than one refund in five, or an endpoint that is down, is do not hire.</p>
              {knight ? <p>Knight has {knight.delivery.disputed} disputes and {knight.delivery.refunded} refunds out of {knightSettled} settled escrows. A dispute count calls that record clean. Trust Check says do not hire.</p> : null}
              {/* Source: probe of every mainnet Masumi registry entry's /availability on 2026-10-07 (policy ad6424e3...). */}
              <p>Of 92 mainnet agent entries with an API URL, 44 run on two servers and 7 answer MIP-003 <code>/availability</code>. Two agents that look independent can be one machine.</p>
            </div>
          </div>
          <div className={styles.shots}><ProblemProof /></div>
        </div>
      </section>

      <section className={styles.section}>
        <div className="wrap"><div className={styles.sectionGrid}>
          <p className={styles.kicker}>03 / the measurement</p>
          <div>
            <h2>Refund history predicts the next miss.</h2>
            <p className={styles.prose}>{measurementSentence()}</p>
            <div className={styles.metricBand} aria-label="Later mainnet jobs">
              <div className={styles.metric}><span className={styles.kicker}>Skip high-refund agents</span><strong className={styles.metricValue}>{measurement.skipDone}</strong><span className="label">jobs finished</span></div>
              <div className={styles.metric}><span className={styles.kicker}>Hire every agent</span><strong className={styles.metricValue}>{measurement.hireAllDone}</strong><span className="label">jobs finished</span></div>
              <div className={styles.metric}><span className={styles.kicker}>Refund-history Brier</span><strong className={styles.metricValue}>{measurement.brier.toFixed(3)}</strong><span className="label">lower is better</span></div>
              <div className={styles.metric}><span className={styles.kicker}>Dispute-rate Brier</span><strong className={styles.metricValue}>{measurement.disputeBrier.toFixed(3)}</strong><span className="label">{measurement.observations} jobs</span></div>
            </div>
            <p className={`${styles.prose} mt-5`}>At 100 ADA at risk, that skip leaves {measurement.skipUndone} ADA of work undone. Hiring every agent leaves {measurement.hireAllUndone} ADA undone, across {measurement.jobs} later decisions.</p>
            <ul className={styles.sourceList} aria-label="Where the payment runs">
              {ecosystem.map((item) => <li key={item.name}><div className={styles.sourceRow}><a className={styles.sourceName} href={item.href} target="_blank" rel="noreferrer">{item.name} ↗</a><p className={styles.sourceText}>{item.text}</p></div></li>)}
            </ul>
          </div>
        </div></div>
      </section>

      <section className={styles.section}>
        <div className="wrap"><div className={styles.sectionGrid}>
          <p className={styles.kicker}>04 / on chain</p>
          <div>
            <h2>The decision has a transaction.</h2>
            <h3>A stalls. B delivers.</h3>
            <p className={styles.prose}>Two Masumi escrows on Cardano preprod. A returns nothing. B&apos;s result lands, and A&apos;s payment is withdrawn as a refund. The caller&apos;s deadline still has time left.</p>
            <Txs rows={stall} />
            <h3 className="mt-12">One lock. One claim.</h3>
            <p className={styles.prose}>Both keepers are paid against one claim-vault UTxO. Keeper A&apos;s claim is confirmed. Keeper B&apos;s second spend of that same input is rejected at submission with BadInputsUTxO. The rejected spend has no confirmed transaction.</p>
            <Txs rows={race} />
            <h3 className="mt-12">Trust Check, paid end to end</h3>
            <p className={styles.prose}>Sokosumi task 01a11153-9886. The check is funded, the result is submitted, and the seller collects.</p>
            <Txs rows={trustCheck} />
            <p className={`${styles.prose} mt-5`}>A separate instant path confirmed {instant.confirmed.confirmed} of {instant.confirmed.requests} requests, p50 {Math.round(instant.confirmed.p50)} ms. Split transaction <a className={styles.inlineLink} href={tx(instant.split)} target="_blank" rel="noreferrer">{short(instant.split)} ↗</a>.</p>
          </div>
        </div></div>
      </section>

      <section className={styles.section}>
        <div className="wrap"><div className={styles.sectionGrid}>
          <p className={styles.kicker}>05 / prior art</p>
          <div className={styles.prose}>
            <h2>Payment, discovery, and disputes each stop one step short.</h2>
            <p>Trust Check sits in the request. The agent asks, pays the check over x402, and receives hire, hire a backup, or do not hire before Masumi funds the job.</p>
            <ul className={styles.priorList} aria-label="What already exists">
              {priorArt.map((item) => <li key={item.name}><div className={styles.priorRow}><a className={styles.priorName} href={item.href} target="_blank" rel="noreferrer">{item.name} ↗</a><p className={styles.priorText}><strong>{item.does}.</strong> {item.gap}.</p></div></li>)}
            </ul>
          </div>
        </div></div>
      </section>

      <section className={styles.section}>
        <div className="wrap"><div className={styles.sectionGrid}>
          <p className={styles.kicker}>06 / close</p>
          <div className={styles.prose}>
            <h2>Ask, then pay.</h2>
            <p>{measurementSentence()}</p>
            <p>The coworker that is about to hire asks Trust Check first. The answer is hire, hire a backup, or do not hire.</p>
            <div className={styles.footnotes}><ol>{footnotes.map(([n, text]) => <li key={n}><sup>{n}</sup> {text}</li>)}</ol></div>
          </div>
        </div></div>
      </section>

      <footer className={styles.footer}><div className="wrap"><div className={styles.footerInner}><span>Cost of Trust / Trust Check</span><span><Link href="/deck">Open the deck</Link></span></div></div></footer>
    </main>
  );
}
