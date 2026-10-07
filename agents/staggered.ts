import { refString, type parseRef } from "./common";

export type CheckpointDecision = "backup_not_needed" | "backup_engaged";
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function checkpointDecision(
  ref: ReturnType<typeof parseRef>,
  claimAddress: string,
  fetcher: Fetcher = fetch,
  koiosUrl = process.env.X402_KOIOS_URL ?? "http://127.0.0.1:4102/koios",
): Promise<CheckpointDecision> {
  const response = await fetcher(`${koiosUrl}/address_utxos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ _addresses: [claimAddress] }),
  });
  if (!response.ok) throw new Error(`Koios address_utxos returned ${response.status}`);
  const rows = await response.json() as Array<{ tx_hash?: string; tx_index?: number }>;
  const unspent = rows.some((row) => row.tx_hash === ref.txHash && row.tx_index === ref.outputIndex);
  return unspent ? "backup_engaged" : "backup_not_needed";
}

export const checkpointRef = (ref: ReturnType<typeof parseRef>) => refString(ref);
