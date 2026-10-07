import { keccak_256 } from "@noble/hashes/sha3.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { Config, Report } from "@cost-of-trust/offchain";

const bytes = (x: string) => Uint8Array.from(Buffer.from(x, "hex"));
const hex = (x: Uint8Array) => Buffer.from(x).toString("hex");
const cat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]));
const digestOf = (raw: Uint8Array, context: Uint8Array) => keccak_256(cat(keccak_256(raw), context));

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
  if (![64, 96].includes(context.length)) return `report context is ${context.length} bytes, the validator reads 64 or 96`;
  if (hex(raw.slice(45, 77)) !== config.workflowCid || hex(raw.slice(77, 87)) !== config.workflowName || hex(raw.slice(87, 107)) !== config.workflowOwner) return "workflow cid, name or owner differ from the config NFT";
  if (hex(context.slice(0, 32)) !== config.donConfigDigest) return "report context DON digest differs from the config NFT";
  const allowed = new Set(recoverSigners(report).filter((a) => config.signers.includes(a)));
  if (allowed.size < Number(config.f) + 1) return `signatures recover to ${allowed.size} allowlisted signers, f+1 = ${Number(config.f) + 1} are required`;
}
