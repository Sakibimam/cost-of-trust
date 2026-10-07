export type EscrowSnapshot = { resultHash?: string | null; onChainState?: string | null; result?: string | null };

export function shouldHireBackup(snapshot: EscrowSnapshot | null, checkpointAt: number, now = Date.now()): boolean {
  if (now < checkpointAt) throw new Error("checkpoint has not arrived");
  return !snapshot?.resultHash && !snapshot?.result;
}

if (import.meta.main) {
  const snapshot = { resultHash: "hash" };
  if (shouldHireBackup(snapshot, 0, 1)) throw new Error("healthy escrow incorrectly hires backup");
  let broke = false;
  try { shouldHireBackup(null, 10, 1); } catch { broke = true; }
  if (!broke) throw new Error("checkpoint guard did not fail before checkpoint");
  if (!shouldHireBackup(null, 0, 1)) throw new Error("stalled escrow did not hire backup");
  console.log("checkpoint red/green self-check passed");
}
