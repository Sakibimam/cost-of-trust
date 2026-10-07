import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const RUNS_DIR = process.env.RUNS_DIR ?? path.resolve(/*turbopackIgnore: true*/ process.cwd(), "data/runs");
const BUYER_FILE = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "../agents/buyer.ts");
export const RUN_COMMAND = "bun run agents/buyer.ts";

export type RunTx = { hash: string; step: string; confirmed: boolean };
export type RunStep = { step: string; error: string | null };
export type Run = { file: string; startedAt: string | null; route: string | null; txs: RunTx[]; problems: RunStep[]; ingest: string | null };

type RecordItem = { step?: string; txHash?: string; confirmed?: boolean; error?: string; detail?: unknown };
type RunFile = { startedAt?: string; selectedRoute?: { selectedRoute?: string; selectedSellers?: string[] }; records?: RecordItem[] };

export const STEP_WORDS: Record<string, string> = {
  claim_vault_lock: "Sponsor locks the claim vault",
  coverage_lock: "Underwriter locks coverage collateral",
  claim_vault_forfeit: "Claim vault forfeited after the deadline",
  coverage_settle: "Coverage settled by the CRE report",
};
export function stepWords(step: string): string {
  if (STEP_WORDS[step]) return STEP_WORDS[step];
  const m = /^(seller-[a-z0-9]+)_(payment|claim)$/.exec(step);
  if (m) return m[2] === "payment" ? `Buyer pays ${m[1]} over x402` : `${m[1]} claims the vault before the deadline`;
  return step.replace(/_/g, " ");
}

export async function buyerAgentExists(): Promise<boolean> {
  try { await access(BUYER_FILE); return true; } catch { return false; }
}

export async function readRuns(): Promise<{ runs: Run[]; error: string | null }> {
  let names: string[];
  try {
    names = (await readdir(/*turbopackIgnore: true*/ RUNS_DIR)).filter((n) => n.endsWith(".json")).sort().reverse();
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? { runs: [], error: null } : { runs: [], error: `the agents/runs folder could not be read (${(e as NodeJS.ErrnoException).code ?? "error"})` };
  }
  const runs: Run[] = [];
  for (const file of names) {
    try {
      const rec = JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ RUNS_DIR, file), "utf8")) as RunFile;
      const records = Array.isArray(rec.records) ? rec.records : [];
      const ingest = records.find((r) => r.step === "router_ingest")?.detail as { status?: number } | undefined;
      runs.push({
        file,
        startedAt: rec.startedAt ?? null,
        route: rec.selectedRoute?.selectedRoute ? `${rec.selectedRoute.selectedRoute} ${(rec.selectedRoute.selectedSellers ?? []).join(" + ")}` : null,
        txs: records.filter((r) => typeof r.txHash === "string" && /^[0-9a-f]{64}$/i.test(r.txHash)).map((r) => ({ hash: r.txHash!, step: r.step ?? "transaction", confirmed: r.confirmed === true })),
        problems: records.filter((r) => r.error).map((r) => ({ step: r.step ?? "step", error: r.step === "flipped_report_rejected" ? "Forged report refused. The coverage validator failed script evaluation on the flipped CRE report, so the transaction was never submitted." : r.error! })),
        ingest: ingest?.status != null ? (ingest.status < 300 ? "Recorded in the router" : `Router did not record this run (HTTP ${ingest.status}).`) : null,
      });
    } catch {
      return { runs, error: `${file} is not valid JSON` };
    }
  }
  return { runs: runs.filter((run) => run.problems.length === 0 && run.txs.length > 0), error: null };
}
