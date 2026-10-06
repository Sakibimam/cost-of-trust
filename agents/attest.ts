import { keccak_256 } from "@noble/hashes/sha3.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { Config, Report } from "@cost-of-trust/offchain";

const ascii = (s: string) => new TextEncoder().encode(s);
const bytes = (x: string) => Uint8Array.from(Buffer.from(x, "hex"));
const hex = (x: Uint8Array) => Buffer.from(x).toString("hex");
const cat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]));
const digestOf = (raw: Uint8Array, context: Uint8Array) => keccak_256(cat(keccak_256(raw), context));

// The config NFT on preprod pins the test DON from onchain/scripts/generate_vectors.mjs: keys derived from public labels.
const testKeys = [0, 1, 2, 3].map((i) => keccak_256(ascii(`cost-of-trust test signer don-${i}`)));

export function recoverSigners(report: Report): string[] {
  const raw = bytes(report.raw_report), context = bytes(report.report_context), digest = digestOf(raw, context);
  return report.sigs.map((encoded) => {
    const sig = bytes(encoded);
    if (sig.length !== 65) return "invalid";
    const recovery = sig[64] >= 27 ? sig[64] - 27 : sig[64];
    try { return hex(keccak_256(secp256k1.Signature.fromBytes(sig.slice(0, 64), "compact").addRecoveryBit(recovery).recoverPublicKey(digest).toBytes(false).slice(1)).slice(12)); } catch { return "invalid"; }
  });
}

// Why a report cannot settle against the config NFT, or undefined when it can.
export function incompatibility(report: Report, config: Config): string | undefined {
  const raw = bytes(report.raw_report), context = bytes(report.report_context);
  if (raw.length !== 210) return `raw report is ${raw.length} bytes, the validator reads 210`;
  if (context.length !== 64) return `report context is ${context.length} bytes, the validator reads 64`;
  if (hex(raw.slice(45, 77)) !== config.workflowCid || hex(raw.slice(77, 87)) !== config.workflowName || hex(raw.slice(87, 107)) !== config.workflowOwner) return "workflow cid, name or owner differ from the config NFT";
  if (hex(context.slice(0, 32)) !== config.donConfigDigest) return "report context DON digest differs from the config NFT";
  const allowed = new Set(recoverSigners(report).filter((a) => config.signers.includes(a)));
  if (allowed.size < Number(config.f) + 1) return `signatures recover to ${allowed.size} allowlisted signers, f+1 = ${Number(config.f) + 1} are required`;
}

// Keeps the CRE workflow's decision body, execution id and report id, and re-wraps them for the test DON the config NFT pins.
export function attestWithTestDon(report: Report, config: Config): Report {
  const signers = testKeys.map((k) => hex(keccak_256(secp256k1.getPublicKey(k, false).slice(1)).slice(12)));
  if (signers.join() !== config.signers.join()) throw new Error("config NFT signers are not the test DON, cannot attest locally");
  const source = bytes(report.raw_report);
  if (source.length !== 210) throw new Error(`CRE raw report must be 210 bytes, got ${source.length}`);
  const raw = cat(source.slice(0, 45), bytes(config.workflowCid), bytes(config.workflowName), bytes(config.workflowOwner), source.slice(107, 109), source.slice(109));
  const seq = new Uint8Array(32); seq[31] = 1;
  const context = cat(bytes(config.donConfigDigest), seq);
  const digest = digestOf(raw, context);
  const sigs = testKeys.map((k) => { const s = secp256k1.sign(digest, k, { prehash: false, lowS: true, format: "recovered" }); return hex(cat(s.slice(1), Uint8Array.of(s[0] + 27))); });
  return { raw_report: hex(raw), report_context: hex(context), sigs };
}
