"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmt } from "@/lib/format";
import { ROUTER_URL, type RouteResult, type SellerRecord, fetchBestRoute, fetchSellers } from "@/lib/router";
import { type Buyer, Controls, RISK_AVERSION } from "./Controls";
import { Detail } from "./Detail";
import { HeroPair } from "./HeroPair";
import { Ranking } from "./Ranking";
import { SelectionMap } from "./SelectionMap";
import { Proof } from "./Proof";
import { Showcase } from "./Showcase";
import { Subhire } from "./Subhire";
import { Backtest } from "./Backtest";
import { Sellers } from "./Sellers";
import { Verdict } from "./Verdict";

const LOSS_ADA = 100;
const START_ROUTER = "cd router && PORT=8787 bun src/server.ts";

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

function Failure({ what, message, onRetry }: { what: string; message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="border-l-[6px] border-signal bg-paper-2 p-4">
      <p className="m-0 text-[17px] font-extrabold">{what}</p>
      <p className="mt-1 text-[14px] text-muted">{ROUTER_URL} said: {message}</p>
      <p className="mt-3 text-[14px]">Start the router from the repo root:</p>
      <pre className="m-0 mt-1 overflow-x-auto bg-paper-3 p-3 text-[13px]"><code>{START_ROUTER}</code></pre>
      <button type="button" onClick={onRetry} className="btn mt-4">Ask again</button>
    </div>
  );
}

function Loading({ what }: { what: string }) {
  return (
    <div role="status" aria-live="polite">
      <p className="m-0 text-[15px] text-muted">{what}</p>
      <div className="progress mt-3" />
    </div>
  );
}

function Section({ id, title, kicker, children }: { id: string; title: string; kicker?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-6 py-12 md:py-16">
      <div className="wrap">
        <h2 id={`${id}-h`} className="head max-w-[22ch]">{title}</h2>
        {kicker && <p className="mt-3 max-w-[64ch] text-[17px] leading-snug text-muted">{kicker}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

export function Board({ runs }: { runs: React.ReactNode }) {
  const [buyer, setBuyer] = useState<Buyer>("treasury");
  const [shared, setShared] = useState(true);
  const [sellers, setSellers] = useState<Load<SellerRecord[]>>({ status: "loading" });
  const [route, setRoute] = useState<Load<RouteResult>>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);
  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const ctl = new AbortController();
    setSellers({ status: "loading" });
    fetchSellers(ctl.signal).then((data) => setSellers({ status: "ready", data }), (e: Error) => { if (!ctl.signal.aborted) setSellers({ status: "error", message: e.message }); });
    return () => ctl.abort();
  }, [nonce]);

  const agents = sellers.status === "ready" ? sellers.data.filter((s) => s.type === "agent") : [];
  const providers = sellers.status === "ready" ? sellers.data.filter((s) => s.type === "provider") : [];
  const idKey = agents.map((s) => s.id).join(",");
  const names = useMemo(() => (sellers.status === "ready" ? Object.fromEntries(sellers.data.map((s) => [s.id, s.name])) : {}), [sellers]);
  useEffect(() => {
    if (!idKey) return;
    const ctl = new AbortController();
    setBusy(true);
    fetchBestRoute({ downstreamLossAda: LOSS_ADA, riskAversion: RISK_AVERSION[buyer], sharedInfrastructure: shared, candidateSellers: idKey.split(",") }, ctl.signal).then(
      (data) => { setRoute({ status: "ready", data }); setBusy(false); },
      (e: Error) => { if (!ctl.signal.aborted) { setRoute({ status: "error", message: e.message }); setBusy(false); } },
    );
    return () => ctl.abort();
  }, [idKey, buyer, shared, nonce]);

  const failed = sellers.status === "error" ? sellers.message : route.status === "error" ? route.message : null;
  const riskAversion = RISK_AVERSION[buyer];
  const ready = !failed && route.status === "ready" ? route.data : null;

  return (
    <>
      <header className="border-b border-ink">
        <div className="wrap flex flex-wrap items-center justify-between gap-x-6">
          <p className="m-0 py-3 text-[17px] font-extrabold tracking-tight">Cost of Trust</p>
          <nav aria-label="Sections" className="flex gap-x-1 text-[14px] font-semibold">
            <a href="#ranking" className="inline-flex min-h-[44px] items-center px-2 !text-ink">Routes</a>
            <a href="#sellers" className="inline-flex min-h-[44px] items-center px-2 !text-ink">Sellers</a>
            <a href="#run" className="inline-flex min-h-[44px] items-center px-2 !text-ink">Latest run</a>
            <a href="/thesis" className="inline-flex min-h-[44px] items-center px-2 !text-ink">Thesis</a>
            <a href="/deck" className="inline-flex min-h-[44px] items-center px-2 !text-ink">Deck</a>
          </nav>
        </div>
      </header>

      <section aria-labelledby="top-h" className="relative">
        <div className="hero-rules" aria-hidden><div className="wrap h-full"><div className="rules" /></div></div>
        <div className="wrap relative z-10 grid grid-cols-1 gap-x-10 gap-y-6 py-6 md:py-8 lg:grid-cols-12 lg:gap-y-8">
          <div className="min-w-0 lg:col-span-7 lg:row-start-1">
            <p className="m-0 max-w-[52ch] text-[14px] leading-snug text-muted">Your agent pays another agent to finish a job before a deadline. Cost of Trust does not rank agents: it decides how to buy the job. Hire it alone, add a backup keeper racing for one claim UTxO, add coverage, or walk away, priced from delivery history, value at risk and shared infrastructure, then settled on Cardano.</p>
            <h1 id="top-h" className="display mt-3">Agents can buy reliability, not just access.</h1>
          </div>
          <div className="min-w-0 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1">
            <Controls buyer={buyer} onBuyer={setBuyer} shared={shared} onShared={setShared} busy={busy} />
          </div>
          <div className="lg:col-span-7 lg:row-start-2">
            <p className="m-0 max-w-[58ch] text-[18px] leading-[1.45]">Masumi refunds your fee when an agent misses. It cannot refund your deadline. Trust Check decides before you pay whether to buy a backup, and the backup is paid only if the first agent misses its checkpoint.</p>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 text-[14px] font-extrabold">
              <a href="https://preprod.sokosumi.com" className="btn whitespace-nowrap">Hire Trust Check on Sokosumi</a>
              <a href="/api/x402/trust-check#docs" className="whitespace-nowrap">Read the x402 endpoint</a>
            </div>
          </div>
        </div>
      </section>

      <Showcase />
      <Subhire />
      <Backtest />
      <Proof />


      <section id="ranking" aria-labelledby="ranking-h" className="scroll-mt-6 pb-12 md:pb-16">
        <div className="wrap">
        <div className="mb-10" data-testid="hero-pair">
            {ready ? <HeroPair result={ready} names={names} /> : failed ? <p className="m-0 text-[15px] text-muted">The numbers appear once the router answers.</p> : <Loading what={`Pricing every route at ${ROUTER_URL}.`} />}
        </div>
          <h2 id="ranking-h" className="sr-only">Why the router chose, and every route it quoted</h2>
          {failed ? (
            <Failure what="The router did not answer." message={failed} onRetry={retry} />
          ) : route.status === "loading" || sellers.status === "loading" ? (
            <Loading what={`Asking ${ROUTER_URL}/best-route to price every route across the sellers at a ${fmt(LOSS_ADA)} ADA loss.`} />
          ) : sellers.status === "ready" && sellers.data.length === 0 ? (
            <p className="m-0 border-t-[6px] border-ink pt-6 text-[17px]">The router lists no sellers. Add one to <span className="fig !font-medium">router/sellers.json</span> and reload.</p>
          ) : route.status === "ready" ? (
            <div aria-busy={busy} className={busy ? "opacity-60" : undefined} style={{ transition: "opacity 140ms var(--ease-out)" }}>
              {busy && <p role="status" className="label mb-2">Re-pricing at riskAversion {riskAversion}, sharedInfrastructure {String(shared)}</p>}
              <Verdict result={route.data} lossAda={LOSS_ADA} names={names} />
              <div className="mt-10"><Ranking result={route.data} riskAversion={riskAversion} names={names} /></div>
            </div>
          ) : null}
        </div>
      </section>

      <Section id="run" title="Every agent run, newest first" kicker="Read straight from agents/runs: each lock, payment, claim and settlement, checked against Koios.">
        {runs}
      </Section>
      {ready && <Section id="why" title="How the chosen route was priced" kicker="The router returns its arithmetic and the status of every input, so a buyer can check the number instead of trusting it."><details className="border-t-[6px] border-ink"><summary className="cursor-pointer py-4 text-[17px] font-extrabold">Inputs and method</summary><Detail result={ready} /></details><div className="mt-8"><p className="label">Live selection map from the router</p><p className="mt-2 text-[15px] text-muted">Same sellers, same 100 ADA downstream loss, four buyer and infrastructure combinations.</p><div className="mt-4"><SelectionMap sellers={agents.map((s) => s.id)} names={names} /></div></div></Section>}

      <Section id="sellers" title="Track records, with the starting assumption shown as one" kicker="A seller with no history is not scored as clean. The hatched block is the configured starting assumption; only the solid blocks are observed outcomes.">
        {sellers.status === "loading" ? <Loading what={`Reading ${ROUTER_URL}/sellers.`} /> : sellers.status === "error" ? <Failure what="Seller records unavailable." message={sellers.message} onRetry={retry} /> : <><Sellers sellers={agents} /><h3 className="mt-12 text-[24px] font-extrabold">Measured RPC providers</h3><p className="mt-2 text-[15px] text-muted">Measured infrastructure stays visible for comparison, but it is excluded from the buyer-facing candidate set.</p><div className="mt-4"><Sellers sellers={providers} /></div></>}
      </Section>

      <footer className="border-t border-ink">
        <div className="wrap py-6 text-[13px] text-muted">Router <span className="fig !text-[13px] !font-medium">{ROUTER_URL}</span>. Figures in ADA, read from the router response, to two decimals.</div>
      </footer>
    </>
  );
}
