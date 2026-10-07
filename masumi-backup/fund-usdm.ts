import { readFileSync } from "node:fs";
import { Blockfrost, Lucid } from "@lucid-evolution/lucid";

// usage: bun run masumi-backup/fund-usdm.ts <walletName|scan> [targetAddress amountUnits]
const unit = "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d";
const wallets = JSON.parse(readFileSync(new URL("../../recourse/.wallets.json", import.meta.url), "utf8"));
const key = process.env.BLOCKFROST_API_KEY_PREPROD;
if (!key) throw new Error("BLOCKFROST_API_KEY_PREPROD required");
const lucidFor = async (name: string) => { const lucid = await Lucid(new Blockfrost("https://cardano-preprod.blockfrost.io/api/v0", key), "Preprod"); lucid.selectWallet.fromSeed(wallets[name].seed); return lucid; };
const [who, target, amount] = process.argv.slice(2);
if (who === "scan") {
  for (const name of Object.keys(wallets)) { const lucid = await lucidFor(name); const utxos = await lucid.wallet().getUtxos(); const total = (u: string) => utxos.reduce((sum, x) => sum + (x.assets[u] ?? 0n), 0n); console.log(name, await lucid.wallet().address(), "lovelace", total("lovelace"), "tUSDM", total(unit)); }
} else {
  const lucid = await lucidFor(who);
  const tx = await lucid.newTx().pay.ToAddress(target, { lovelace: 3_000_000n, [unit]: BigInt(amount) }).complete();
  const hash = await (await tx.sign.withWallet().complete()).submit();
  console.log(hash);
}
