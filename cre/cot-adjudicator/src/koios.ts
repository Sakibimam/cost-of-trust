import { decodePlutusData, bytes, integer, hex, type PlutusData } from "./cbor";
import type { AdjudicationFacts } from "./decide";

export type Ref = { txHash: string; index: number };
export type Post = (path: string, body: unknown) => { statusCode: number; body: Uint8Array };
const json = <T>(post: Post, path: string, body: unknown): T => { const response = post(path, body); if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`Koios ${path} returned ${response.statusCode}`); return JSON.parse(new TextDecoder().decode(response.body)) as T; };
const ref = (d: PlutusData): Ref => { if (d.kind !== "constr" || d.fields.length !== 2) throw new Error("invalid output reference"); return { txHash: hex(d.fields[0], "reference hash"), index: integer(d.fields[1], "reference index") }; };
const addressCredential = (d: PlutusData): string => { if (d.kind !== "constr" || d.fields.length < 1 || d.fields[0].kind !== "constr") throw new Error("invalid address"); return hex(d.fields[0].fields[0], "beneficiary credential"); };
export type CoverageDatum = { termsHash: string; taskRef: Ref; decideBy: number; lockTime: number };
export type ClaimDatum = { beneficiary: string; expiry: number };
export function parseCoverageDatum(cbor: string): CoverageDatum { const d = decodePlutusData(cbor); if (d.kind !== "constr" || d.fields.length < 7) throw new Error("invalid coverage datum"); return { termsHash: hex(d.fields[0], "terms_hash"), taskRef: ref(d.fields[4]), decideBy: integer(d.fields[5], "decide_by"), lockTime: 0 }; }
export function parseClaimDatum(cbor: string): ClaimDatum { const d = decodePlutusData(cbor); if (d.kind !== "constr" || d.fields.length < 2) throw new Error("invalid claim datum"); return { beneficiary: addressCredential(d.fields[0]), expiry: integer(d.fields[1], "expiry") }; }
type Tx = { tx_hash?: string; block_time?: number; inputs?: Array<{ tx_hash: string; tx_index: number; spending_tx_hash?: string }>; outputs?: Array<{ tx_index?: number; payment_addr?: { bech32?: string }; address?: string }> };
const tx = (post: Post, txHash: string, inputs: boolean) => json<Tx[]>(post, "tx_info", { _tx_hashes: [txHash], _inputs: inputs, _metadata: true, _assets: false, _withdrawals: false, _certs: true, _scripts: true, _bytecode: true })[0] ?? (() => { throw new Error(`transaction ${txHash} not found`); })();
const output = (post: Post, r: Ref) => { const row = tx(post, r.txHash, false); const out = row.outputs?.find((o) => o.tx_index === r.index) as any; if (!out?.inline_datum?.bytes) throw new Error(`${r.txHash}#${r.index} has no inline datum`); return { datum: out.inline_datum.bytes as string, blockTime: Number(row.block_time ?? 0) * 1000 }; };
export function readFacts(post: Post, coverageRef: Ref, taskRef: Ref, termsHash: string, now: number): { facts: AdjudicationFacts; coverageTxHash: string; coverageIndex: number; termsHash: string } {
  const coverageOutput = output(post, coverageRef); const claimOutput = output(post, taskRef); const coverage = parseCoverageDatum(coverageOutput.datum); const claim = parseClaimDatum(claimOutput.datum);
  if (coverage.taskRef.txHash !== taskRef.txHash || coverage.taskRef.index !== taskRef.index) throw new Error("coverage task reference mismatch");
  if (coverage.termsHash !== termsHash) throw new Error("terms hash mismatch");
  const original = tx(post, taskRef.txHash, true); const input = original.inputs?.find((i) => i.tx_hash === taskRef.txHash && i.tx_index === taskRef.index); const spendingTxHash = input?.spending_tx_hash;
  const spending = spendingTxHash ? tx(post, spendingTxHash, true) : undefined;
  const spend = spending && spendingTxHash ? { txHash: spendingTxHash, blockTime: Number(spending.block_time ?? 0) * 1000, paysBeneficiary: Boolean(spending.outputs?.some((o) => (o.payment_addr?.bech32 ?? o.address) === claim.beneficiary)), signedBySponsor: false, kind: "other" as const } : undefined;
  const tipRows = json<Array<{ block_time: number }>>(post, "tip", {}); const blocksInWindow = tipRows[0] && Number(tipRows[0].block_time) * 1000 >= coverageOutput.blockTime ? 1 : 0;
  return { facts: { coverageLockTime: coverageOutput.blockTime, decideBy: coverage.decideBy, expiry: claim.expiry, now, blocksInWindow, spend }, coverageTxHash: coverageRef.txHash, coverageIndex: coverageRef.index, termsHash: coverage.termsHash };
}
