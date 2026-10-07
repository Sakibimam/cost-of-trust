import { decide } from "../../../../../coworker/src/report";
import escrowIndex from "../../../data/escrow-index.json";
import { byId, entriesByName, indexed, jobs, type Entry } from "./names";
import type { Evidence, TrustReport } from "../../../../../coworker/src/types";

// Edit distance, so a typo such as "Knigth" still finds "Knight".
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

function suggestions(query: string): string[] {
  const q = query.trim().toLowerCase();
  const words = q.split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
  const scored = Object.entries(entriesByName).map(([key, list]) => {
    const score = q && (key.includes(q) || q.includes(key)) ? 3 : words.some((word) => key.includes(word) || key.split(/[^a-z0-9]+/).some((part) => part.length >= 4 && distance(word, part) <= 2)) ? 2 : q.length >= 3 && key.startsWith(q.slice(0, 3)) ? 1 : 0;
    return { name: list[0].name, score, jobs: Math.max(...list.map((entry) => jobs(entry.identifier))) };
  });
  const matched = scored.filter((row) => row.score > 0);
  return (matched.length ? matched : scored).sort((a, b) => b.score - a.score || b.jobs - a.jobs).slice(0, 6).map((row) => row.name);
}

function resolve(query: string): { entry: Entry; otherMatches: number } | null {
  const q = query.trim();
  if (/^[0-9a-f]{56,}$/i.test(q)) {
    const id = q.toLowerCase();
    const entry = byId.get(id);
    return entry && indexed(entry.identifier) ? { entry, otherMatches: 0 } : null;
  }
  const list = entriesByName[q.toLowerCase()];
  if (!list?.length) return null;
  // Several registry entries can share a name; the one with the most resolved escrows is the one buyers actually used.
  const ranked = [...list].sort((a, b) => jobs(b.identifier) - jobs(a.identifier));
  return indexed(ranked[0].identifier) ? { entry: ranked[0], otherMatches: ranked.length - 1 } : null;
}

const ROUTES = {
  single: { label: "Hire it alone", plain: "One agent does the job. If it misses, Masumi refunds the fee, but the deadline is gone." },
  redundant: { label: "Hire two at once", plain: "Two agents do the same job and both are paid up front. Costs more, and one is likely to deliver." },
  staggered: { label: "Hire one, keep a backup", plain: "A backup agent is paid only if the first one misses. Cardano lets only one of them be paid." },
  underwritten: { label: "Hire alone, with cover", plain: "One agent does the job and an underwriter pays you if it misses. You pay a premium for that." },
} as const;

const HEADLINE: Record<TrustReport["recommendation"], (name: string) => string> = {
  hire_as_is: (name) => `Hire ${name}.`,
  hire_with_backup_keeper: (name) => `Hire ${name} with a backup.`,
  require_coverage: (name) => `Hire ${name} only with cover.`,
  do_not_hire: (name) => `Do not hire ${name}.`,
  insufficient_data: (name) => `There is not enough history to judge ${name}.`,
};

export type Preview = { status: number; body: Record<string, unknown> };

export function preview(params: { agent: string | null; valueAda: string | null; deadlineMinutes: string | null }): Preview {
  const agent = params.agent?.trim() ?? "";
  if (!agent) return { status: 400, body: { error: "agent is required: a registry name such as Knight, or a registry asset id", suggestions: suggestions("") } };
  const valueAda = params.valueAda === null || params.valueAda === "" ? 100 : Number(params.valueAda);
  if (!Number.isFinite(valueAda) || valueAda < 0) return { status: 400, body: { error: "valueAda must be a number of ADA, zero or more" } };
  const deadlineMinutes = params.deadlineMinutes === null || params.deadlineMinutes === "" ? undefined : Number(params.deadlineMinutes);
  if (deadlineMinutes !== undefined && (!Number.isFinite(deadlineMinutes) || deadlineMinutes <= 0)) return { status: 400, body: { error: "deadlineMinutes must be a number of minutes above zero" } };

  const found = resolve(agent);
  if (!found) return { status: 404, body: { error: `No Masumi agent named "${agent}" has escrow history here.`, suggestions: suggestions(agent) } };
  const { entry, otherMatches } = found;
  const record = indexed(entry.identifier);
  const waits = record.waits.map((wait) => wait.seconds);

  const facts: Evidence[] = [
    { source: "registry_chain", status: "ok", observedAt: String((escrowIndex as { generatedAt: string }).generatedAt), data: { name: entry.name } },
    { source: "masumi_delivery_history", status: "ok", observedAt: String((escrowIndex as { generatedAt: string }).generatedAt), data: { paid: record.paid, refunded: record.refunded, disputed: record.disputed, responseSeconds: waits, ceilingSeconds: record.ceilingSeconds ?? [] } },
  ];
  const decision = decide(facts, valueAda, { agentIdentifier: entry.identifier, deadlineMinutes });

  const options = (Object.keys(ROUTES) as Array<keyof typeof ROUTES>).flatMap((route) => {
    const quote = decision.options[route];
    return quote ? [{ route, ...ROUTES[route], sellers: quote.sellers.map((id) => (id === entry.identifier ? entry.name : "a backup seller")), expectedCostAda: quote.expectedTotalCostAda, riskAdjustedCostAda: quote.riskAdjustedCostAda, selected: decision.recommendation !== "do_not_hire" && route === decision.selectedRoute }] : [];
  });

  const settled = record.paid + record.refunded + record.disputed;
  const deadlineSeconds = deadlineMinutes === undefined ? null : deadlineMinutes * 60;
  const withinDeadline = deadlineSeconds === null ? null : { deadlineMinutes, jobsMeasured: waits.length, jobsWithin: waits.filter((seconds) => seconds <= deadlineSeconds).length };
  const cost = decision.expectedCostAda === null || decision.recommendation === "do_not_hire" ? "" : ` Expected cost ${decision.expectedCostAda.toFixed(2)} ADA.`;
  const headline = HEADLINE[decision.recommendation](entry.name);
  const sentence = `${headline}${cost} ${record.paid} of ${settled} past jobs delivered${record.responseSecondsMedian === null ? "" : `, median ${Math.round(record.responseSecondsMedian)} s`}.`;

  return {
    status: 200,
    body: {
      agent: { name: entry.name, identifier: entry.identifier, network: entry.network, otherMatches },
      input: { valueAda, deadlineMinutes: deadlineMinutes ?? null },
      history: { paid: record.paid, refunded: record.refunded, disputed: record.disputed, medianSeconds: record.responseSecondsMedian, p90Seconds: record.responseSecondsP90 },
      options,
      decision: decision.recommendation,
      selectedRoute: decision.selectedRoute ?? null,
      expectedCostAda: decision.expectedCostAda,
      withinDeadline,
      headline,
      sentence,
      note: "Free preview from the escrow index of Masumi mainnet jobs. The paid report also reads the agent's live API and registry price.",
      indexGeneratedAt: (escrowIndex as { generatedAt: string }).generatedAt,
    },
  };
}
