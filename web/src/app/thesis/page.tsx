import Link from "next/link";
import { coworker, ecosystem, footnotes, instant, priorArt, quotes, runs, tx } from "./evidence";
import styles from "./styles.module.css";

const short = (hash: string) => `${hash.slice(0, 10)}...${hash.slice(-8)}`;

export const metadata = {
  title: "The thesis | Cost of Trust",
  description: "Why agent hiring needs risk-priced routes and bonded backup keepers.",
};

export default function ThesisPage() {
  return (
    <main className={styles.page}>
      <header className={styles.mast}>
        <div className="wrap"><div className={styles.mastInner}>
          <Link className={styles.brand} href="/">Cost of Trust</Link>
          <nav className={styles.nav} aria-label="Research routes"><Link href="/thesis">Thesis</Link><Link href="/deck">Deck</Link></nav>
        </div></div>
      </header>

      <section className={styles.intro}>
        <div className="wrap"><div className={styles.introGrid}>
          <div><p className={styles.kicker}>A research thesis for agentic commerce</p><h1>Price who to trust before you spend.</h1></div>
          <p className={styles.lede}>Agents hiring agents pay for trust blindly. Cost of Trust makes the counterparty, the failure cost, and the backup route part of the price.</p>
        </div></div>
      </section>

      <section className={styles.section}>
        <div className="wrap"><div className={styles.sectionGrid}>
          <div><p className={styles.kicker}>01 / problem</p><h2>The cheapest quote is not the cheapest outcome.</h2></div>
          <div className={styles.prose}>
            <p>When a deadline-bound agent pays a keeper, the invoice is only the first number. A missed submission can destroy more value than the request costs. Plain x402 settles the transfer, but the buyer still has to choose the recipient and absorb whatever happens next.</p>
            <p>The evidence is not a hypothetical edge case. The x402 specification has open requests for refunds, wrong-tier payments, and payment limbo. Service discovery can also reward activity instead of delivery. A seller can look cheap, popular, or available while making the buyer's deadline more expensive.</p>
            <div className={styles.pull}>Trust is not a feeling. It is a route decision with a loss distribution.</div>
            <ul className={styles.quoteList} aria-label="Research demand quotes">
              {quotes.map((quote) => <li key={quote.source}><q className={styles.quote}>{quote.text}</q><a className={styles.cite} href={quote.href} target="_blank" rel="noreferrer">{quote.source} ↗</a></li>)}
            </ul>
          </div>
        </div></div>
      </section>

      <section className={styles.section}>
        <div className="wrap"><div className={styles.sectionGrid}>
          <div><p className={styles.kicker}>02 / evidence</p><h2>The ecosystem already has the rails. The decision layer is missing.</h2></div>
          <div className={styles.prose}>
            <p>Masumi gives agent commerce an escrow, registry, identity, and payment vocabulary. Sokosumi turns that vocabulary into a buyer and seller surface. Cardano has an exact x402 scheme and a facilitator path. Those pieces answer whether a payment can happen. They do not yet answer which counterparty should receive it when the deadline matters.</p>
            <ul className={styles.sourceList} aria-label="Ecosystem facts">
              {ecosystem.map((item) => <li key={item.name}><div className={styles.sourceRow}><a className={styles.sourceName} href={item.href} target="_blank" rel="noreferrer">{item.name} ↗</a><p className={styles.sourceText}>{item.text}</p></div></li>)}
            </ul>
            <div className={styles.metricBand} aria-label="Measured provider evidence">
              <div className={styles.metric}><span className={styles.kicker}>authenticated Koios</span><strong className={styles.metricValue}>60 / 60</strong><span className="label">successes</span></div>
              <div className={styles.metric}><span className={styles.kicker}>public Koios</span><strong className={styles.metricValue}>0 / 60</strong><span className="label">HTTP 429</span></div>
              <div className={styles.metric}><span className={styles.kicker}>Tatum</span><strong className={styles.metricValue}>60 / 60</strong><span className="label">successes</span></div>
              <div className={styles.metric}><span className={styles.kicker}>source</span><strong className={styles.metricValue}>60</strong><span className="label">calls each</span></div>
            </div>
            <p className="mt-3 text-[13px] text-muted">Provider measurement: <a className={styles.inlineLink} href="/" >router/probes/results-20261006051159.json</a>.</p>
          </div>
        </div></div>
      </section>

      <section className={styles.section}>
        <div className="wrap"><div className={styles.sectionGrid}>
          <div><p className={styles.kicker}>03 / prior art</p><h2>Discovery, escrow, and arbitration each stop one step short.</h2></div>
          <div className={styles.prose}>
            <p>The prior art is useful because it makes the missing wedge legible. Cost of Trust does not replace the payment rail or become another activity leaderboard. It prices observed failure, infrastructure correlation, and protection before the buyer commits.</p>
            <ul className={styles.priorList} aria-label="Competitor and prior-art map">
              {priorArt.map((item) => <li key={item.name}><div className={styles.priorRow}><a className={styles.priorName} href={item.href} target="_blank" rel="noreferrer">{item.name} ↗</a><p className={styles.priorText}><strong>{item.does}.</strong> {item.gap}.</p></div></li>)}
            </ul>
          </div>
        </div></div>
      </section>

      <section className={styles.section}>
        <div className="wrap"><div className={styles.sectionGrid}>
          <div><p className={styles.kicker}>04 / thesis</p><h2>Price trust as expected loss plus a bonded backup keeper.</h2></div>
          <div className={styles.prose}>
            <p>The router takes the seller price, the observed delivery history, the buyer's risk aversion, and whether keepers share infrastructure. It returns single, redundant, staggered, and underwritten routes with their arithmetic and terms hash.</p>
            <div className={styles.formula}><strong>risk-adjusted cost</strong> = service price + premium + expected loss + risk aversion × loss standard deviation</div>
            <p>On Cardano, a staggered route is more than a second HTTP request. A single claim-vault UTxO can be spent once. Validity intervals give keeper A the first slot and keeper B the late slot. The chain pays the keeper whose slot lands. If the infrastructure is shared, the backup can fail with the primary, so a bonded underwriter prices the tail instead.</p>
            <p>Coverage settles through a separate collateral UTxO. The CRE workflow observes the task, signs the outcome, and the Plutus V3 validator checks the report binding, signer threshold, DON digest, and settlement window before releasing collateral.</p>
          </div>
        </div></div>
      </section>

      <section className={styles.section}>
        <div className="wrap"><div className={styles.sectionGrid}>
          <div><p className={styles.kicker}>05 / proof</p><h2>The thesis has a chain record.</h2></div>
          <div className={styles.prose}>
            <p className={styles.proofIntro}>Four completed preprod runs exercise underwritten settlement, expiry, fallback, and a second covered claim. Trust Check also completed a paid Masumi task end to end. Instant mode confirmed 20 of 20 requests and provides a second measurement surface.</p>
            <ul className={styles.proofList} aria-label="Confirmed preprod runs">
              {runs.map((run) => <li key={run.time}><div className={styles.proofRow}><span className={styles.proofTime}>{run.time} UTC</span><span className={styles.proofRoute}>{run.route}</span><div><span>{run.label}</span><div className={styles.hashes}>{run.hashes.map((hash) => <a key={hash} href={tx(hash)} target="_blank" rel="noreferrer">{short(hash)} ↗</a>)}</div></div></div></li>)}
            </ul>
            <h3 className="mt-12">Trust Check paid path</h3>
            <ul className={styles.proofList} aria-label="Trust Check transactions">
              {coworker.map(([label, hash]) => <li key={hash}><div className={styles.proofRow}><span className={styles.proofRoute}>{label}</span><span /><a href={tx(hash)} target="_blank" rel="noreferrer" className={styles.inlineLink}>{short(hash)} ↗</a></div></li>)}
            </ul>
            <h3 className="mt-12">Instant settlement benchmark</h3>
            <div className={styles.metricBand} aria-label="Instant benchmark">
              <div className={styles.metric}><span className={styles.kicker}>confirmed p50</span><strong className={styles.metricValue}>{Math.round(instant.confirmed.p50)} ms</strong></div>
              <div className={styles.metric}><span className={styles.kicker}>confirmed p95</span><strong className={styles.metricValue}>{Math.round(instant.confirmed.p95)} ms</strong></div>
              <div className={styles.metric}><span className={styles.kicker}>instant p50</span><strong className={styles.metricValue}>{Math.round(instant.instant.p50)} ms</strong></div>
              <div className={styles.metric}><span className={styles.kicker}>instant p95</span><strong className={styles.metricValue}>{Math.round(instant.instant.p95)} ms</strong></div>
            </div>
            <p className="mt-3 text-[13px] text-muted">Benchmark split transaction: <a className={styles.inlineLink} href={tx(instant.split)} target="_blank" rel="noreferrer">{short(instant.split)} ↗</a></p>
          </div>
        </div></div>
      </section>

      <section className={styles.section}>
        <div className="wrap"><div className={styles.sectionGrid}>
          <div><p className={styles.kicker}>06 / conclusion</p><h2>The payment is the last step, not the first decision.</h2></div>
          <div className={styles.prose}><p>Cost of Trust must exist before the buyer pays because the most expensive failure is choosing the wrong counterparty while believing the cheapest quote was rational. Masumi and Sokosumi supply the agent economy. Cardano supplies one-spend state and inspectable settlement. The router connects them with a price for trust.</p><p>That is the thesis: an agent should not ask only “what does this seller charge?” It should ask “what route makes the deadline affordable?”</p><div className={styles.footnotes}><ol>{footnotes.map(([n, text]) => <li key={n}><sup>{n}</sup> {text}</li>)}</ol></div></div>
        </div></div>
      </section>

      <footer className={styles.footer}><div className="wrap"><div className={styles.footerInner}><span>Cost of Trust / research thesis</span><span><Link href="/deck">Open the keyboard deck →</Link></span></div></div></footer>
    </main>
  );
}
