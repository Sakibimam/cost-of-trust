// Extracts the fields the deck renders from agents/runs/2026-10-07T07-36-20Z-masumi-backup-stall-final.json.
// Usage: node web/src/app/deck/gen-run.mjs   -> writes run-timeline.json
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "agents/runs/2026-10-07T07-36-20Z-masumi-backup-stall-final.json";
const r = JSON.parse(readFileSync(new URL(`../../../../${FILE}`, import.meta.url), "utf8"));
const rec = r.rawRun.records;
const by = (step) => rec.find((x) => x.step === step);
const quote = rec[0];
const checkpoint = rec.find((x) => "hireBackup" in x);
const result = rec.find((x) => "buyerDeadlineMet" in x);
const out = {
  source: FILE,
  startedAt: r.startedAt,
  finishedAt: r.rawRun.finishedAt,
  buyerDeadline: r.buyerDeadline,
  primaryAgent: r.primaryAgent,
  backupAgent: r.backupAgent,
  quote: {
    at: quote.at,
    selectedRoute: quote.selectedRoute,
    selectedSellers: quote.selectedSellers,
    options: Object.fromEntries(Object.entries(quote.recommendation.options).map(([k, v]) => [k, { sellers: v.sellers, expectedTotalCostAda: v.expectedTotalCostAda, riskAdjustedCostAda: v.riskAdjustedCostAda }])),
  },
  timeline: r.timeline,
  checkpoint: { at: checkpoint.at, checkpointAt: checkpoint.checkpointAt, primaryResultArrivedAt: checkpoint.primaryResultArrivedAt ?? null, hireBackup: checkpoint.hireBackup },
  result: { at: result.at, resultArrivedAt: result.resultArrivedAt, buyerDeadline: result.buyerDeadline, buyerDeadlineMet: result.buyerDeadlineMet },
  txs: r.txs.map((t) => ({ txHash: t.txHash, role: t.role, state: t.onChainState, at: t.at })),
  stepNames: rec.map((x) => `${x.at} ${x.step}`),
};
writeFileSync(new URL("./run-timeline.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ quote: out.quote.selectedRoute, sellers: out.quote.selectedSellers, checkpoint: out.checkpoint, result: out.result, steps: out.stepNames }));
