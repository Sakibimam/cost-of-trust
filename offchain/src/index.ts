import { blake2b } from "@noble/hashes/blake2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { Constr, Data, getAddressDetails, paymentCredentialOf, type Assets, type LucidEvolution, type UTxO } from "@lucid-evolution/lucid";
import { claimVaultScript, configLockScript, configPolicy, coverageScript, scriptAddress, scriptHash, type OutRef } from "./blueprint";
import { installKoios, makeLucid, submitRejection, waitForTx } from "./provider";
export * from "./provider";
export * from "./blueprint";
export type { LucidEvolution };

const enc = new TextEncoder();
const hex = (x: Uint8Array) => Buffer.from(x).toString("hex");
const bytes = (x: string) => Uint8Array.from(Buffer.from(x, "hex"));
const refData = (r: OutRef) => new Constr(0, [r.txHash, BigInt(r.outputIndex)]);
const addressData = (address: string) => {
  const d = getAddressDetails(address);
  if (d.paymentCredential?.type !== "Key") throw new Error("datum address must use a payment key");
  const pay = new Constr(0, [d.paymentCredential.hash]);
  if (!d.stakeCredential) return new Constr(0, [pay, new Constr(1, [])]);
  if (d.stakeCredential.type !== "Key") throw new Error("datum address must use a stake key");
  return new Constr(0, [pay, new Constr(0, [new Constr(0, [new Constr(0, [d.stakeCredential.hash])])])]);
};
const keyHash = (address: string) => { const c = paymentCredentialOf(address); if (c.type !== "Key") throw new Error("wallet address has no payment key"); return c.hash; };
const network = "Preprod" as const;
export type Deployment = { seed: OutRef; configPolicyId: string; configLockHash: string; configAddress: string; claimAddress: string; coverageAddress: string };
export function deployment(seed: OutRef): Deployment { const lock = configLockScript(); const lockHash = scriptHash(lock); const policy = configPolicy(seed, lockHash); return { seed, configPolicyId: scriptHash(policy), configLockHash: lockHash, configAddress: scriptAddress(network, lock), claimAddress: scriptAddress(network, claimVaultScript()), coverageAddress: scriptAddress(network, coverageScript(scriptHash(policy))) }; }
export const CONFIG_NAME = hex(enc.encode("COST_OF_TRUST_CONFIG"));
export type Config = { signers: string[]; f: bigint; workflowOwner: string; workflowName: string; workflowCid: string; donConfigDigest: string; claimVaultHash: string };
export type ClaimDatum = { beneficiary: string; expiry: bigint; sponsor: string };
export type CoverageDatum = { termsHash: string; buyer: string; underwriter: string; payout: bigint; taskRef: OutRef; taskExpiry: bigint; decideBy: bigint; configDigest: string };
export type Report = { raw_report: string; report_context: string; sigs: string[] };
const claimDatum = (d: ClaimDatum) => Data.to(new Constr(0, [addressData(d.beneficiary), d.expiry, d.sponsor]));
const coverageDatum = (d: CoverageDatum) => Data.to(new Constr(0, [d.termsHash, addressData(d.buyer), addressData(d.underwriter), d.payout, refData(d.taskRef), d.taskExpiry, d.decideBy, d.configDigest]));
const configDatum = (c: Config) => Data.to(new Constr(0, [c.signers, c.f, c.workflowOwner, c.workflowName, c.workflowCid, c.donConfigDigest, c.claimVaultHash]));
const configDigest = (c: Config) => hex(blake2b(new Uint8Array([Number(c.f), ...bytes(c.workflowOwner), ...bytes(c.workflowName), ...bytes(c.workflowCid), ...bytes(c.donConfigDigest), ...bytes(c.claimVaultHash), c.signers.length, ...c.signers.flatMap((x) => [...bytes(x)])]), { dkLen: 32 }));
export { configDigest };
export function canonicalJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`; return JSON.stringify(value); }
export const termsHash = (value: unknown) => hex(blake2b(enc.encode(canonicalJson(value)), { dkLen: 32 }));
async function submit(lucid: LucidEvolution, tx: any, label: string): Promise<string> { const signed = await tx.sign.withWallet().complete(); const hash = await signed.submit().catch((error: unknown) => { throw new Error(`${label} rejected at submission: ${submitRejection()} (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`); }); await waitForTx(hash); return hash; }
async function out(lucid: LucidEvolution, ref: OutRef): Promise<UTxO> { const found = await lucid.utxosByOutRef([ref]); if (!found[0]) throw new Error(`UTxO ${ref.txHash}#${ref.outputIndex} not found`); return found[0]; }
async function configInput(lucid: LucidEvolution, d: Deployment): Promise<UTxO> { const u = await lucid.utxoByUnit(d.configPolicyId + CONFIG_NAME); if (!u) throw new Error("config NFT UTxO not found"); return u; }
export async function deployRefScripts(lucid: LucidEvolution, d: Deployment, holder: string): Promise<string> { const tx = await lucid.newTx().pay.ToAddressWithData(holder, undefined, { lovelace: 2_000_000n }, claimVaultScript()).pay.ToAddressWithData(holder, undefined, { lovelace: 2_000_000n }, coverageScript(d.configPolicyId)).complete(); return submit(lucid, tx, "deployRefScripts"); }
export async function mintConfig(lucid: LucidEvolution, c: Config, seed?: OutRef): Promise<{ txHash: string; deployment: Deployment }> { const wallet = await lucid.wallet().getUtxos(); const u = seed ? wallet.find((x) => x.txHash === seed.txHash && x.outputIndex === seed.outputIndex) : wallet[0]; if (!u) throw new Error("config seed UTxO not found"); const s = { txHash: u.txHash, outputIndex: u.outputIndex }; const d = deployment(s); const policy = configPolicy(s, d.configLockHash); const unit = d.configPolicyId + CONFIG_NAME; const tx = await lucid.newTx().collectFrom([u]).mintAssets({ [unit]: 1n }, Data.void()).attach.MintingPolicy(policy).pay.ToContract(d.configAddress, { kind: "inline", value: configDatum(c) }, { [unit]: 1n }).complete(); return { txHash: await submit(lucid, tx, "mintConfig"), deployment: d }; }
export async function lockClaimVault(lucid: LucidEvolution, d: Deployment, p: { beneficiary: string; expiry: bigint; value: bigint }): Promise<{ txHash: string; ref: OutRef }> { const sponsor = keyHash(await lucid.wallet().address()); const txHash = await submit(lucid, await lucid.newTx().pay.ToContract(d.claimAddress, { kind: "inline", value: claimDatum({ beneficiary: p.beneficiary, expiry: p.expiry, sponsor }) }, { lovelace: p.value }).complete(), "lockClaimVault"); const u = (await lucid.utxosAt(d.claimAddress)).find((x) => x.txHash === txHash); if (!u) throw new Error("claim vault output not indexed"); return { txHash, ref: { txHash, outputIndex: u.outputIndex } }; }
export async function claim(lucid: LucidEvolution, d: Deployment, ref: OutRef, beneficiary: string, expiry: bigint): Promise<string> { const u = await out(lucid, ref); const tx = await lucid.newTx().collectFrom([u], Data.to(new Constr(0, []))).attach.SpendingValidator(claimVaultScript()).pay.ToAddressWithData(beneficiary, { kind: "inline", value: Data.to(refData(ref)) }, u.assets).validTo(Number(expiry - 1n)).complete(); return submit(lucid, tx, "claim"); }
export async function forfeit(lucid: LucidEvolution, d: Deployment, ref: OutRef, sponsorAddress: string, expiry: bigint): Promise<string> { const u = await out(lucid, ref); const tx = await lucid.newTx().collectFrom([u], Data.to(new Constr(1, []))).attach.SpendingValidator(claimVaultScript()).pay.ToAddressWithData(sponsorAddress, { kind: "inline", value: Data.to(refData(ref)) }, u.assets).validFrom(Number(expiry)).addSignerKey(keyHash(sponsorAddress)).complete(); return submit(lucid, tx, "forfeit"); }
export async function claimVaultDetails(lucid: LucidEvolution, d: Deployment, ref: OutRef): Promise<{ expiry: bigint }> {
  const u = await out(lucid, ref);
  if (u.address !== d.claimAddress) throw new Error("task_ref is not at the claim-vault script address");
  const datum = Data.from(u.datum ?? "") as Constr<any>;
  if (datum.index !== 0 || datum.fields.length !== 3) throw new Error("task_ref does not contain a claim-vault datum");
  return { expiry: BigInt(datum.fields[1] as bigint) };
}

export async function lockCoverage(lucid: LucidEvolution, d: Deployment, p: { buyer: string; payout: bigint; termsHash: string; taskRef: OutRef; taskExpiry: bigint; decideBy: bigint; config: Config; value: bigint }): Promise<{ txHash: string; ref: OutRef }> {
  const underwriter = await lucid.wallet().address();
  const task = await claimVaultDetails(lucid, d, p.taskRef);
  if (task.expiry !== p.taskExpiry) throw new Error("coverage task_expiry does not match claim vault");
  if (p.taskExpiry <= BigInt(Date.now()) + 60_000n) throw new Error("claim-vault expiry is not in the future");
  if (p.decideBy < p.taskExpiry + 1_800_000n) throw new Error("coverage decide_by must be at least 30 minutes after task expiry");
  if (p.payout > p.value - 2_000_000n) throw new Error("coverage payout exceeds collateral headroom");
  const txHash = await submit(lucid, await lucid.newTx().pay.ToContract(d.coverageAddress, { kind: "inline", value: coverageDatum({ termsHash: p.termsHash, buyer: p.buyer, underwriter, payout: p.payout, taskRef: p.taskRef, taskExpiry: p.taskExpiry, decideBy: p.decideBy, configDigest: configDigest(p.config) }) }, { lovelace: p.value }).complete(), "lockCoverage");
  const u = (await lucid.utxosAt(d.coverageAddress)).find((x) => x.txHash === txHash); if (!u) throw new Error("coverage output not indexed"); return { txHash, ref: { txHash, outputIndex: u.outputIndex } };
}
// The validator takes each signature as the full 65 bytes (r, s, recovery) and verifies the first 64 against the supplied public key.
export function settleProof(r: Report, f: bigint): { raw: string; context: string; sigs: string[]; pubkeys: string[] } { const raw = bytes(r.raw_report), context = bytes(r.report_context), digest = keccak_256(new Uint8Array([...keccak_256(raw), ...context])); const sigs: string[] = [], pubkeys: string[] = [], seen = new Set<string>(); for (const encoded of r.sigs) { const s = bytes(encoded); if (s.length !== 65) continue; const recovery = s[64] >= 27 ? s[64] - 27 : s[64]; if (recovery > 1) continue; const pub = secp256k1.Signature.fromBytes(s.slice(0, 64), "compact").addRecoveryBit(recovery).recoverPublicKey(digest).toBytes(false).slice(1); const address = hex(keccak_256(pub).slice(12)); if (seen.has(address)) continue; seen.add(address); sigs.push(hex(s)); pubkeys.push(hex(pub)); if (sigs.length >= Number(f) + 1) break; } if (sigs.length < Number(f) + 1) throw new Error("CRE report has fewer than f+1 usable signatures"); return { raw: r.raw_report, context: r.report_context, sigs, pubkeys }; }
export async function settle(lucid: LucidEvolution, d: Deployment, ref: OutRef, report: Report, config: Config, buyerAddress: string, underwriterAddress: string): Promise<string> {
  const u = await out(lucid, ref), cfg = await configInput(lucid, d), p = settleProof(report, config.f);
  if (bytes(report.raw_report).length !== 210 || ![64, 96].includes(bytes(report.report_context).length)) throw new Error("CRE report must contain a 210-byte raw report and a 64- or 96-byte context");
  const raw = bytes(report.raw_report), decision = Number(raw[141]);
  if (![0, 1].includes(decision)) throw new Error(`invalid CRE decision ${decision}`);
  const datum = Data.from(u.datum ?? "") as Constr<any>, taskData = datum.fields[4] as Constr<any>, taskRef = { txHash: taskData.fields[0] as string, outputIndex: Number(taskData.fields[1] as bigint) }, taskUtxo = await out(lucid, taskRef);
  const taskExpiry = BigInt(datum.fields[5] as bigint), decideBy = BigInt(datum.fields[6] as bigint), amount = BigInt(datum.fields[3] as bigint);
  if (amount > u.assets.lovelace - 2_000_000n) throw new Error("coverage payout exceeds collateral headroom");
  const underwriterAssets = { ...u.assets, lovelace: u.assets.lovelace - amount };
  const tx0 = lucid.newTx().readFrom([cfg, taskUtxo]).collectFrom([u], Data.to(new Constr(0, [p.raw, p.context, p.sigs, p.pubkeys]))).attach.SpendingValidator(coverageScript(d.configPolicyId)).validFrom(Number(taskExpiry)).validTo(Number(decideBy));
  let tx: any = tx0;
  if (decision === 1) tx = tx.pay.ToAddressWithData(buyerAddress, { kind: "inline", value: Data.to(refData(ref)) }, { lovelace: amount }).pay.ToAddressWithData(underwriterAddress, { kind: "inline", value: Data.to(refData(ref)) }, underwriterAssets);
  else tx = tx.pay.ToAddressWithData(underwriterAddress, { kind: "inline", value: Data.to(refData(ref)) }, u.assets);
  return submit(lucid, await tx.complete(), "settle");
}
export async function expire(lucid: LucidEvolution, d: Deployment, ref: OutRef, underwriterAddress: string, decideBy: bigint): Promise<string> { const u = await out(lucid, ref), cfg = await configInput(lucid, d); const tx = await lucid.newTx().readFrom([cfg]).collectFrom([u], Data.to(new Constr(1, []))).attach.SpendingValidator(coverageScript(d.configPolicyId)).pay.ToAddressWithData(underwriterAddress, { kind: "inline", value: Data.to(refData(ref)) }, u.assets).validFrom(Number(decideBy)).addSignerKey(keyHash(underwriterAddress)).complete(); return submit(lucid, tx, "expire"); }
export async function assertCoverage(lucid: LucidEvolution, d: Deployment, ref: OutRef, expected: { buyer: string; taskRef: OutRef; taskExpiry: bigint; config: Config }): Promise<void> { const u = await out(lucid, ref), datum = Data.from(u.datum ?? "") as Constr<any>, buyerData = addressData(expected.buyer), underwriterData = datum.fields[2] as Constr<any>; if (Data.to(datum.fields[1]) !== Data.to(buyerData) || underwriterData.index !== 0 || (underwriterData.fields[0] as Constr<any>).index !== 0) throw new Error("coverage buyer or underwriter must be a key address"); if (BigInt(datum.fields[5] as bigint) !== expected.taskExpiry) throw new Error("coverage task_expiry does not match claim vault"); const task = datum.fields[4] as Constr<any>; if (task.fields[0] !== expected.taskRef.txHash || BigInt(task.fields[1] as bigint) !== BigInt(expected.taskRef.outputIndex)) throw new Error("coverage task_ref does not match claim vault"); if (BigInt(datum.fields[6] as bigint) <= expected.taskExpiry + 1_800_000n) throw new Error("coverage decide_by is too close to task expiry"); if (BigInt(datum.fields[3] as bigint) > u.assets.lovelace - 2_000_000n) throw new Error("coverage payout exceeds collateral headroom"); const cfg = await configInput(lucid, d); const c = Data.from(cfg.datum ?? "") as Constr<any>; const live: Config = { signers: c.fields[0] as string[], f: c.fields[1] as bigint, workflowOwner: c.fields[2] as string, workflowName: c.fields[3] as string, workflowCid: c.fields[4] as string, donConfigDigest: c.fields[5] as string, claimVaultHash: c.fields[6] as string }; if (datum.fields[7] !== configDigest(live)) throw new Error("coverage config_digest does not match current config NFT"); }
export async function waitForOutput(lucid: LucidEvolution, address: string, ref: OutRef, timeoutMs = 90_000): Promise<UTxO> { const end = Date.now() + timeoutMs; while (Date.now() < end) { const u = (await lucid.utxosAt(address)).find((x) => x.txHash === ref.txHash && x.outputIndex === ref.outputIndex); if (u) return u; await new Promise((resolve) => setTimeout(resolve, 3000)); } throw new Error(`output ${ref.txHash}#${ref.outputIndex} not visible`); }
export { makeLucid, keyHash, addressData };
