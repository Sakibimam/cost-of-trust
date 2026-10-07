import { parseTaskInput } from "../../../../coworker/src/task-input";
import { TRUST_CHECK_PAY_TO } from "./payto";

export const requirements = {
  scheme: "exact",
  network: "cardano:preprod",
  amount: "1000000",
  asset: "lovelace",
  payTo: TRUST_CHECK_PAY_TO,
  maxTimeoutSeconds: 600,
  extra: { confirmationPolicy: { l1Confirmations: 0 } },
};

export type RequestBody = { agentIdentifier?: unknown; agentName?: unknown; taskValueAtRiskAda?: unknown; deadlineMinutes?: unknown; task?: unknown };

export function inputFrom(body: RequestBody | null) {
  const agentIdentifier = typeof body?.agentIdentifier === "string" ? body.agentIdentifier.trim() : typeof body?.agentName === "string" ? body.agentName.trim() : "";
  const value = body?.taskValueAtRiskAda;
  if (!agentIdentifier || typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("agentIdentifier (or agentName) and non-negative taskValueAtRiskAda are required");
  if (body?.deadlineMinutes !== undefined && (typeof body.deadlineMinutes !== "number" || !Number.isFinite(body.deadlineMinutes) || body.deadlineMinutes <= 0)) throw new Error("deadlineMinutes must be positive");
  if (body?.task !== undefined && typeof body.task !== "string") throw new Error("task must be a string");
  const parsed = parseTaskInput(JSON.stringify({ agentIdentifier, taskValueAtRiskAda: value, deadlineMinutes: body?.deadlineMinutes, task: body?.task }));
  if (!parsed) throw new Error("invalid Trust Check input");
  return parsed;
}

// The request a payment was made for, in one fixed key order so the same request always encodes to the same string.
export function canonicalRequest(input: ReturnType<typeof inputFrom>): string {
  return JSON.stringify({ agentIdentifier: input.agentIdentifier, taskValueAtRiskAda: input.taskValueAtRiskAda, ...(input.deadlineMinutes === undefined ? {} : { deadlineMinutes: input.deadlineMinutes }), ...(input.task === undefined ? {} : { task: input.task }) });
}

export const encodeRequest = (input: ReturnType<typeof inputFrom>) => Buffer.from(canonicalRequest(input), "utf8").toString("base64url");

export function decodeRequest(encoded: string): ReturnType<typeof inputFrom> {
  let body: RequestBody;
  try { body = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as RequestBody; } catch { throw new Error("req is not base64url JSON"); }
  return inputFrom(body);
}
