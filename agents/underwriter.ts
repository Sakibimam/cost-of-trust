import { lockCoverage, termsHash } from "@cost-of-trust/offchain";
import { context, config, json, parseRef, refString } from "./common";
const { lucid, deployment: d, address } = await context("admin1");
const router = process.env.ROUTER_URL ?? "http://127.0.0.1:8787";
Bun.serve({ port: Number(process.env.PORT ?? 4110), async fetch(request) { try {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/offer") { const taskId = url.searchParams.get("taskId"); if (!taskId) return json({ error: "taskId required" }, 400); const res = await fetch(`${router}/quotes/${encodeURIComponent(taskId)}`); return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } }); }
  if (request.method !== "POST" || url.pathname !== "/bind") return json({ error: "not found" }, 404);
  const b = await request.json() as { buyer: string; payoutAda: number; coverageAda: number; taskRef: string; taskExpiry: string; decideBy: string; terms: unknown };
  const terms = termsHash(b.terms); const payout = BigInt(Math.round(b.payoutAda * 1_000_000)); const locked = await lockCoverage(lucid, d, { buyer: b.buyer, payout, termsHash: terms, taskRef: parseRef(b.taskRef), taskExpiry: BigInt(b.taskExpiry), decideBy: BigInt(b.decideBy), config: config(), value: payout + 2_000_000n });
  return json({ coverageRef: refString(locked.ref), txHash: locked.txHash, termsHash, underwriter: address });
} catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); } } });
console.log(JSON.stringify({ port: Number(process.env.PORT ?? 4110), underwriter: address }));
