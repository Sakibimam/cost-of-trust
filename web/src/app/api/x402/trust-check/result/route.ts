import { NextResponse } from "next/server";
import { createReport } from "../../../../../../../coworker/src/report";
import { decodeRequest, encodeRequest, requirements } from "../../../../../lib/x402/input";
import { TRUST_CHECK_PAY_TO } from "../../../../../lib/x402/payto";
import { encodePaymentResponseHeader, getDelivery, readPayment, recordDelivery, withDeliveryLock } from "../../../../../lib/x402/settlement";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PAYMENT_AGE_SECONDS = 24 * 3600;

// Stateless delivery for a payment whose POST did not finish: the chain is the receipt. The tx must be in a block
// and pay the Trust Check address at least the required amount, then the report for the request in `req` is computed.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const txId = params.get("tx") ?? "";
  const encoded = params.get("req") ?? "";
  if (!/^[0-9a-f]{64}$/.test(txId)) return NextResponse.json({ error: "tx must be a 64 character lowercase hex transaction hash" }, { status: 400 });
  let input;
  try { input = decodeRequest(encoded); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "invalid req" }, { status: 400 }); }
  const requestHash = encodeRequest(input);

  try {
    const delivered = await getDelivery(txId);
    if (delivered?.requestHash && delivered.requestHash !== requestHash) return NextResponse.json({ error: "payment_already_used", txId }, { status: 409 });
    if (delivered) return NextResponse.json(delivered.report, { headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(delivered.paymentResponse as never) } });

    const payment = await readPayment(txId, TRUST_CHECK_PAY_TO);
    if (!payment.confirmed) return NextResponse.json({ status: "pending", txId, note: "transaction is not in a block yet" }, { status: 202, headers: { "retry-after": "10" } });
    if (payment.lovelaceToPayTo < BigInt(requirements.amount)) return NextResponse.json({ error: "payment_not_valid", txId, reason: `transaction pays ${payment.lovelaceToPayTo} lovelace to ${TRUST_CHECK_PAY_TO}, ${requirements.amount} required` }, { status: 402 });
    if (payment.timestamp === null || Date.now() / 1000 - payment.timestamp > MAX_PAYMENT_AGE_SECONDS) return NextResponse.json({ error: "payment_expired", txId }, { status: 402 });

    return await withDeliveryLock(txId, async () => {
      const report = await createReport(input);
      const paymentResponse = { success: true, transaction: txId, network: requirements.network };
      await recordDelivery(txId, report, paymentResponse, requestHash);
      return NextResponse.json(report, { headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(paymentResponse as never) } });
    });
  } catch (error) {
    console.error("x402 trust check result failed", error);
    return NextResponse.json({ status: "pending", txId, note: "could not read the chain or compute the report, retry" }, { status: 202, headers: { "retry-after": "10" } });
  }
}
