// Sub-hiring agent, Coworker style. Before it sub-hires a Masumi agent it buys a Trust Check over x402
// (production endpoint, Cardano preprod, ADA from the buyer wallet), reads the report and acts on it.
// The hire leg itself is the MIP-003 start_job REQUEST the agent would send: the candidates are mainnet
// agents and cannot be paid from a preprod wallet, so nothing is sent to /start_job.
import { ExactCardanoScheme, toClientCardanoSigner } from "@x402/cardano";
import { x402Client } from "@x402/core/client";
import { decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { readFileSync, writeFileSync } from "node:fs";
import { request } from "../coworker/src/koios.ts";
import showcase from "../web/src/data/showcase.json";

const TRUST_CHECK = "https://cost-of-trust.vercel.app/api/x402/trust-check";
const KOIOS_PREPROD = "https://preprod.koios.rest/api/v1";
const WALLETS = "/Users/user/Desktop/canton/recourse/.wallets.json";
const MAINNET_POLICIES = ["ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9", "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b"];

const job = {
  title: "market research brief",
  query: "Brief on the European market for AI agent marketplaces: main players, pricing, and the last 90 days of news.",
  taskValueAtRiskAda: 100,
  deadlineMinutes: 15,
  capabilityTags: ["research", "news", "analysis", "strategy", "ai"],
};

type Candidate = { name: string; identifier: string; tags: string[]; apiBase: string };
type Fact = { source: string; status: string; data?: Record<string, unknown> };
type Report = { recommendation: string; expectedCostAda: number | null; selectedRoute?: string; summary?: string; facts?: Fact[] };
type Payment = { orphanedTxs: string[]; candidate: string; identifier: string; httpStatuses: number[]; txHash: string | null; confirmations: number; decision: string | null; expectedCostAda: number | null; selectedRoute: string | null; paid: number | null; refunded: number | null; summary: string | null; error: string | null };

const koiosHeaders = (): Record<string, string> => ({ "content-type": "application/json", ...(process.env.KAIOS_KEY ? { authorization: `Bearer ${process.env.KAIOS_KEY}` } : {}) });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const asText = (value: unknown): string => (Array.isArray(value) ? value.join("") : String(value ?? ""));

async function discover(): Promise<{ scanned: number; matched: number; candidates: Candidate[] }> {
  const shortlist = new Set((showcase.agents as Array<{ identifier: string }>).map((agent) => agent.identifier));
  const wanted = new Set(job.capabilityTags);
  let scanned = 0;
  const matched: Candidate[] = [];
  for (const policy of MAINNET_POLICIES) {
    const listed: Array<{ asset_name: string }> = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await request(`/policy_asset_list?_asset_policy=${policy}&limit=1000&offset=${offset}`, {}, "Mainnet") as Array<{ asset_name: string }>;
      listed.push(...page);
      if (page.length < 1000) break;
    }
    for (let i = 0; i < listed.length; i += 8) {
      const info = await request("/asset_info", { method: "POST", body: JSON.stringify({ _asset_list: listed.slice(i, i + 8).map((asset) => [policy, asset.asset_name]) }) }, "Mainnet") as Array<{ asset_name: string; minting_tx_metadata?: Record<string, any> }>;
      for (const row of info) {
        scanned += 1;
        const meta = row.minting_tx_metadata?.["721"]?.[policy]?.[row.asset_name];
        if (!meta) continue;
        const tags: string[] = (meta.tags ?? []).map((tag: string) => String(tag).toLowerCase());
        if (!tags.some((tag) => wanted.has(tag))) continue;
        matched.push({ name: asText(meta.name), identifier: policy + row.asset_name, tags, apiBase: asText(meta.api_base_url).replace(/\/$/, "") });
      }
    }
  }
  const candidates = matched.filter((entry) => shortlist.has(entry.identifier));
  for (const name of ["dpa Research Agent", "Knight"]) if (!candidates.some((entry) => entry.name === name)) throw new Error(`${name} not found in the live mainnet registry`);
  return { scanned, matched: matched.length, candidates };
}

async function confirmations(txHash: string): Promise<number> {
  const deadline = Date.now() + 300_000;
  for (;;) {
    const response = await fetch(`${KOIOS_PREPROD}/tx_status`, { method: "POST", headers: koiosHeaders(), body: JSON.stringify({ _tx_hashes: [txHash] }) });
    if (!response.ok) throw new Error(`Koios tx_status HTTP ${response.status}`);
    const confirmed = Number(((await response.json()) as Array<{ num_confirmations?: number | null }>)[0]?.num_confirmations ?? 0);
    if (confirmed >= 1) return confirmed;
    if (Date.now() > deadline) throw new Error(`no confirmation for ${txHash} within 300 s`);
    await sleep(5_000);
  }
}

async function payTrustCheck(client: x402Client, candidate: Candidate): Promise<Payment> {
  const payment: Payment = { orphanedTxs: [], candidate: candidate.name, identifier: candidate.identifier, httpStatuses: [], txHash: null, confirmations: 0, decision: null, expectedCostAda: null, selectedRoute: null, paid: null, refunded: null, summary: null, error: null };
  const body = JSON.stringify({ agentIdentifier: candidate.identifier, taskValueAtRiskAda: job.taskValueAtRiskAda, deadlineMinutes: job.deadlineMinutes });
  const post = (headers: Record<string, string> = {}) => fetch(TRUST_CHECK, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  try {
    let paid!: Response;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const quote = await post();
      payment.httpStatuses.push(quote.status);
      if (quote.status !== 402) throw new Error(`expected 402, got ${quote.status}`);
      const payload = await client.createPaymentPayload(await quote.json() as PaymentRequired);
      paid = await post({ "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload) });
      payment.httpStatuses.push(paid.status);
      if (paid.status !== 202) break;
      // 202: the endpoint took the payment and is still settling. Its poll URL checks the tx on chain and delivers the
      // report for this request, so the paid tx is redeemed instead of paying again.
      const pending = (await paid.json()) as { txId?: string; poll?: string };
      if (!pending.poll) throw new Error("202 without a poll URL");
      const pollDeadline = Date.now() + 180_000;
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        paid = await fetch(pending.poll);
        payment.httpStatuses.push(paid.status);
        if (paid.status !== 202) break;
        if (Date.now() > pollDeadline) { payment.orphanedTxs.push(pending.txId ?? "unknown"); throw new Error(`poll still 202 after 180 s for ${pending.txId}`); }
      }
      break;
    }
    const header = paid.headers.get("payment-response");
    if (header) payment.txHash = (decodePaymentResponseHeader(header) as { transaction?: string }).transaction ?? null;
    if (paid.status !== 200) throw new Error(`paid request ended ${paid.status}: ${(await paid.text()).slice(0, 200)}`);
    if (!payment.txHash) throw new Error("200 without a PAYMENT-RESPONSE transaction");
    const report = await paid.json() as Report;
    const delivery = report.facts?.find((fact) => fact.source === "masumi_delivery_history")?.data ?? {};
    Object.assign(payment, { decision: report.recommendation, expectedCostAda: report.expectedCostAda, selectedRoute: report.selectedRoute ?? null, paid: Number(delivery.paid ?? 0), refunded: Number(delivery.refunded ?? 0), summary: report.summary ?? null });
    payment.confirmations = await confirmations(payment.txHash);
  } catch (error) {
    payment.error = error instanceof Error ? error.message : String(error);
  }
  return payment;
}

const HIRE = new Set(["hire_as_is", "hire_with_backup_keeper"]);
const WORDS: Record<string, string> = { hire_as_is: "hire", hire_with_backup_keeper: "hire with backup", require_coverage: "hire only with coverage", do_not_hire: "do not hire", insufficient_data: "not enough history" };

function line(payment: Payment): string {
  if (payment.error || !payment.decision) return `${payment.candidate}: Trust Check failed (${payment.error}).`;
  const history = `${payment.paid} paid, ${payment.refunded} refunded`;
  return HIRE.has(payment.decision) ? `${payment.candidate}: ${WORDS[payment.decision]}, expected ${payment.expectedCostAda?.toFixed(2)} ADA (${history}).` : `${payment.candidate}: ${WORDS[payment.decision] ?? payment.decision} (${history}).`;
}

async function hireRequest(candidate: Candidate) {
  const schema = await fetch(`${candidate.apiBase}/input_schema`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.json()) as { input_data: Array<{ id: string }> };
  const input_data = schema.input_data.filter((field) => field.id === "query").map((field) => ({ key: field.id, value: job.query }));
  if (!input_data.length) throw new Error(`${candidate.name} input_schema has no query field`);
  const started = Date.now();
  const response = await fetch(`${candidate.apiBase}/availability`, { signal: AbortSignal.timeout(15_000) });
  const availability = await response.json() as { status?: string; message?: string };
  return {
    sent: false,
    note: "The hire leg is the request only. Mainnet agents cannot be paid from the preprod buyer wallet, so no start_job call or payment was made.",
    request: { method: "POST", url: `${candidate.apiBase}/start_job`, body: { identifier_from_purchaser: "subhire-coworker-01", input_data } },
    availability: { url: `${candidate.apiBase}/availability`, httpStatus: response.status, status: availability.status ?? null, message: availability.message ?? null, ms: Date.now() - started },
  };
}

async function main() {
  const seed = (JSON.parse(readFileSync(WALLETS, "utf8")) as Record<string, { seed: string }>).buyer?.seed;
  if (!seed) throw new Error("buyer wallet missing from wallets file");
  const signer = toClientCardanoSigner({ mnemonic: seed, network: "cardano:preprod", provider: { koios: { baseUrl: KOIOS_PREPROD, token: process.env.KAIOS_KEY } } });
  const client = new x402Client().setSpendControls(false).register("cardano:preprod", new ExactCardanoScheme(signer));

  console.log(`Job: ${job.title}, ${job.taskValueAtRiskAda} ADA at risk, buyer deadline ${job.deadlineMinutes} minutes.`);
  const registry = await discover();
  console.log(`Registry: scanned ${registry.scanned} mainnet entries, ${registry.matched} match the job tags, shortlisted ${registry.candidates.map((c) => c.name).join(", ")}.`);

  const payments: Payment[] = [];
  for (const candidate of registry.candidates) {
    const payment = await payTrustCheck(client, candidate);
    payments.push(payment);
    console.log(line(payment) + (payment.txHash ? ` Trust Check tx ${payment.txHash}` : ""));
  }

  const failed = payments.filter((payment) => payment.error);
  const hireable = payments.filter((payment) => !payment.error && payment.decision && HIRE.has(payment.decision) && payment.expectedCostAda !== null).sort((a, b) => a.expectedCostAda! - b.expectedCostAda!);
  const refused = payments.filter((payment) => payment.decision === "do_not_hire").map((payment) => payment.candidate);
  const choice = hireable[0] ?? null;
  let hire = null;
  if (choice) {
    const entry = registry.candidates.find((candidate) => candidate.identifier === choice.identifier)!;
    hire = { agent: choice.candidate, identifier: choice.identifier, ...(await hireRequest(entry)) };
    console.log(`Sub-hiring ${choice.candidate}: start_job request prepared for ${hire.request.url}, /availability ${hire.availability.status} (HTTP ${hire.availability.httpStatus}). Request only, no payment.`);
  } else console.log("No candidate cleared the Trust Check. Nothing hired.");

  const startedAt = new Date().toISOString();
  const run = {
    kind: "subhire",
    startedAt,
    job,
    trustCheckEndpoint: TRUST_CHECK,
    paymentNetwork: "cardano:preprod",
    registry: { network: "Mainnet", policies: MAINNET_POLICIES, scanned: registry.scanned, matchedTags: registry.matched, candidates: registry.candidates },
    payments,
    refused,
    choice: choice ? { agent: choice.candidate, decision: choice.decision, expectedCostAda: choice.expectedCostAda } : null,
    hire,
    verification: { koios: `${KOIOS_PREPROD}/tx_status`, allConfirmed: payments.length > 0 && payments.every((payment) => payment.txHash && payment.confirmations >= 1) },
  };
  const file = new URL(`../agents/runs/${startedAt.replace(/[:.]/g, "-")}-subhire.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(run, null, 2) + "\n");
  console.log(`Run recorded: ${file.pathname}`);
  if (failed.length || !run.verification.allConfirmed) process.exitCode = 1;
}

await main();
