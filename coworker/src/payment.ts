import { createHash, randomBytes } from "node:crypto";
import { env } from "./config.ts";

type Payment = Record<string, unknown>;

const mps = (path: string, init: RequestInit = {}) => fetch(`${env("MPS_URL", "http://127.0.0.1:3012/api/v1")}${path}`, {
  ...init,
  headers: { "content-type": "application/json", token: env("MPS_API_TOKEN"), ...(init.headers ?? {}) },
  signal: AbortSignal.timeout(20_000),
});

async function mpsJson(path: string, init: RequestInit = {}): Promise<Payment> {
  const response = await mps(path, init);
  const body = await response.json() as Payment;
  if (!response.ok) throw new Error(`MPS HTTP ${response.status}`);
  return body;
}

export function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

export async function createPayment(input: string): Promise<Payment> {
  const now = Date.now();
  const identifierFromPurchaser = randomBytes(10).toString("hex");
  const payment = await mpsJson("/payment", { method: "POST", body: JSON.stringify({
    network: "Preprod",
    paymentSourceType: env("MPS_PAYMENT_SOURCE_TYPE", "Web3CardanoV2"),
    supportedPaymentSourceIndex: Number(env("MPS_PAYMENT_SOURCE_INDEX", "0")),
    agentIdentifier: env("MPS_AGENT_IDENTIFIER"),
    inputHash: sha256(input),
    identifierFromPurchaser,
    RequestedFunds: [{ amount: env("MPS_TASK_AMOUNT", "1000000"), unit: env("MPS_TASK_UNIT", "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d") }],
    payByTime: new Date(now + 10 * 60_000).toISOString(),
    submitResultTime: new Date(now + 20 * 60_000).toISOString(),
    unlockTime: new Date(now + 40 * 60_000).toISOString(),
    externalDisputeUnlockTime: new Date(now + 55 * 60_000).toISOString(),
  }) });
  const data = payment.data && typeof payment.data === "object" ? payment.data as Payment : payment;
  const funds = Array.isArray(data.RequestedFunds) ? data.RequestedFunds : [];
  const sellerVkey = (data.SmartContractWallet as Payment | undefined)?.walletVkey;
  return { ...payment, data: {
    ...data,
    network: "Preprod",
    identifierFromPurchaser,
    sellerVkey,
    Amounts: funds,
    supportedPaymentSourceIndex: Number(env("MPS_PAYMENT_SOURCE_INDEX", "0")),
  } };
}

function identifier(payment: Payment): string {
  const data = payment.data && typeof payment.data === "object" ? payment.data as Payment : payment;
  const value = data.blockchainIdentifier;
  if (typeof value !== "string" || !value) throw new Error("MPS payment did not return blockchainIdentifier");
  return value;
}

export async function submitResult(payment: Payment, result: string): Promise<Payment> {
  return mpsJson("/payment/submit-result", { method: "POST", body: JSON.stringify({ network: "Preprod", blockchainIdentifier: identifier(payment), submitResultHash: sha256(result) }) });
}

export async function waitForPayment(payment: Payment, timeoutMs = 10 * 60_000): Promise<Payment> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await mpsJson("/payment/resolve-blockchain-identifier", { method: "POST", body: JSON.stringify({ network: "Preprod", blockchainIdentifier: identifier(payment), includeHistory: "true" }) });
    const data = (current.data ?? current) as Payment;
    const state = String(data.onChainState ?? "");
    if (["FundsLocked", "ResultSubmitted", "WithdrawAuthorized", "Withdrawn", "DisputedWithdrawn"].includes(state)) return current;
    if (["RefundWithdrawn", "FundsOrDatumInvalid"].includes(state)) throw new Error(`MPS payment terminal state ${state}`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error("MPS payment polling timed out");
}
