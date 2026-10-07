import { decodePlutusData, integer, hex, plutusFromJson, requiredSigners, type PlutusData } from "./cbor";
import type { AdjudicationFacts } from "./decide";

export type Ref = { txHash: string; index: number };
export type Post = (path: string, body: unknown) => { statusCode: number; body: Uint8Array };
const json = <T>(post: Post, path: string, body: unknown): T => {
  const response = post(path, body);
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`Koios ${path} returned ${response.statusCode}`);
  return JSON.parse(new TextDecoder().decode(response.body)) as T;
};

const ref = (d: PlutusData): Ref => {
  if (d.kind !== "constr" || d.fields.length !== 2) throw new Error("invalid output reference");
  return { txHash: hex(d.fields[0], "reference hash"), index: integer(d.fields[1], "reference index") };
};
const addressCredential = (d: PlutusData): string => {
  if (d.kind !== "constr" || d.fields.length < 1 || d.fields[0].kind !== "constr") throw new Error("invalid address");
  return hex(d.fields[0].fields[0], "beneficiary credential");
};

export type CoverageDatum = { termsHash: string; taskRef: Ref; taskExpiry: number; decideBy: number };
// ClaimDatum { beneficiary: Address, expiry: Int, sponsor: ByteArray }, onchain/lib/cot/model.ak.
export type ClaimDatum = { beneficiary: string; expiry: number; sponsor: string };
export function parseCoverageDatum(d: PlutusData): CoverageDatum {
  if (d.kind !== "constr" || d.fields.length < 8) throw new Error("invalid coverage datum");
  return { termsHash: hex(d.fields[0], "terms_hash"), taskRef: ref(d.fields[4]), taskExpiry: integer(d.fields[5], "task_expiry"), decideBy: integer(d.fields[6], "decide_by") };
}
export function parseClaimDatum(d: PlutusData): ClaimDatum {
  if (d.kind !== "constr" || d.fields.length < 3) throw new Error("invalid claim datum");
  return { beneficiary: addressCredential(d.fields[0]), expiry: integer(d.fields[1], "expiry"), sponsor: hex(d.fields[2], "sponsor") };
}

// Koios renders an inline datum as cbor hex (`bytes`) and always as JSON (`value`); `bytes` is null on some rows.
type InlineDatum = { bytes?: string | null; value?: unknown } | null | undefined;
export const datumOf = (datum: InlineDatum): PlutusData => {
  if (datum?.bytes) return decodePlutusData(datum.bytes);
  if (datum?.value) return plutusFromJson(datum.value);
  throw new Error("output has no inline datum");
};

type UtxoRow = { is_spent: boolean; block_time: number; block_height: number; payment_cred: string; inline_datum?: InlineDatum };
export const utxo = (post: Post, r: Ref): UtxoRow => {
  const row = json<UtxoRow[]>(post, "utxo_info", { _utxo_refs: [`${r.txHash}#${r.index}`], _extended: true })[0];
  if (!row) throw new Error(`${r.txHash}#${r.index} not found`);
  return row;
};

type TxOutput = { payment_addr?: { cred?: string } | null; inline_datum?: InlineDatum };
type TxInfo = {
  tx_hash: string;
  tx_timestamp: number;
  inputs?: Array<{ tx_hash: string; tx_index: number }>;
  outputs?: TxOutput[];
  plutus_contracts?: Array<{
    script_hash: string;
    valid_contract: boolean;
    spends_input?: { tx_hash: string; tx_index: number };
    input?: { redeemer?: { purpose?: string; datum?: { value?: { constructor?: number } } } };
  }>;
};

// claim_vault redeemer constructors in onchain/lib/cot/model.ak: Claim 0, Forfeit 1.
export type Redeemers = { claim: number; forfeit: number };
export const CLAIM_VAULT_REDEEMERS: Redeemers = { claim: 0, forfeit: 1 };

// ponytail: scans at most SCAN_PAGES * PAGE_SIZE script txs after the lock block; a busier script needs an indexer.
const PAGE_SIZE = 100;
const SCAN_PAGES = 5;
const CHUNK = 25;
const same = (a: { tx_hash: string; tx_index: number }, r: Ref) => a.tx_hash === r.txHash && a.tx_index === r.index;

// Koios has no "spent by" lookup: list the script's txs from the lock block on, take the one that has the vault as an input.
function findSpender(post: Post, vault: Ref, row: UtxoRow, spendTxHash?: string): TxInfo {
  if (spendTxHash) {
    const direct = json<TxInfo[]>(post, "tx_info", { _tx_hashes: [spendTxHash], _inputs: true, _metadata: false, _assets: false, _withdrawals: false, _certs: false, _scripts: true })[0];
    if (direct?.inputs?.some((input) => same(input, vault))) return direct;
    throw new Error(`${spendTxHash} does not spend ${vault.txHash}#${vault.index}`);
  }
  for (let page = 0; page < SCAN_PAGES; page++) {
    const listed = json<Array<{ tx_hash: string }>>(post, `credential_txs?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, { _payment_credentials: [row.payment_cred], _after_block_height: row.block_height - 1 });
    for (let i = 0; i < listed.length; i += CHUNK) {
      const infos = json<TxInfo[]>(post, "tx_info", { _tx_hashes: listed.slice(i, i + CHUNK).map((t) => t.tx_hash), _inputs: true, _metadata: false, _assets: false, _withdrawals: false, _certs: false, _scripts: true, _bytecode: false });
      const hit = infos.find((t) => t.inputs?.some((input) => same(input, vault)) && t.plutus_contracts?.some((c) => c.valid_contract === true && c.script_hash === row.payment_cred && c.spends_input && same(c.spends_input, vault)));
      if (hit) return hit;
    }
    if (listed.length < PAGE_SIZE) break;
  }
  throw new Error(`${vault.txHash}#${vault.index} is spent but its spending transaction was not found in the scan window`);
}

// An output pays "the vault's payout" only when it carries the vault out-ref as its inline datum.
// Outputs of the spending tx are attacker-shaped, so a datum of another shape is simply "not a tag", never an error.
const taggedWith = (o: TxOutput, vault: Ref): boolean => {
  let d: PlutusData;
  try { d = datumOf(o.inline_datum); } catch { return false; }
  return d.kind === "constr" && d.index === 0 && d.fields.length === 2 && d.fields[0].kind === "bytes" && d.fields[1].kind === "int" && hex(d.fields[0], "tag") === vault.txHash && d.fields[1].value === vault.index;
};

export type VaultSpend = NonNullable<AdjudicationFacts["spend"]>;
// Classify how the vault UTxO was spent, from the spending tx's redeemer, outputs and required signers.
export function readSpend(post: Post, vault: Ref, row: UtxoRow, terms: ClaimDatum, redeemers: Redeemers = CLAIM_VAULT_REDEEMERS, spendTxHash?: string): VaultSpend {
  const tx = findSpender(post, vault, row, spendTxHash);
  const contract = tx.plutus_contracts?.find((c) => c.spends_input && same(c.spends_input, vault));
  if (!contract || contract.valid_contract !== true) throw new Error(`${tx.tx_hash} has no valid script spend of the vault`);
  if (contract.script_hash !== row.payment_cred) throw new Error(`${tx.tx_hash} spent the vault with a different script`);
  const constructor = contract.input?.redeemer?.datum?.value?.constructor;
  const kind = constructor === redeemers.claim ? "claim" : constructor === redeemers.forfeit ? "forfeit" : "other";
  const cbor = json<Array<{ tx_hash: string; cbor: string }>>(post, "tx_cbor", { _tx_hashes: [tx.tx_hash] })[0];
  if (!cbor || cbor.tx_hash !== tx.tx_hash) throw new Error(`cbor of ${tx.tx_hash} not found`);
  return {
    txHash: tx.tx_hash,
    blockTime: Number(tx.tx_timestamp) * 1000,
    kind,
    paysBeneficiary: Boolean(tx.outputs?.some((o) => o.payment_addr?.cred?.toLowerCase() === terms.beneficiary.toLowerCase() && taggedWith(o, vault))),
    signedBySponsor: requiredSigners(cbor.cbor).includes(terms.sponsor),
  };
}

// The task, its expiry and the terms come only from the coverage datum on chain. Nothing the trigger carries can steer which vault is adjudicated.
export function readFacts(post: Post, coverageRef: Ref, now: number, spendTxHash?: string, claimVaultHash?: string): { facts: AdjudicationFacts; coverageTxHash: string; coverageIndex: number; termsHash: string; taskRef: Ref } {
  const coverageRow = utxo(post, coverageRef);
  const coverage = parseCoverageDatum(datumOf(coverageRow.inline_datum));
  const taskRef = coverage.taskRef;
  const vaultRow = utxo(post, taskRef);
  if (!claimVaultHash || vaultRow.payment_cred !== claimVaultHash) throw new Error("task_ref is not a claim-vault script UTxO");
  const claim = parseClaimDatum(datumOf(vaultRow.inline_datum));
  if (claim.expiry !== coverage.taskExpiry) throw new Error("coverage task_expiry does not match the claim vault expiry");
  const spend = vaultRow.is_spent ? readSpend(post, taskRef, vaultRow, claim, CLAIM_VAULT_REDEEMERS, spendTxHash) : undefined;
  const lockTime = Number(coverageRow.block_time) * 1000;
  const tipRows = json<Array<{ block_time: number; block_height?: number }>>(post, "tip", {});
  const tipTime = Number(tipRows[0]?.block_time ?? 0) * 1000;
  const blocksInWindow = tipTime > coverage.taskExpiry + 600_000 && tipTime >= lockTime ? 1 : 0;
  return { facts: { coverageLockTime: lockTime, decideBy: coverage.decideBy, expiry: coverage.taskExpiry, now: tipTime, blocksInWindow, spend }, coverageTxHash: coverageRef.txHash, coverageIndex: coverageRef.index, termsHash: coverage.termsHash, taskRef };
}
