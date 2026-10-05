"use client";

import { useCallback, useEffect, useState } from "react";
import { fmt } from "@/lib/format";
import { ROUTER_URL, type RouteResult, type SellerRecord, fetchBestRoute, fetchSellers } from "@/lib/router";
import { type Buyer, Controls, RISK_AVERSION } from "./Controls";
import { Detail } from "./Detail";
import { Ranking } from "./Ranking";
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
  const [buyer, setBuyer] = useState<Buyer>("bot");
  const [shared, setShared] = useState(false);
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

  const ids = sellers.status === "ready" ? sellers.data.map((s) => s.id) : null;
  const idKey = ids?.join(",") ?? "";
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

  return (
    <>
      <header className="border-b border-ink">
        <div className="wrap flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
          <p className="m-0 text-[17px] font-extrabold tracking-tight">Cost of Trust</p>
          <nav aria-label="Sections" className="flex gap-5 text-[14px] font-semibold">
            <a href="#ranking" className="!text-ink">Routes</a>
            <a href="#sellers" className="!text-ink">Sellers</a>
            <a href="#run" className="!text-ink">Latest run</a>
          </nav>
        </div>
      </header>

      <section aria-labelledby="top-h" className="relative">
        <div className="hero-rules" aria-hidden><div className="wrap h-full"><div className="rules" /></div></div>
        <div className="wrap relative z-10 grid grid-cols-1 gap-x-10 gap-y-8 py-6 md:py-8 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-7">
            <p className="label">A buyer agent, three keepers, one deadline</p>
            <h1 id="top-h" className="display mt-4">Price is not the cost of execution.</h1>
            <p className="mt-5 max-w-[58ch] text-[18px] leading-[1.45]">When keepers fail independently, Cardano makes a backup keeper safe: a UTxO can only be spent once. When they share infrastructure, backups fail together and coverage is cheaper.</p>
          </div>
          <div className="min-w-0 lg:col-span-5">
            <Controls buyer={buyer} onBuyer={setBuyer} shared={shared} onShared={setShared} busy={busy} />
          </div>
        </div>
      </section>

      <section id="ranking" aria-labelledby="ranking-h" className="scroll-mt-6 pb-12 md:pb-16">
        <div className="wrap">
          <h2 id="ranking-h" className="sr-only">The router's decision and every route it quoted</h2>
          {failed ? (
            <Failure what="The router did not answer." message={failed} onRetry={retry} />
          ) : route.status === "loading" || sellers.status === "loading" ? (
            <Loading what={`Asking ${ROUTER_URL}/best-route to price every route across the sellers at a ${fmt(LOSS_ADA)} ADA loss.`} />
          ) : sellers.status === "ready" && sellers.data.length === 0 ? (
            <p className="m-0 border-t-[6px] border-ink pt-6 text-[17px]">The router lists no sellers. Add one to <span className="fig !font-medium">router/sellers.json</span> and reload.</p>
          ) : route.status === "ready" ? (
            <div aria-busy={busy} className={busy ? "opacity-60" : undefined} style={{ transition: "opacity 140ms var(--ease-out)" }}>
              {busy && <p role="status" className="label mb-2">Re-pricing at riskAversion {riskAversion}, sharedInfrastructure {String(shared)}</p>}
              <Verdict result={route.data} lossAda={LOSS_ADA} />
              <div className="mt-10"><Ranking result={route.data} riskAversion={riskAversion} /></div>
            </div>
          ) : null}
        </div>
      </section>

      {route.status === "ready" && !failed && (
        <Section id="why" title="How the selected route was priced" kicker="The router returns its arithmetic and the status of every input, so a buyer can check the number instead of trusting it.">
          <Detail result={route.data} />
        </Section>
      )}

      <Section id="sellers" title="Track records, with the prior shown as a prior" kicker="A seller with no history is not scored as clean. The hatched block is the configured Beta prior; only the solid blocks are observed outcomes.">
        {sellers.status === "loading" ? <Loading what={`Reading ${ROUTER_URL}/sellers.`} /> : sellers.status === "error" ? <Failure what="Seller records unavailable." message={sellers.message} onRetry={retry} /> : <Sellers sellers={sellers.data} />}
      </Section>

      <Section id="run" title="The latest run on Cardano preprod" kicker="Every transaction the buyer agent made, with its status and a link to the explorer.">
        {runs}
      </Section>

      <footer className="border-t border-ink">
        <div className="wrap py-6 text-[13px] text-muted">Router <span className="fig !text-[13px] !font-medium">{ROUTER_URL}</span>. Figures in ADA, read from the router response, to two decimals.</div>
      </footer>
    </>
  );
}
