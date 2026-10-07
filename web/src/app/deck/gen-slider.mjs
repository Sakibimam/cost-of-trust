// Regenerates slider.json for Company Researcher (Bansumi), sweeping ADA at risk from 5 to 500 for two buyers:
// one with no deadline and one who needs the result within DEADLINE_MINUTES.
// Every verdict, route and price is the product's own decide() in coworker/src/report.ts, fed the same facts
// web/src/app/api/check/preview.ts builds: web/src/data/escrow-index.json for the agent's paid and refunded
// escrows, coworker/src/registry-names.json for its identity, and the agent's live /availability read at generation time.
// The self-check then asks preview() itself, the code behind GET /api/check, for the same agent at 5, 100 and 500 ADA
// for both buyers and exits 1 on any difference.
// Usage: bun web/src/app/deck/gen-slider.mjs
import { writeFileSync } from "node:fs";
import { advertisedUrl, decide, getJson } from "../../../../coworker/src/report.ts";
import { registryFromChain } from "../../../../coworker/src/koios.ts";
import escrowIndex from "../../data/escrow-index.json" with { type: "json" };
import { entriesByName, indexed, jobs } from "../api/check/names.ts";
import { preview } from "../api/check/preview.ts";

const AGENT_NAME = "Company Researcher (Bansumi)";
const EXPECT = { paid: 199, refunded: 42 };
const DEADLINE_MINUTES = 1;
const MIN = 5;
const MAX = 500;
const CHECK_AT = [5, 100, 500];
const KINDS = ["single", "redundant", "staggered", "underwritten"];
const round = (n) => Math.round(n * 1e4) / 1e4;
const fail = (message) => { console.error(message); process.exit(1); };

const list = entriesByName[AGENT_NAME.toLowerCase()];
if (!list?.length) fail(`${AGENT_NAME} is not in coworker/src/registry-names.json`);
const entry = [...list].sort((a, b) => jobs(b.identifier) - jobs(a.identifier))[0];
const record = indexed(entry.identifier);
if (!record) fail(`${AGENT_NAME} has no escrow history in web/src/data/escrow-index.json`);
if (record.paid !== EXPECT.paid || record.refunded !== EXPECT.refunded) fail(`${AGENT_NAME} history is ${record.paid} paid, ${record.refunded} refunded; this deck copy expects ${EXPECT.paid} and ${EXPECT.refunded}. Update the deck copy or EXPECT.`);

const generatedAt = String(escrowIndex.generatedAt);
const facts = [
  { source: "registry_chain", status: "ok", observedAt: generatedAt, data: { name: entry.name } },
  { source: "masumi_delivery_history", status: "ok", observedAt: generatedAt, data: { paid: record.paid, refunded: record.refunded, disputed: record.disputed, responseSeconds: record.waits.map((w) => w.seconds), ceilingSeconds: record.ceilingSeconds ?? [] } },
];
const registry = await registryFromChain(entry.identifier, entry.network);
const endpoint = registry.status === "ok" ? advertisedUrl(registry.data) : null;
if (!endpoint) fail(`${AGENT_NAME}: the registry advertises no API URL, so its live status cannot be priced`);
const availability = await getJson("agent_availability", `${endpoint}/availability`, { signal: AbortSignal.timeout(8_000) });
if (availability.status !== "ok") fail(`${AGENT_NAME}: live /availability at ${endpoint} is ${availability.status}, refusing to publish a slider for a down agent`);
facts.push(availability);

function point(atRisk, deadlineMinutes) {
  const d = decide(facts, atRisk, { agentIdentifier: entry.identifier, deadlineMinutes });
  if (d.recommendation === "do_not_hire" || d.recommendation === "insufficient_data") fail(`decide() says ${d.recommendation} for ${AGENT_NAME} at ${atRisk} ADA; the slide is for an agent the policy hires`);
  return [atRisk, d.recommendation, d.selectedRoute, ...KINDS.map((k) => round(d.options[k].riskAdjustedCostAda)), round(d.expectedCostAda)];
}

const points = { open: [], tight: [] };
for (let v = MIN; v <= MAX; v++) { points.open.push(point(v, undefined)); points.tight.push(point(v, DEADLINE_MINUTES)); }

let checked = 0;
for (const [series, deadline] of [["open", null], ["tight", String(DEADLINE_MINUTES)]]) {
  for (const v of CHECK_AT) {
    const api = await preview({ agent: AGENT_NAME, valueAda: String(v), deadlineMinutes: deadline });
    if (api.status !== 200) fail(`preview() answered ${api.status} for ${series} ${v} ADA: ${JSON.stringify(api.body)}`);
    const row = points[series].find((p) => p[0] === v);
    const byRoute = Object.fromEntries(api.body.options.map((o) => [o.route, round(o.riskAdjustedCostAda)]));
    const want = [api.body.decision, api.body.selectedRoute, ...KINDS.map((k) => byRoute[k]), round(api.body.expectedCostAda)];
    const got = row.slice(1);
    if (JSON.stringify(want) !== JSON.stringify(got)) fail(`MISMATCH ${series} ${v} ADA: preview() ${JSON.stringify(want)} vs slider ${JSON.stringify(got)}`);
    checked++;
  }
}
if (checked !== CHECK_AT.length * 2) fail(`expected ${CHECK_AT.length * 2} preview() comparisons, ran ${checked}`);

const out = {
  source: "coworker/src/report.ts decide() over web/src/data/escrow-index.json, checked against web/src/app/api/check/preview.ts",
  indexGeneratedAt: generatedAt,
  agent: { name: entry.name, identifier: entry.identifier, paid: record.paid, refunded: record.refunded, disputed: record.disputed, medianSeconds: record.responseSecondsMedian, p90Seconds: record.responseSecondsP90, liveApi: { url: endpoint, status: availability.status, observedAt: availability.observedAt } },
  deadlineMinutes: DEADLINE_MINUTES,
  riskAversion: 0.25,
  columns: ["atRiskAda", "recommendation", "selectedRoute", "singleRA", "redundantRA", "staggeredRA", "underwrittenRA", "expectedCostAda"],
  points,
};
writeFileSync(new URL("./slider.json", import.meta.url), JSON.stringify(out));
const at = (series, v) => points[series].find((p) => p[0] === v);
console.log(`slider.json written for ${entry.name}: ${points.open.length} points per series, ${checked} preview() comparisons identical`);
for (const v of CHECK_AT) console.log(`  ${v} ADA  no deadline: ${at("open", v)[1]}  |  ${DEADLINE_MINUTES} min deadline: ${at("tight", v)[1]} (${at("tight", v)[2]})`);
