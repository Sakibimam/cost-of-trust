import { readFileSync, writeFileSync } from "node:fs";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { toClientCardanoSigner } from "@x402/cardano";
import { ExactCardanoScheme as ExactClient } from "@x402/cardano/exact/client";
import { assertCoverage, forfeit, lockClaimVault, waitForTx, type OutRef } from "@cost-of-trust/offchain";
import { config, context, parseRef, refString } from "./common";
import { checkpointDecision } from "./staggered";
const walletPath = process.env.COT_WALLETS ?? "/Users/user/Desktop/canton/recourse/.wallets.json";
const wallets = JSON.parse(readFileSync(walletPath, "utf8")) as Record<string, { seed: string }>;
const router = process.env.ROUTER_URL ?? "http://127.0.0.1:8787";
const relayer = process.env.RELAYER_URL ?? "http://127.0.0.1:4111";
const underwriter = process.env.UNDERWRITER_URL ?? "http://127.0.0.1:4110";
type RecordItem = { step: string; txHash?: string; confirmed?: boolean; error?: string; detail?: unknown };
const run: { startedAt: string; selectedRoute?: unknown; records: RecordItem[] } = { startedAt: new Date().toISOString(), records: [] };
const runFile = () => `${import.meta.dirname}/runs/${run.startedAt.replace(/[:.]/g, "-")}.json`;
const save = (item: RecordItem) => { run.records.push(item); console.error(JSON.stringify({ at: new Date().toISOString(), ...item }).slice(0, 600)); writeFileSync(runFile(), JSON.stringify(run, null, 2)); };
const record = async (step: string, txHash: string) => { await waitForTx(txHash); save({ step, txHash, confirmed: true }); };
const pay = async (url: string, body: Record<string, unknown>, seed: string, seller: { priceAda: number; payTo: string }, spent: bigint, limits: { perPayment: bigint; task: bigint }): Promise<{ response: Response; body: any; amount: bigint }> => {
  const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (first.status !== 402) return { response: first, body: await first.json(), amount: 0n };
  const client = new x402Client().setSpendControls({ maxAmountPerPayment: limits.perPayment.toString(), allowedAssets: [{ network: "cardano:preprod", asset: "lovelace", maxAmountPerPayment: limits.perPayment.toString() }] }).register("cardano:*", new ExactClient(toClientCardanoSigner({ mnemonic: seed, network: "cardano:preprod", provider: { koios: { baseUrl: process.env.X402_KOIOS_URL ?? "http://127.0.0.1:4102/koios" } } })));
  const required = new x402HTTPClient(client);
  const paymentRequired = required.getPaymentRequiredResponse((name) => first.headers.get(name));
  const accepted = paymentRequired.accepts[0];
  if (!accepted || accepted.asset !== "lovelace") throw new Error("keeper requested a disallowed asset");
  const amount = BigInt(accepted.amount);
  if (accepted.payTo !== seller.payTo) throw new Error("keeper payTo does not match router seller");
  if (amount > BigInt(Math.round(seller.priceAda * 1_000_000))) throw new Error("keeper price exceeds router quote");
  if (amount > limits.perPayment || spent + amount > limits.task) throw new Error("keeper spend exceeds buyer limit");
  const challenge = await first.json() as { job_id?: string };
  const payload = await required.createPaymentPayload(paymentRequired);
  const paid = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...required.encodePaymentSignatureHeader(payload) }, body: JSON.stringify({ ...body, ...(challenge.job_id ? { job_id: challenge.job_id } : {}) }) });
  return { response: paid, body: await paid.json(), amount };
};
async function main() {
  const buyer = await context(process.env.BUYER_CONTEXT ?? "buyer");
  const sponsor = await context(process.env.SPONSOR_CONTEXT ?? "admin2");
  const buyerWallet = wallets[process.env.BUYER_WALLET ?? process.env.BUYER_CONTEXT ?? "buyer"];
  if (!buyerWallet) throw new Error("configured buyer wallet is missing");
  const lossAda = Number(process.env.DEMO_LOSS_ADA ?? 10);
  const expiry = BigInt(Math.floor((Date.now() + Number(process.env.DEMO_EXPIRY_MINUTES ?? 10) * 60_000) / 1000) * 1000);
  const locked = await lockClaimVault(sponsor.lucid, sponsor.deployment, { beneficiary: buyer.address, expiry, value: BigInt(Math.round(lossAda * 1_000_000)) });
  await record("claim_vault_lock", locked.txHash);
  const riskAversion = Number(process.env.BUYER_RISK_AVERSION ?? 0.25);
  const sharedInfrastructure = (process.env.SHARED_INFRA ?? "true") !== "false";
  const sellerRes = await fetch(`${router}/sellers`); if (!sellerRes.ok) throw new Error(`seller discovery failed ${sellerRes.status}`); const discovered = await sellerRes.json() as Array<{ id: string; endpoint: string; priceAda?: number }>;
  const requestedCandidates = (process.env.CANDIDATE_SELLERS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const candidates = requestedCandidates.length ? discovered.filter((seller) => requestedCandidates.includes(seller.id)).map((seller) => seller.id) : discovered.map((seller) => seller.id);
  if (!candidates.length) throw new Error("CANDIDATE_SELLERS did not match router sellers");
  const localPort = (seller: string) => seller === "seller-a" ? 4101 : seller === "seller-b" ? 4102 : 4103;
  const keeperUrl = (seller: string) => { const configured = process.env[`${seller.replace("-", "_").toUpperCase()}_URL`]; const endpoint = discovered.find((item) => item.id === seller)?.endpoint; return configured ?? (endpoint && /^https?:\/\//.test(endpoint) ? endpoint.replace(/\/$/, "") : `http://127.0.0.1:${localPort(seller)}`); };
  const routeRes = await fetch(`${router}/best-route`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: "claim before expiry", serviceType: "cardano_deadline_execution", deadline: new Date(Number(expiry)).toISOString(), downstreamLossAda: lossAda, candidateSellers: candidates, riskAversion, sharedInfrastructure, constraints: { allowRedundancy: true, ...(process.env.REQUIRE_COVERAGE === "true" ? { requireCoverage: true } : {}) } }) });
  if (!routeRes.ok) throw new Error(`router quote failed ${routeRes.status}: ${await routeRes.text()}`);
  const quote = await routeRes.json() as any; run.selectedRoute = quote;
  const underwritten = quote.selectedRoute === "underwritten";
  save({ step: "route_executed", detail: { route: quote.selectedRoute, sellers: quote.selectedSellers } });
  let coverageRef: OutRef | undefined;
  const selectedQuote = quote.routes.find((r: any) => r.route === quote.selectedRoute && r.sellers.join(",") === quote.selectedSellers.join(","));
  if (!selectedQuote) throw new Error("router returned no selected route details");
  if (underwritten) { const bind = await fetch(`${underwriter}/bind`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ buyer: buyer.address, payoutAda: lossAda, coverageAda: selectedQuote.coverageAda, taskRef: refString(locked.ref), taskExpiry: String(expiry), decideBy: String(expiry + 1_860_000n), terms: { route: quote.selectedRoute, sellers: quote.selectedSellers, servicePriceAda: selectedQuote.servicePriceAda, premiumAda: selectedQuote.premiumAda, coverageAda: selectedQuote.coverageAda } }) }); const b = await bind.json() as any; if (!bind.ok) throw new Error(JSON.stringify(b)); coverageRef = parseRef(b.coverageRef); await assertCoverage(buyer.lucid, buyer.deployment, coverageRef, { buyer: buyer.address, taskRef: locked.ref, taskExpiry: expiry, config: config() }); await record("coverage_lock", b.txHash); }
  const limits = { perPayment: BigInt(process.env.MAX_PAYMENT_LOVELACE ?? "10000000"), task: BigInt(process.env.MAX_TASK_SPEND_LOVELACE ?? "20000000") };
  let spent = 0n;
  const selected = quote.selectedSellers.map((seller: string) => ({ seller, url: `${keeperUrl(seller)}/start_job`, record: discovered.find((item) => item.id === seller) }));
  const startKeeper = async ({ seller, url, record: sellerRecord }: { seller: string; url: string; record?: { priceAda: number; payTo: string } }) => {
    if (!sellerRecord) throw new Error(`router seller record missing ${seller}`);
    const paid = await pay(url, { taskId: quote.quoteId, claimVault: refString(locked.ref), beneficiary: buyer.address, expiry: String(expiry), termsHash: quote.termsHash, identifier_from_purchaser: crypto.randomUUID() }, buyerWallet.seed, sellerRecord, spent, limits);
    spent += paid.amount;
    if (!paid.response.ok) throw new Error(`${seller} returned ${paid.response.status}: ${JSON.stringify(paid.body)}`);
    if (paid.body.paymentTx) await record(`${seller}_payment`, paid.body.paymentTx);
    return `${url.replace(/\/start_job$/, "")}/status?job_id=${paid.body.job_id}`;
  };
  const pollKeeper = async (seller: string, statusUrl: string, deadline: number) => {
    for (;;) {
      const status = await (await fetch(statusUrl)).json() as { status: string; result?: Record<string, unknown>; error?: string };
      if (status.status === "failed") throw new Error(`${seller} claim rejected: ${status.error}`);
      if (status.status === "completed") {
        if (status.result?.claimTx) await record(`${seller}_claim`, String(status.result.claimTx));
        return status.result as Record<string, any>;
      }
      if (Date.now() >= deadline) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  };
  let results: Array<{ seller: string; body?: Record<string, any>; error?: string }>;
  if (quote.selectedRoute === "staggered") {
    if (selected.length !== 2) throw new Error("staggered route requires first and backup keepers");
    // 120s default: past preprod lock->seller-a claim latencies were 58s and 104s (runs 2026-10-06T04-44-21-919Z and 04-40-21-303Z), leaving 16s over the measured maximum.
    const checkpointMs = Number(process.env.STAGGER_CHECKPOINT_MS ?? 120_000);
    const checkpointAt = Number(expiry) - checkpointMs;
    if (checkpointAt <= Date.now()) throw new Error("stagger checkpoint is already past");
    const aStatus = await startKeeper(selected[0]);
    const aResult = await pollKeeper(selected[0].seller, aStatus, checkpointAt);
    if (Date.now() < checkpointAt) await new Promise((resolve) => setTimeout(resolve, checkpointAt - Date.now()));
    const decision = await checkpointDecision(locked.ref, sponsor.deployment.claimAddress);
    const bPriceAda = discovered.find((seller) => seller.id === selected[1].seller)?.priceAda;
    save({ step: decision, detail: { checkpointAt: new Date(checkpointAt).toISOString(), vaultRef: refString(locked.ref), savedFeeAda: bPriceAda } });
    if (decision === "backup_not_needed" && !aResult?.claimTx) throw new Error("claim vault was spent but seller-a supplied no claim tx");
    if (decision === "backup_not_needed") results = [{ seller: selected[0].seller, body: aResult }];
    else {
      const bStatus = await startKeeper(selected[1]);
      const bResult = await pollKeeper(selected[1].seller, bStatus, Number(expiry));
      results = [{ seller: selected[0].seller, body: aResult }, { seller: selected[1].seller, body: bResult }];
    }
  } else {
    // One buyer wallet funds every keeper payment sequentially because parallel builds spend the same UTxOs.
    let paying: Promise<unknown> = Promise.resolve();
    results = await Promise.all(selected.map(({ seller, url }: { seller: string; url: string }) => {
      const turn = paying.then(() => startKeeper({ seller, url }));
      paying = turn.catch(() => undefined);
      return turn.then((statusUrl) => pollKeeper(seller, statusUrl, Date.now() + 300_000)).then((body) => ({ seller, body })).catch((error) => { const message = error instanceof Error ? error.message : String(error); save({ step: `${seller}_claim_rejected`, error: message }); return { seller, error: message }; });
    }));
  }
  save({ step: "keeper_results", detail: results });
  if (!results.some((r) => r.body?.claimTx)) { const ms = Number(expiry) - Date.now() + 5_000; if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms)); const forfeited = await forfeit(sponsor.lucid, sponsor.deployment, locked.ref, sponsor.address, expiry); await record("claim_vault_forfeit", forfeited); }
  if (coverageRef) { const wait = Number(expiry) - Date.now() + 15_000; if (wait > 0) { save({ step: "wait_for_expiry_before_settle", detail: { ms: wait } }); await new Promise((resolve) => setTimeout(resolve, wait)); } const adjudicate = await fetch(`${relayer}/adjudicate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coverageRef: refString(coverageRef), buyerAddress: buyer.address, underwriterAddress: (await context("admin1")).address, flipReport: process.env.FLIP_REPORT === "true" }) }); const a = await adjudicate.json() as any; if (!adjudicate.ok) throw new Error(JSON.stringify(a)); save({ step: "cre_report", detail: a.attestation }); if (a.rejectedSettle) save({ step: "flipped_report_rejected", error: a.rejectedSettle }); if (a.txHash) await record("coverage_settle", a.txHash); }
  const ingest = await fetch(`${router}/ingest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sellerId: quote.selectedSellers[0], success: results.some((r) => r.body?.claimTx), txHash: run.records.find((r) => r.step.endsWith("claim"))?.txHash ?? run.records.at(-1)?.txHash }) }); save({ step: "router_ingest", detail: { status: ingest.status, body: await ingest.text() } });
  const out = runFile(); writeFileSync(out, JSON.stringify(run, null, 2)); console.log(JSON.stringify({ run: out, selectedRoute: quote.selectedRoute }));
}
main().catch(async (error) => { save({ step: "fatal", error: error instanceof Error ? error.message : String(error) }); const out = runFile(); writeFileSync(out, JSON.stringify(run, null, 2)); console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
