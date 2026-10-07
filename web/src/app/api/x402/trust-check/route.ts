import { NextResponse } from "next/server";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { createReport } from "../../../../../../coworker/src/report";
import { parseTaskInput } from "../../../../../../coworker/src/task-input";
import { TRUST_CHECK_PAY_TO } from "../../../../lib/x402/payto";
import { confirmedOnChain, PaymentAlreadyUsedError, recordDelivery, settleOnce, txIdFromPayment, withDeliveryLock, encodePaymentResponseHeader } from "../../../../lib/x402/settlement";

export const runtime = "nodejs";
export const maxDuration = 60;

const requirements = {
  scheme: "exact",
  network: "cardano:preprod",
  amount: "1000000",
  asset: "lovelace",
  payTo: TRUST_CHECK_PAY_TO,
  maxTimeoutSeconds: 600,
  extra: { confirmationPolicy: { l1Confirmations: 0 } },
};

function paymentRequired(request: Request) {
  const body = { x402Version: 2, resource: { url: new URL(request.url).toString(), description: "Cost of Trust agent due-diligence report", mimeType: "application/json" }, accepts: [requirements] };
  return new Response(JSON.stringify(body), { status: 402, headers: { "content-type": "application/json", "PAYMENT-REQUIRED": encodePaymentRequiredHeader(body as never) } });
}

type RequestBody = { agentIdentifier?: unknown; agentName?: unknown; taskValueAtRiskAda?: unknown; deadlineMinutes?: unknown; task?: unknown };

function inputFrom(body: RequestBody | null) {
  const agentIdentifier = typeof body?.agentIdentifier === "string" ? body.agentIdentifier.trim() : typeof body?.agentName === "string" ? body.agentName.trim() : "";
  const value = body?.taskValueAtRiskAda;
  if (!agentIdentifier || typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("agentIdentifier (or agentName) and non-negative taskValueAtRiskAda are required");
  if (body?.deadlineMinutes !== undefined && (typeof body.deadlineMinutes !== "number" || !Number.isFinite(body.deadlineMinutes) || body.deadlineMinutes <= 0)) throw new Error("deadlineMinutes must be positive");
  if (body?.task !== undefined && typeof body.task !== "string") throw new Error("task must be a string");
  const parsed = parseTaskInput(JSON.stringify({ agentIdentifier, taskValueAtRiskAda: value, deadlineMinutes: body?.deadlineMinutes, task: body?.task }));
  if (!parsed) throw new Error("invalid Trust Check input");
  return parsed;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as RequestBody | null;
  let input;
  try { input = inputFrom(body); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "invalid input" }, { status: 400 }); }
  const paymentHeader = request.headers.get("payment-signature");
  if (!paymentHeader) return paymentRequired(request);
  try {
    const paymentTxId = txIdFromPayment(paymentHeader);
    if (await confirmedOnChain(paymentTxId)) return NextResponse.json({ error: "payment_already_used", txId: paymentTxId }, { status: 409 });
    const report = await createReport(input);
    const settled = await settleOnce(paymentHeader, { x402Version: 2, ...requirements, resource: new URL(request.url).toString() });
    if (settled.cached) return NextResponse.json(settled.cached.report, { headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(settled.cached.paymentResponse as never) } });
    return withDeliveryLock(settled.txId, async () => {
      await recordDelivery(settled.txId, report, settled.paymentResponse);
      return NextResponse.json(report, { headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(settled.paymentResponse as never) } });
    });
  } catch (error) {
    if (error instanceof PaymentAlreadyUsedError) return NextResponse.json({ error: "payment_already_used", txId: error.txId }, { status: 409 });
    console.error("x402 trust check failed", error);
    try { return NextResponse.json({ status: "pending", txId: txIdFromPayment(paymentHeader), poll: new URL(`./pending`, request.url).toString() }, { status: 202 }); } catch { return NextResponse.json({ error: "invalid payment" }, { status: 400 }); }
  }
}
