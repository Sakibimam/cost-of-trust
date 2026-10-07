import { decodePaymentSignatureHeader, encodePaymentRequiredHeader } from "@x402/core/http";
import { x402Facilitator } from "@x402/core/facilitator";
import { toFacilitatorCardanoSigner } from "@x402/cardano";
import { ExactCardanoScheme } from "@x402/cardano/exact/facilitator";
import { claim } from "@cost-of-trust/offchain";
import { context, json, parseRef, refString } from "./common";

const id = process.env.SELLER_ID ?? "seller-b";
const port = Number(process.env.PORT ?? (id === "seller-a" ? 4101 : id === "seller-c" ? 4103 : 4102));
const stall = process.env.STALL === "true";
const koiosUrl = `http://127.0.0.1:${port}/koios`;
const { lucid, deployment: d, address } = await context(id === "seller-a" ? "relayer" : id === "seller-c" ? "admin2" : "seller");
const routerUrl = process.env.ROUTER_URL ?? "http://127.0.0.1:8787";
const sellerConfigResponse = await fetch(`${routerUrl}/sellers`);
if (!sellerConfigResponse.ok) throw new Error(`seller config failed ${sellerConfigResponse.status}`);
const sellerConfig = (await sellerConfigResponse.json() as Array<{ id: string; priceAda: number; payTo: string }>).find((seller) => seller.id === id);
if (!sellerConfig) throw new Error(`router seller record missing ${id}`);
if (sellerConfig.payTo !== address) throw new Error(`router payTo does not match keeper address for ${id}`);
const configuredPriceLovelace = BigInt(Math.round(sellerConfig.priceAda * 1_000_000));
const signer = toFacilitatorCardanoSigner({ network: "cardano:preprod", provider: { koios: { baseUrl: koiosUrl }, requestTimeoutMs: 120_000 } });
const facilitator = new x402Facilitator();
facilitator.register("cardano:preprod", new ExactCardanoScheme(signer));

type Job = { id: string; ref: ReturnType<typeof parseRef>; beneficiary: string; expiry: bigint; paymentTx?: string; result?: Record<string, unknown>; error?: string };
const jobs = new Map<string, Job>();
const paymentJobs = new Map<string, string>();
const requirements = (body: Record<string, unknown>, jobId: string) => ({
  x402Version: 2,
  resource: { url: `${process.env.PUBLIC_URL ?? `http://127.0.0.1:${port}`}/jobs/${jobId}`, description: `Cost-of-Trust keeper ${id}`, mimeType: "application/json" },
  accepts: [{ scheme: "exact", network: "cardano:preprod", amount: configuredPriceLovelace.toString(), asset: "lovelace", payTo: address, maxTimeoutSeconds: 600, extra: { assetTransferMethod: "default", confirmationPolicy: { l1Confirmations: 0 }, costOfTrust: { jobId, riskQuoteEndpoint: `${routerUrl}/quotes/${String(body.taskId ?? jobId)}`, riskTermsHash: body.termsHash } } }]
});

function paymentKey(payment: ReturnType<typeof decodePaymentSignatureHeader>): string {
  const payload = payment.payload as { transaction?: unknown; nonce?: unknown };
  if (typeof payload.transaction !== "string" || typeof payload.nonce !== "string") throw new Error("payment payload missing transaction nonce");
  return `${payload.transaction}:${payload.nonce}`;
}

function bindPaymentToJob(payment: ReturnType<typeof decodePaymentSignatureHeader>, req: ReturnType<typeof requirements>, jobId: string): string {
  if (payment.resource?.url !== req.resource.url) throw new Error("payment resource is not bound to this job");
  const extra = req.accepts[0].extra as { costOfTrust?: { jobId?: string } };
  if (extra.costOfTrust?.jobId !== jobId) throw new Error("payment terms are not bound to this job");
  const key = paymentKey(payment);
  const previous = paymentJobs.get(key);
  if (previous && previous !== jobId) throw new Error("payment already used for another job");
  if (previous === jobId) throw new Error("payment replay refused");
  paymentJobs.set(key, jobId);
  return key;
}

async function settlePayment(header: string, req: ReturnType<typeof requirements>["accepts"][number]): Promise<string> {
  const payment = decodePaymentSignatureHeader(header);
  const verified = await facilitator.verify(payment as never, req as never);
  if (!verified.isValid) throw new Error(`payment rejected: ${verified.invalidReason ?? "invalid"} ${verified.invalidMessage ?? ""}`.trim());
  const deadline = Date.now() + 240_000;
  for (;;) {
    const settled = await facilitator.settle(payment as never, req as never);
    if (settled.success) return settled.transaction;
    if (!["settlement_pending", "exact_cardano_settlement_not_confirmed"].includes(settled.errorReason ?? "") || Date.now() >= deadline) throw new Error(`payment settlement failed: ${settled.errorReason ?? "failed"} ${settled.errorMessage ?? ""}`.trim());
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

function requirementsResponse(body: Record<string, unknown>, jobId: string): Response {
  const payment = requirements(body, jobId);
  return json({ x402Version: 2, accepts: payment.accepts }, 402, { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(payment as never) });
}

async function createJob(input: Record<string, unknown>): Promise<Job> {
  const ref = parseRef(String(input.claimVault ?? ""));
  const beneficiary = String(input.beneficiary ?? "");
  const expiry = BigInt(String(input.expiry ?? "0"));
  if (!beneficiary || expiry <= 0n) throw new Error("beneficiary and expiry are required");
  const job = { id: crypto.randomUUID(), ref, beneficiary, expiry };
  jobs.set(job.id, job);
  return job;
}

Bun.serve({ port, async fetch(request) {
  try {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/koios/")) {
      const path = url.pathname.slice("/koios".length);
      const allowed = new Set(["GET /tip", "GET /epoch_params", "POST /address_info", "POST /tx_info", "POST /tx_status", "POST /tx_utxos", "POST /submittx"]);
      if (!allowed.has(`${request.method} ${path}`)) return json({ error: "koios path not allowed" }, 404);
      const raw = path === "/submittx" ? "" : await request.text();
      let body: BodyInit | undefined = path === "/submittx" ? await request.arrayBuffer() : raw;
      if (path === "/tx_info" && raw) {
        const payload = JSON.parse(raw) as Record<string, unknown>;
        payload._bytecode = true;
        body = JSON.stringify(payload);
      }
      for (let attempt = 0; ; attempt++) {
        const upstream = await fetch(`https://preprod.koios.rest/api/v1${path}${url.search}`, { method: request.method, headers: { authorization: `Bearer ${process.env.KAIOS_KEY}`, "content-type": request.headers.get("content-type") ?? "application/json" }, body: request.method === "GET" ? undefined : body });
        if (upstream.status !== 429 || attempt >= 5) return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" } });
        await new Promise((resolve) => setTimeout(resolve, Number(upstream.headers.get("retry-after") ?? 0) * 1000 || 250 * 2 ** attempt));
      }
    }
    if (request.method === "GET" && url.pathname === "/availability") return json({ available: true, seller: id, network: "cardano:preprod" });
    if (request.method === "GET" && url.pathname === "/input_schema") return json({ input_data: [{ id: "taskId", type: "string", required: true }, { id: "claimVault", type: "string", required: true }, { id: "beneficiary", type: "string", required: true }, { id: "expiry", type: "string", required: true }, { id: "priceLovelace", type: "integer", required: false }, { id: "termsHash", type: "string", required: false }] });
    if (request.method === "GET" && url.pathname === "/status") {
      const job = jobs.get(url.searchParams.get("job_id") ?? "");
      if (!job) return json({ error: "job not found" }, 404);
      return json({ job_id: job.id, status: job.result ? "completed" : job.error ? "failed" : job.paymentTx ? "running" : "awaiting_payment", paymentTx: job.paymentTx ?? null, result: job.result ?? null, error: job.error ?? null });
    }
    if (request.method === "POST" && (url.pathname === "/start_job" || url.pathname === "/jobs")) {
      const body = await request.json() as Record<string, unknown>;
      const input = (body.input_data && typeof body.input_data === "object" ? body.input_data : body) as Record<string, unknown>;
      if (!input.taskId || !input.claimVault || !input.beneficiary || !input.expiry) return json({ error: "taskId, claimVault, beneficiary and expiry are required" }, 400);
      const existing = typeof body.job_id === "string" ? jobs.get(body.job_id) : undefined;
      const job = existing ?? await createJob(input);
      const paymentHeader = request.headers.get("payment-signature");
      if (!paymentHeader) return new Response(JSON.stringify({ x402Version: 2, job_id: job.id, accepts: requirements(input, job.id).accepts }), { status: 402, headers: { "content-type": "application/json", "PAYMENT-REQUIRED": encodePaymentRequiredHeader(requirements(input, job.id) as never) } });
      if (job.paymentTx) return json({ job_id: job.id, status: job.result ? "completed" : job.error ? "failed" : "running", paymentTx: job.paymentTx });
      const payment = decodePaymentSignatureHeader(paymentHeader);
      bindPaymentToJob(payment, requirements(input, job.id), job.id);
      const paymentTx = await settlePayment(paymentHeader, requirements(input, job.id).accepts[0]);
      job.paymentTx = paymentTx;
      if (stall) {
        console.log(JSON.stringify({ seller: id, stall: true, jobId: job.id }));
        job.result = { accepted: true, stalled: true, paymentTx };
        return json({ job_id: job.id, status: "completed", ...job.result });
      }
      // The claim runs after the payment response so a buyer paying several keepers from one wallet is never blocked behind a claim confirmation.
      claim(lucid, d, job.ref, job.beneficiary, job.expiry).then((claimTx) => { job.result = { accepted: true, seller: id, paymentTx, claimTx, claimRef: refString(job.ref) }; }, (error) => { job.error = error instanceof Error ? error.message : String(error); console.log(JSON.stringify({ seller: id, jobId: job.id, claimRejected: job.error })); });
      return json({ job_id: job.id, status: "running", accepted: true, seller: id, paymentTx });
    }
    return json({ error: "not found" }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}, hostname: "127.0.0.1" });
console.log(JSON.stringify({ seller: id, port, stall, address, mip003: ["/availability", "/input_schema", "/start_job", "/status"] }));
