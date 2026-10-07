import { NextResponse } from "next/server";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { createReport } from "../../../../../../coworker/src/report";
import { encodeRequest, inputFrom, requirements, type RequestBody } from "../../../../lib/x402/input";
import { confirmedOnChain, getDelivery, PaymentAlreadyUsedError, PaymentRejectedError, recordDelivery, settleOnce, txIdFromPayment, withDeliveryLock, encodePaymentResponseHeader } from "../../../../lib/x402/settlement";

export const runtime = "nodejs";
export const maxDuration = 60;

function paymentRequired(request: Request, error?: string) {
  const body = { x402Version: 2, ...(error ? { error } : {}), resource: { url: new URL(request.url).toString(), description: "Cost of Trust agent due-diligence report", mimeType: "application/json" }, accepts: [requirements] };
  return new Response(JSON.stringify(body), { status: 402, headers: { "content-type": "application/json", "PAYMENT-REQUIRED": encodePaymentRequiredHeader(body as never) } });
}

const resultUrl = (request: Request, txId: string, input: ReturnType<typeof inputFrom>) => {
  const url = new URL(request.url);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/result`;
  url.search = "";
  url.searchParams.set("tx", txId);
  url.searchParams.set("req", encodeRequest(input));
  return url.toString();
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as RequestBody | null;
  let input;
  try { input = inputFrom(body); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "invalid input" }, { status: 400 }); }
  const paymentHeader = request.headers.get("payment-signature");
  if (!paymentHeader) return paymentRequired(request);
  let paymentTxId: string;
  try { paymentTxId = txIdFromPayment(paymentHeader); } catch { return NextResponse.json({ error: "invalid payment" }, { status: 400 }); }
  const requestHash = encodeRequest(input);
  try {
    const delivered = await getDelivery(paymentTxId);
    if (delivered && delivered.requestHash === requestHash) return NextResponse.json(delivered.report, { headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(delivered.paymentResponse as never) } });
    if (await confirmedOnChain(paymentTxId)) return NextResponse.json({ error: "payment_already_used", txId: paymentTxId, poll: resultUrl(request, paymentTxId, input) }, { status: 409 });
    // Settlement waits for the chain and the report is computed meanwhile, so the 60 s budget is spent once.
    const [settled, report] = await Promise.all([settleOnce(paymentHeader, { x402Version: 2, ...requirements, resource: new URL(request.url).toString() }), createReport(input)]);
    if (settled.cached) return NextResponse.json(settled.cached.report, { headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(settled.cached.paymentResponse as never) } });
    return withDeliveryLock(settled.txId, async () => {
      await recordDelivery(settled.txId, report, settled.paymentResponse, requestHash);
      return NextResponse.json(report, { headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(settled.paymentResponse as never) } });
    });
  } catch (error) {
    if (error instanceof PaymentAlreadyUsedError) return NextResponse.json({ error: "payment_already_used", txId: error.txId, poll: resultUrl(request, error.txId, input) }, { status: 409 });
    if (error instanceof PaymentRejectedError) return paymentRequired(request, error.message);
    console.error("x402 trust check failed", error);
    return NextResponse.json({ status: "pending", txId: paymentTxId, poll: resultUrl(request, paymentTxId, input) }, { status: 202, headers: { "retry-after": "10" } });
  }
}
