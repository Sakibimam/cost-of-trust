import { writeFile } from "node:fs/promises";

// usage: bun run masumi-backup/collect.ts <stall|healthy> <runFileStamp> <untilEpochMs> <primaryPurchaseId> [backupPurchaseId]
// Reads both escrows back from MPS (system of record) and Koios, rewrites the run file each poll until the
// primary refund (stall) or both collections (healthy) land, or until the deadline.
const [mode, sinceIso, untilMs, primaryPid, backupPid] = [process.argv[2], process.argv[3], Number(process.argv[4]), process.argv[5], process.argv[6]];
const mps = process.env.MPS_URL ?? "http://127.0.0.1:3012/api/v1";
const token = process.env.MPS_API_TOKEN!;
const get = async (path: string) => { const r = await fetch(`${mps}${path}`, { headers: { token }, signal: AbortSignal.timeout(60_000) }); const j = await r.json() as any; if (!r.ok) throw new Error(`MPS ${r.status}`); return j.data; };
const koios = async (hash: string) => { const r = await fetch("https://preprod.koios.rest/api/v1/tx_status", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.KAIOS_KEY}` }, body: JSON.stringify({ _tx_hashes: [hash] }), signal: AbortSignal.timeout(30_000) }); return r.ok ? ((await r.json()) as any[])[0]?.num_confirmations ?? null : `HTTP ${r.status}`; };
const file = `agents/runs/${sinceIso.replaceAll(":", "-").replaceAll(".", "-")}-masumi-backup-${mode}.json`;
const view = async (p: any) => {
  const txs = [...(p.TransactionHistory ?? []), ...(p.CurrentTransaction ? [p.CurrentTransaction] : [])].filter((t: any) => t?.txHash);
  const seen = new Set<string>();
  const out: any[] = [];
  for (const t of txs) { if (seen.has(t.txHash)) continue; seen.add(t.txHash); out.push({ txHash: t.txHash, status: t.status, newOnChainState: t.newOnChainState ?? null, at: t.createdAt ?? null, koiosConfirmations: await koios(t.txHash) }); }
  return { blockchainIdentifier: p.blockchainIdentifier, agentIdentifier: p.agentIdentifier, createdAt: p.createdAt, onChainState: p.onChainState, nextAction: p.NextAction?.requestedAction, error: p.NextAction?.errorNote ?? null, resultHash: p.resultHash ?? null, resultAt: p.resultHash ? p.onChainStateOrResultLastChangedAt : null, payByTime: new Date(Number(p.payByTime)).toISOString(), submitResultTime: new Date(Number(p.submitResultTime)).toISOString(), unlockTime: new Date(Number(p.unlockTime)).toISOString(), externalDisputeUnlockTime: new Date(Number(p.externalDisputeUnlockTime)).toISOString(), txs: out };
};
const done = (a: any, b: any) => mode === "stall" ? a?.onChainState === "RefundWithdrawn" && b?.onChainState === "Withdrawn" : a?.onChainState === "Withdrawn";
for (;;) {
  const { Purchases } = await get("/purchase?network=Preprod&limit=20&filterPaymentSourceType=Web3CardanoV2&includeHistory=true");
  const a = Purchases.find((p: any) => p.id === primaryPid), b = backupPid ? Purchases.find((p: any) => p.id === backupPid) : undefined;
  const run = { mode, since: sinceIso, polledAt: new Date().toISOString(), primary: a ? await view(a) : null, backup: b ? await view(b) : null, buyerCheckpointMs: Number(process.env.CHECKPOINT_MS ?? 0), backupHired: Boolean(b) };
  await writeFile(file, `${JSON.stringify(run, null, 2)}\n`);
  console.log(JSON.stringify({ at: run.polledAt, primary: run.primary?.onChainState ?? run.primary?.nextAction ?? null, backup: run.backup?.onChainState ?? run.backup?.nextAction ?? null, backupResult: Boolean(run.backup?.resultHash) }));
  if ((a && done(a, b)) || Date.now() > untilMs) break;
  await new Promise((r) => setTimeout(r, 30_000));
}
