import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { makeLucid, deployment, type Config, type Deployment } from "@cost-of-trust/offchain";
const walletPath = process.env.COT_WALLETS ?? "/Users/user/Desktop/canton/recourse/.wallets.json";
const wallets = JSON.parse(readFileSync(walletPath, "utf8")) as Record<string, { seed: string }>;
export async function context(actor: string): Promise<{ lucid: Awaited<ReturnType<typeof makeLucid>>; deployment: Deployment; address: string }> {
  const lucid = await makeLucid();
  const seed = wallets[actor]?.seed;
  if (!seed) throw new Error(`wallet actor ${actor} is missing`);
  lucid.selectWallet.fromSeed(seed);
  const address = await lucid.wallet().address();
  const deploymentFile = process.env.COT_DEPLOYMENT ?? resolve(import.meta.dirname, "../offchain/deployment.json");
  const d = deployment(JSON.parse(readFileSync(deploymentFile, "utf8")).seed);
  return { lucid, deployment: d, address };
}
export function config(): Config {
  const path = process.env.COT_CONFIG ?? resolve(import.meta.dirname, "../offchain/config.json");
  const c = JSON.parse(readFileSync(path, "utf8")) as { signers: string[]; f: number; workflowOwner: string; workflowName: string; workflowCid: string; donConfigDigest: string; claimVaultHash: string };
  return { ...c, f: BigInt(c.f) };
}
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
export const refString = (r: { txHash: string; outputIndex: number }) => `${r.txHash}#${r.outputIndex}`;
export const parseRef = (s: string) => { const [txHash, index] = s.split("#"); if (!/^[0-9a-f]{64}$/i.test(txHash) || !/^\d+$/.test(index ?? "")) throw new Error("out-ref must be txhash#index"); return { txHash, outputIndex: Number(index) }; };
