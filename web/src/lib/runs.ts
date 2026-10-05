import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const RUNS_DIR = process.env.RUNS_DIR ?? path.resolve(/*turbopackIgnore: true*/ process.cwd(), "../agents/runs");
export const RUN_COMMAND = "DEMO_LOSS_ADA=10 bun run agents/buyer.ts";

export type RunTx = { hash: string; label: string; status: string; detail: string };
export type Run = { file: string; startedAt: string | null; txs: RunTx[]; outcome: { label: string; value: string }[] };

const HASH = /^[0-9a-f]{64}$/i;
const HASH_KEYS = ["txHash", "tx_hash", "hash", "txId", "txid", "tx", "id"];
const LABEL_KEYS = ["label", "name", "step", "action", "kind", "role", "what", "event", "phase"];
const STATUS_KEYS = ["status", "tx_status", "koiosStatus", "koios_status", "confirmation", "state"];
const DETAIL_KEYS = ["description", "detail", "details", "note", "message", "summary"];
const OUTCOME_KEYS = ["outcome", "decision", "settlement", "result", "adjudication", "verdict"];

const pick = (o: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return { key: k, value: String(v) };
  }
  return null;
};

function collectTxs(node: unknown, hint: string, out: RunTx[], seen: Set<string>) {
  if (Array.isArray(node)) return node.forEach((n, i) => collectTxs(n, hint || String(i), out, seen));
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  const h = pick(o, HASH_KEYS);
  if (h && HASH.test(h.value) && !seen.has(h.value)) {
    seen.add(h.value);
    out.push({ hash: h.value, label: pick(o, LABEL_KEYS)?.value ?? hint, status: pick(o, STATUS_KEYS)?.value ?? "", detail: pick(o, DETAIL_KEYS)?.value ?? "" });
  }
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" && HASH.test(v) && !HASH_KEYS.includes(k) && !seen.has(v)) {
      seen.add(v);
      out.push({ hash: v, label: k, status: "", detail: "" });
    } else if (v && typeof v === "object") collectTxs(v, k, out, seen);
  }
}

function collectOutcome(rec: Record<string, unknown>): Run["outcome"] {
  for (const k of OUTCOME_KEYS) {
    const v = rec[k];
    if (v == null) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      const rows = Object.entries(v as Record<string, unknown>).filter(([, x]) => ["string", "number", "boolean"].includes(typeof x) && !(typeof x === "string" && HASH.test(x)));
      if (rows.length) return rows.map(([a, b]) => ({ label: a, value: String(b) }));
    } else return [{ label: k, value: String(v) }];
  }
  return [];
}

export async function readRuns(): Promise<{ runs: Run[]; error: string | null }> {
  let names: string[];
  try {
    names = (await readdir(/*turbopackIgnore: true*/ RUNS_DIR)).filter((n) => n.endsWith(".json")).sort();
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? { runs: [], error: null } : { runs: [], error: `cannot read ${RUNS_DIR}: ${(e as Error).message}` };
  }
  const runs: Run[] = [];
  for (const file of names.reverse()) {
    try {
      const rec = JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ RUNS_DIR, file), "utf8")) as Record<string, unknown>;
      const txs: RunTx[] = [];
      collectTxs(rec, "", txs, new Set());
      runs.push({ file, startedAt: pick(rec, ["startedAt", "started_at", "timestamp", "createdAt", "date"])?.value ?? null, txs, outcome: collectOutcome(rec) });
    } catch (e) {
      return { runs, error: `${file} is not valid JSON: ${(e as Error).message}` };
    }
  }
  return { runs, error: null };
}
