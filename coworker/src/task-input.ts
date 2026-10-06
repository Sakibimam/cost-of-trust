import type { CheckInput } from "./types.ts";

export const USAGE_RESULT = "Trust Check needs an agent identifier. Paste a Masumi registry asset or fingerprint, such as asset1h6lypyuwtgjqjf9wd4wmg53pgk7gtv08nk40pn, and optionally include the ADA value at risk.";

const assetToken = /\basset1[a-z0-9]+\b/i;
const hexAsset = /\b(?:[0-9a-f]{112,120}|[0-9a-f]{56}(?:[.:][0-9a-f]{1,64})?)\b/i;
const valueToken = /(?:value|risk|at\s+risk|worth)[^\d]{0,24}(\d+(?:\.\d+)?)/i;

export function parseTaskInput(input: string): CheckInput | null {
  try {
    const parsed = JSON.parse(input) as Partial<CheckInput>;
    if (parsed && typeof parsed === "object" && typeof parsed.agentIdentifier === "string" && parsed.agentIdentifier.trim()) {
      return { ...parsed, agentIdentifier: parsed.agentIdentifier.trim(), taskValueAtRiskAda: Number.isFinite(parsed.taskValueAtRiskAda) ? Number(parsed.taskValueAtRiskAda) : 100 } as CheckInput;
    }
  } catch (error) { void error; }

  const agentIdentifier = input.match(assetToken)?.[0] ?? input.match(hexAsset)?.[0]?.replace(".", "") ?? null;
  if (!agentIdentifier) return null;
  const value = input.match(valueToken)?.[1];
  return { agentIdentifier, taskValueAtRiskAda: value ? Number(value) : 100 };
}
