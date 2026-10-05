import { readFileSync } from "node:fs";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { toClientCardanoSigner } from "@x402/cardano";
import { ExactCardanoScheme as ExactClient } from "@x402/cardano/exact/client";
import { assertCoverage, claim, forfeit, lockClaimVault, waitForTx, type OutRef } from "@cost-of-trust/offchain";
import { config, context, parseRef, refString } from "./common";
const walletPath = process.env.COT_WALLETS ?? "/Users/user/Desktop/canton/recourse/.wallets.json";
const wallets = JSON.parse(readFileSync(walletPath, "utf8")) as Record<string, { seed: string }>;
const router = process.env.ROUTER_URL ?? "http://127.0.0.1:8787";
const relayer = process.env.RELAYER_URL ?? "http://127.0.0.1:4111";
const underwriter = process.env.UNDERWRITER_URL ?? "http://127.0.0.1:4110";
type RecordItem = { step: string; txHash?: string; confirmed?: boolean; error?: string; detail?: unknown };
const run: { startedAt: string; selectedRoute?: unknown; records: RecordItem[] } = { startedAt: new Date().toISOString(), records: [] };
const record = async (step: string, txHash: string) => { await waitForTx(txHash); run.records.push({ step, txHash, confirmed: true }); };
const pay = async (url: string, body: Record<string, unknown>, seed: string): Promise<{ response: Response; body: any }> => { const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); if (first.status !== 402) return { response: first, body: await first.json() }; const required = new x402HTTPClient(new x402Client().register("cardano:*", new ExactClient(toClientCardanoSigner({ mnemonic: seed, network: "cardano:preprod", provider: { koios: { baseUrl: "https://preprod.koios.rest/api/v1", token: process.env.KAIOS_KEY } } })))); const paymentRequired = required.getPaymentRequiredResponse((name) => first.headers.get(name)); const challenge = await first.json() as { job_id?: string }; const payload = await required.createPaymentPayload(paymentRequired); const paid = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...required.encodePaymentSignatureHeader(payload) }, body: JSON.stringify({ ...body, ...(challenge.job_id ? { job_id: challenge.job_id } : {}) }) }); return { response: paid, body: await paid.json() }; };
async function main() {
  const buyer = await context("buyer");
  const sponsor = await context("admin2");
  const lossAda = Number(process.env.DEMO_LOSS_ADA ?? 10);
  const expiry = BigInt(Math.floor((Date.now() + Number(process.env.DEMO_EXPIRY_MINUTES ?? 10) * 60_000) / 1000) * 1000);
  const locked = await lockClaimVault(sponsor.lucid, sponsor.deployment, { beneficiary: buyer.address, expiry, value: BigInt(Math.round(lossAda * 1_000_000)) });
  await record("claim_vault_lock", locked.txHash);
  const riskAversion = Number(process.env.BUYER_RISK_AVERSION ?? 0.25);
  const sharedInfrastructure = (process.env.SHARED_INFRA ?? "true") !== "false";
  const sellerRes = await fetch(`${router}/sellers`); if (!sellerRes.ok) throw new Error(`seller discovery failed ${sellerRes.status}`); const discovered = await sellerRes.json() as Array<{ id: string; endpoint: string }>;
  const requestedCandidates = (process.env.CANDIDATE_SELLERS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const candidates = requestedCandidates.length ? discovered.filter((seller) => requestedCandidates.includes(seller.id)).map((seller) => seller.id) : discovered.map((seller) => seller.id);
  if (!candidates.length) throw new Error("CANDIDATE_SELLERS did not match router sellers");
  const localPort = (seller: string) => seller === "seller-a" ? 4101 : seller === "seller-b" ? 4102 : 4103;
  const keeperUrl = (seller: string) => { const configured = process.env[`${seller.replace("-", "_").toUpperCase()}_URL`]; const endpoint = discovered.find((item) => item.id === seller)?.endpoint; return configured ?? (endpoint && !endpoint.includes(".example/") ? endpoint.replace(/\/$/, "") : `http://127.0.0.1:${localPort(seller)}`); };
  const routeRes = await fetch(`${router}/best-route`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: "claim before expiry", serviceType: "cardano_deadline_execution", deadline: new Date(Number(expiry)).toISOString(), downstreamLossAda: lossAda, candidateSellers: candidates, riskAversion, sharedInfrastructure, constraints: { allowRedundancy: true, ...(process.env.REQUIRE_COVERAGE === "true" ? { requireCoverage: true } : {}) } }) });
  if (!routeRes.ok) throw new Error(`router quote failed ${routeRes.status}: ${await routeRes.text()}`);
  const quote = await routeRes.json() as any; run.selectedRoute = quote;
  const underwritten = quote.selectedRoute === "underwritten";
  const executionRoute = quote.selectedRoute === "staggered" ? "redundant" : quote.selectedRoute;
  if (executionRoute !== quote.selectedRoute) run.records.push({ step: "route_execution_fallback", detail: { selectedRoute: quote.selectedRoute, executionRoute } });
  let coverageRef: OutRef | undefined;
  const selectedQuote = quote.routes.find((r: any) => r.route === quote.selectedRoute && r.sellers.join(",") === quote.selectedSellers.join(","));
  if (!selectedQuote) throw new Error("router returned no selected route details");
  if (underwritten) { const bind = await fetch(`${underwriter}/bind`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ buyer: buyer.address, payoutAda: lossAda, coverageAda: selectedQuote.coverageAda, taskRef: refString(locked.ref), taskExpiry: String(expiry), decideBy: String(expiry + 1_800_000n), terms: { route: quote.selectedRoute, sellers: quote.selectedSellers, servicePriceAda: selectedQuote.servicePriceAda, premiumAda: selectedQuote.premiumAda, coverageAda: selectedQuote.coverageAda } }) }); const b = await bind.json() as any; if (!bind.ok) throw new Error(JSON.stringify(b)); coverageRef = parseRef(b.coverageRef); await assertCoverage(buyer.lucid, buyer.deployment, coverageRef, { buyer: buyer.address, taskRef: locked.ref, taskExpiry: expiry, config: config() }); await record("coverage_lock", b.txHash); }
  const selected = quote.selectedSellers.map((seller: string) => ({ seller, url: `${keeperUrl(seller)}/start_job` }));
  const results = await Promise.all(selected.map(async ({ seller, url }: { seller: string; url: string }) => { try { const paid = await pay(url, { taskId: quote.quoteId, claimVault: refString(locked.ref), beneficiary: buyer.address, expiry: String(expiry), priceLovelace: 1_000_000, termsHash: quote.termsHash, identifier_from_purchaser: crypto.randomUUID() }, wallets.buyer.seed); if (!paid.response.ok) throw new Error(`${seller} returned ${paid.response.status}: ${JSON.stringify(paid.body)}`); const body = paid.body; if (body.paymentTx) await record(`${seller}_payment`, body.paymentTx); if (body.claimTx) await record(`${seller}_claim`, body.claimTx); return { seller, body }; } catch (error) { const message = error instanceof Error ? error.message : String(error); run.records.push({ step: `${seller}_claim_rejected`, error: message }); return { seller, error: message }; } }));
  run.records.push({ step: "keeper_results", detail: results });
  if (!results.some((r) => r.body?.claimTx)) { const ms = Number(expiry) - Date.now() + 5_000; if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms)); const forfeited = await forfeit(sponsor.lucid, sponsor.deployment, locked.ref, sponsor.address, expiry); await record("claim_vault_forfeit", forfeited); }
  if (coverageRef) { const adjudicate = await fetch(`${relayer}/adjudicate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coverageRef: refString(coverageRef), buyerAddress: buyer.address, underwriterAddress: (await context("admin1")).address, flipReport: process.env.FLIP_REPORT === "true" }) }); const a = await adjudicate.json() as any; if (!adjudicate.ok) throw new Error(JSON.stringify(a)); if (a.rejectedSettle) run.records.push({ step: "flipped_report_rejected", error: a.rejectedSettle }); if (a.txHash) await record("coverage_settle", a.txHash); }
  const ingest = await fetch(`${router}/ingest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sellerId: quote.selectedSellers[0], success: results.some((r) => r.body?.claimTx), txHash: run.records.find((r) => r.step.endsWith("claim"))?.txHash ?? run.records.at(-1)?.txHash }) }); run.records.push({ step: "router_ingest", detail: { status: ingest.status, body: await ingest.text() } });
  const out = `${import.meta.dirname}/runs/${run.startedAt.replace(/[:.]/g, "-")}.json`; await Bun.write(out, JSON.stringify(run, null, 2)); console.log(JSON.stringify({ run: out, selectedRoute: quote.selectedRoute }));
}
main().catch(async (error) => { run.records.push({ step: "fatal", error: error instanceof Error ? error.message : String(error) }); const out = `${import.meta.dirname}/runs/${run.startedAt.replace(/[:.]/g, "-")}.json`; await Bun.write(out, JSON.stringify(run, null, 2)); console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
