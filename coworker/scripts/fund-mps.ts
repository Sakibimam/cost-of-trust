import { readFileSync } from "node:fs";
import { Koios, Lucid } from "@lucid-evolution/lucid";

const target = process.argv[2];
if (!target) throw new Error("usage: npm run fund-mps -- addr_test1...");
const walletFile = process.env.WALLET_FILE ?? new URL("../../recourse/.wallets.json", import.meta.url);
const wallets = JSON.parse(readFileSync(walletFile, "utf8")) as { buyer?: { seed?: string } };
const seed = wallets.buyer?.seed;
if (!seed) throw new Error("buyer wallet seed is unavailable");
const lucid = await Lucid(new Koios("https://preprod.koios.rest/api/v1"), "Preprod");
lucid.selectWallet.fromSeed(seed);
const tx = await lucid.newTx().pay.ToAddress(target, { lovelace: 200_000_000n }).complete();
const hash = await (await tx.sign.withWallet().complete()).submit();
await lucid.awaitTx(hash);
console.log(hash);
