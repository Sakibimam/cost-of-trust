import showcase from "@/data/showcase.json";
import escrowIndex from "@/data/escrow-index.json";
import backtest from "@/data/backtest.json";
import slider from "./slider.json";
import registry from "./registry-capabilities.json";
import run from "./run-timeline.json";
import proofs from "./proofs.json";

export type SliderRow = [atRiskAda: number, recommendation: string, route: string, single: number, redundant: number, staggered: number, underwritten: number, expectedCost: number];
type Pol = { attempted: number; done: number; failures: number; adaLost: number; backupObserved: number; backupModelled: number };
type Delivery = { name: string; paid: number; refunded: number; disputed: number; medianSeconds: number };

export type DeckData = {
  knight: Delivery;
  agent: Delivery & { p90Seconds: number; deadlineMinutes: number };
  registry: { liveAgents: number; taggedAgents: number; tags: number; oneOrTwo: number; one: number; dist: Array<[number, number]>; block: number; readAt: string };
  slider: { open: SliderRow[]; tight: SliderRow[]; deadlineMinutes: number; riskAversion: number };
  backtest: { escrows: number; agents: number; from: string; to: string; splitAt: string; scored: number; losses: string[]; byLoss: Record<string, { base: Pol; cot: Pol }>; brier: { cot: number; dispute: number; n: number }; driver: { name: string; adaSaved: number; decisions: number } };
  run: { quoteAt: string; startedAt: string; buyerDeadline: string; resultAt: string; checkpointAt: string; timeline: Record<string, string>; txs: Array<{ id: string; role: string; state: string; at: string }> };
  proofs: { explorer: string; txs: Record<string, { label: string; txHash: string }>; races: { delivers: { checkpointAt: string; savedFeeAda: number }; stall: { checkpointAt: string } } };
};

const delivery = (a: (typeof showcase.agents)[number]): Delivery => ({ name: a.agentName, paid: a.delivery.paid, refunded: a.delivery.refunded, disputed: a.delivery.disputed, medianSeconds: a.delivery.responseSecondsMedian });

export function buildDeckData(): DeckData {
  const knight = showcase.agents.find((a) => a.agentName === "Knight");
  if (!knight) throw new Error("deck: Knight missing from showcase.json");
  const rec = (escrowIndex.agents as Record<string, { paid: number; refunded: number; disputed: number }>)[slider.agent.identifier];
  if (!rec || rec.paid !== slider.agent.paid || rec.refunded !== slider.agent.refunded) throw new Error("deck: slider.json is stale against escrow-index.json, rerun gen-slider.mjs");
  const held = backtest.heldOut as unknown as Record<string, Record<string, { jobsAttempted: number; jobsDone: number; realizedFailures: number; totalCostAda: number; observedBackupLegs: number; modelledBackupLegs: number }>>;
  const pol = (p: string, l: string): Pol => ({ attempted: held[p][l].jobsAttempted, done: held[p][l].jobsDone, failures: held[p][l].realizedFailures, adaLost: held[p][l].totalCostAda, backupObserved: held[p][l].observedBackupLegs, backupModelled: held[p][l].modelledBackupLegs });
  const losses = Object.keys(held.P0);
  const driver = (backtest.drivers as Array<{ name: string; adaSaved: number; decisions: number }>)[0];

  const txRole = Object.fromEntries(Object.entries(proofs.txs).map(([id, t]) => [t.txHash, id]));
  return {
    knight: delivery(knight),
    agent: { name: slider.agent.name, paid: slider.agent.paid, refunded: slider.agent.refunded, disputed: slider.agent.disputed, medianSeconds: slider.agent.medianSeconds, p90Seconds: slider.agent.p90Seconds, deadlineMinutes: slider.deadlineMinutes },
    registry: { liveAgents: registry.liveAgents, taggedAgents: registry.taggedAgents, tags: registry.tags, oneOrTwo: registry.tagsWithOneOrTwoAgents, one: registry.tagsWithOneAgent, dist: Object.entries(registry.agentsPerTagDistribution).map(([k, v]) => [Number(k), v as number]), block: registry.readAtBlock, readAt: registry.readAtBlockTime },
    slider: { open: slider.points.open as SliderRow[], tight: slider.points.tight as SliderRow[], deadlineMinutes: slider.deadlineMinutes, riskAversion: slider.riskAversion },
    backtest: { escrows: backtest.escrows, agents: backtest.agents, from: backtest.timeWindow.from, to: backtest.timeWindow.to, splitAt: backtest.splitAt, scored: held.P0["100"].jobsAttempted, losses, byLoss: Object.fromEntries(losses.map((l) => [l, { base: pol("P0", l), cot: pol("P3-new", l) }])), brier: { cot: backtest.calibration.betaBinomialBrier, dispute: backtest.calibration.disputeRateBrier, n: backtest.calibration.observations }, driver },
    run: { quoteAt: run.quote.at, startedAt: run.startedAt, buyerDeadline: run.buyerDeadline, resultAt: run.result.resultArrivedAt, checkpointAt: run.checkpoint.checkpointAt, timeline: run.timeline as unknown as Record<string, string>, txs: run.txs.map((t) => ({ id: txRole[t.txHash], role: t.role, state: t.state, at: t.at })) },
    proofs: { explorer: proofs.explorer, txs: Object.fromEntries(Object.entries(proofs.txs).map(([id, t]) => [id, { label: t.label, txHash: t.txHash }])), races: proofs.races },
  };
}
