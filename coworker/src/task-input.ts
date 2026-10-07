import type { CheckInput } from "./types.ts";

export const USAGE_RESULT = `Trust Check accepts plain language. Try either:

Should I hire dpa Research Agent for a 100 ADA job due in 15 minutes?
Should I hire Knight for a 500 ADA job within 2 hours?

You can also provide JSON with an agent identifier, taskValueAtRiskAda, and optional deadlineMinutes.`;

const assetToken = /\basset1[a-z0-9]+\b/i;
const hexAsset = /\b(?:[0-9a-f]{112,120}|[0-9a-f]{56}(?:[.:][0-9a-f]{1,64})?)\b/i;
const valueToken = /(?:value|risk|at\s+risk|worth|for\s+a)[^\d]{0,24}(\d+(?:\.\d+)?)/i;
const deadlineToken = /(?:due\s+in|within)\s+(\d+(?:\.\d+)?)\s*(minute|minutes|min|hour|hours|hr|hrs|second|seconds|sec|secs)\b/i;

function deadlineMinutes(input: string): number | undefined {
  const match = input.match(deadlineToken);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  return unit.startsWith("hour") || unit.startsWith("hr") ? value * 60 : unit.startsWith("second") || unit.startsWith("sec") ? value / 60 : value;
}

export function parseTaskInput(input: string): CheckInput | null {
  try {
    const parsed = JSON.parse(input) as Partial<CheckInput>;
    if (parsed && typeof parsed === "object" && typeof parsed.agentIdentifier === "string" && parsed.agentIdentifier.trim()) {
      return { ...parsed, agentIdentifier: parsed.agentIdentifier.trim(), taskValueAtRiskAda: Number.isFinite(parsed.taskValueAtRiskAda) ? Number(parsed.taskValueAtRiskAda) : 100, ...(Number.isFinite(parsed.deadlineMinutes) ? { deadlineMinutes: Number(parsed.deadlineMinutes) } : {}) } as CheckInput;
    }
  } catch (error) { void error; }

  const agentIdentifier = input.match(assetToken)?.[0] ?? input.match(hexAsset)?.[0]?.replace(".", "") ?? input.match(/(?:hire|choose|use)\s+([A-Za-z][A-Za-z0-9 &'_-]{1,80}?)(?=\s+for\s+|\s+at\s+|\s+due\s+|\s+within\s+|\?|$)/i)?.[1]?.trim() ?? null;
  if (!agentIdentifier) return null;
  const value = input.match(valueToken)?.[1];
  return { agentIdentifier, taskValueAtRiskAda: value ? Number(value) : 100, ...(deadlineMinutes(input) === undefined ? {} : { deadlineMinutes: deadlineMinutes(input) }) };
}
