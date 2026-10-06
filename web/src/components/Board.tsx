"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmt } from "@/lib/format";
import { ROUTER_URL, type RouteResult, type SellerRecord, fetchBestRoute, fetchSellers } from "@/lib/router";
import { type Buyer, Controls, RISK_AVERSION } from "./Controls";
import { Detail } from "./Detail";
import { HeroPair } from "./HeroPair";
import { Ranking } from "./Ranking";
import { SelectionMap } from "./SelectionMap";
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
            <p className="m-0 max-w-[52ch] text-[14px] leading-snug text-muted">Your agent is about to pay someone to finish a job before a deadline. The cheapest one fails 1 in 5 times. We price that in, and Cardano enforces the backup.</p>
            <h1 id="top-h" className="display mt-3">Price is not the cost of execution.</h1>
          </div>
          <div className="min-w-0 lg:col-span-12 lg:row-start-3" data-testid="hero-pair">
            {ready ? <HeroPair result={ready} names={names} /> : failed ? <p className="m-0 text-[15px] text-muted">The numbers appear once the router answers.</p> : <Loading what={`Pricing every route at ${ROUTER_URL}.`} />}
          </div>
          <div className="min-w-0 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1">
            <Controls buyer={buyer} onBuyer={setBuyer} shared={shared} onShared={setShared} busy={busy} />
          </div>
          <p className="m-0 max-w-[58ch] text-[18px] leading-[1.45] lg:col-span-7 lg:row-start-2">When keepers fail independently, Cardano makes a backup keeper safe: a UTxO can only be spent once. When they share infrastructure, backups fail together and coverage is cheaper.</p>
        </div>
      </section>

      <section aria-labelledby="trust-check-h" className="border-y border-ink bg-paper-2 py-6 md:py-8">
        <div className="wrap"><p className="label">Trust Check, a paid AI Coworker on Sokosumi</p><h2 id="trust-check-h" className="mt-2 text-[24px] font-extrabold">Due diligence on an agent before you pay it.</h2><p className="mt-2 max-w-[70ch] text-[15px] text-muted">Masumi escrow holds the paid task while Trust Check verifies the route and returns the result on Cardano preprod.</p><div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[14px]"><a href="https://preprod.cardanoscan.io/transaction/be70aa09631cb3a7bda74bd09b91fa5d837e9408e2f889c80a71ce0bb7f08892">Escrow be70aa09</a><a href="https://preprod.cardanoscan.io/transaction/0be9fa229a864ddbaa8847afa84657d535d93d4a26fdbab506e2a2ebde573f91">Result 0be9fa22</a><a href="https://preprod.cardanoscan.io/transaction/6b8bab2e1f143467ba52001d928eade55ee71b9540b768d5870e9aaa18108630">Seller collection 6b8bab2e</a><span className="fig !text-[14px]">Task 01a11153-9886-710b-9d63-75375d11c749</span></div></div>
      </section>

      <Section id="run" title="Confirmed preprod transactions" kicker="The paid path is visible before the ranking: lock, pay, claim, and settlement are confirmed on Cardano preprod.">
        {runs}
      </Section>

      <section id="ranking" aria-labelledby="ranking-h" className="scroll-mt-6 pb-12 md:pb-16">
        <div className="wrap">
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
