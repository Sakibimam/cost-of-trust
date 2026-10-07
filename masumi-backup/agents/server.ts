import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const role = process.env.AGENT_ROLE === "backup" ? "backup" : "primary";
const port = Number(process.env.PORT ?? (role === "backup" ? 4512 : 4511));
const mps = process.env.MPS_URL ?? "http://127.0.0.1:3012/api/v1";
const token = process.env.MPS_API_TOKEN;
const agentIdentifier = process.env[role === "backup" ? "MASUMI_BACKUP_ID" : "MASUMI_PRIMARY_ID"];
const priceAsset = process.env.MASUMI_PRICE_ASSET ?? "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d";
const jobs = new Map<string, { payment: Record<string, any>; result?: string; status: string }>();

if (!token || !agentIdentifier) throw new Error("MPS_API_TOKEN and the registered agent identifier are required");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const mpsJson = async (path: string, body: Record<string, unknown>) => {
  const response = await fetch(`${mps}${path}`, { method: "POST", headers: { "content-type": "application/json", token }, body: JSON.stringify(body) });
  const json = await response.json() as any;
  if (!response.ok) throw new Error(`MPS ${response.status}: ${JSON.stringify(json).slice(0, 500)}`);
  return json.data ?? json;
};
const identifier = (payment: Record<string, any>) => String(payment.blockchainIdentifier ?? payment.data?.blockchainIdentifier);
const submit = async (job: { payment: Record<string, any>; result?: string; status: string }, result: string) => {
  job.result = result;
  await mpsJson("/payment/submit-result", { network: "Preprod", blockchainIdentifier: identifier(job.payment), submitResultHash: sha256(result) });
  job.status = "completed";
};
const readBody = async (request: IncomingMessage) => { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, any>; };
const send = (response: ServerResponse, status: number, body: unknown) => { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)); };

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/availability") return send(response, 200, { status: process.env.STALL === "true" && role === "primary" ? "unavailable" : "available" });
    if (request.method === "GET" && request.url === "/input_schema") return send(response, 200, { input_schema: { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri" } } } });
    if (request.method === "POST" && request.url === "/start_job") {
      const input = await readBody(request);
      if (typeof input.url !== "string" || !/^https?:\/\//.test(input.url)) return send(response, 400, { error: "url is required" });
      const now = Date.now();
      const identifierFromPurchaser = randomBytes(10).toString("hex");
      const payment = await mpsJson("/payment", { network: "Preprod", paymentSourceType: "Web3CardanoV2", supportedPaymentSourceIndex: 0, agentIdentifier, inputHash: sha256(JSON.stringify(input)), identifierFromPurchaser, payByTime: new Date(now + 5 * 60_000).toISOString(), submitResultTime: new Date(now + 20 * 60_000).toISOString(), unlockTime: new Date(now + 40 * 60_000).toISOString(), externalDisputeUnlockTime: new Date(now + 55 * 60_000).toISOString() });
      const jobId = crypto.randomUUID();
      jobs.set(jobId, { payment, status: "awaiting_purchase" });
      if (!(process.env.STALL === "true" && role === "primary")) void (async () => {
        const html = await (await fetch(input.url, { signal: AbortSignal.timeout(10_000) })).text();
        const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? new URL(input.url).hostname;
        for (let i = 0; i < 60; i++) {
          try { await mpsJson("/payment/resolve-blockchain-identifier", { network: "Preprod", blockchainIdentifier: identifier(payment), includeHistory: "true" }); await submit(jobs.get(jobId)!, `Title: ${title}`); return; } catch { await new Promise((resolve) => setTimeout(resolve, 2_000)); }
        }
      })();
      return send(response, 200, { job_id: jobId, payment: { ...payment, identifierFromPurchaser } });
    }
    if (request.method === "GET" && request.url?.startsWith("/status?job_id=")) {
      const job = jobs.get(new URL(request.url, "http://localhost").searchParams.get("job_id")!);
      return job ? send(response, 200, { status: job.status, result: job.result }) : send(response, 404, { error: "unknown job" });
    }
    send(response, 404, { error: "not found" });
  } catch (error) { send(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
});
server.listen(port, "127.0.0.1", () => console.error(`${role} agent listening on ${port}`));
