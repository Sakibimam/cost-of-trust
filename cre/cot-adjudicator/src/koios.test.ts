import { expect, test } from "bun:test";
import { adjudicate } from "./adjudicate";
import { datumOf, parseClaimDatum, type Post } from "./koios";

const fixture = await Bun.file(new URL("../../fixtures/koios-live.json", import.meta.url)).json() as any;
const claimRow = fixture.claimVaultAddress.utxos[0];
const claim = parseClaimDatum(datumOf(claimRow.inline_datum));
const vaultHash = fixture.spentBeforeExpiry.refs.spentVault.split("#")[0];
const coverageHash = fixture.spentBeforeExpiry.refs.coverageRef.split("#")[0];
const scriptHash = fixture.spentBeforeExpiry.refs.scriptHash;
const taskExpiry = claim.expiry;
const coverageDatum = {
  constructor: 0,
  fields: [
    { bytes: "11".repeat(32) },
    { constructor: 0, fields: [] },
    { constructor: 0, fields: [] },
    { int: 5_000_000 },
    { constructor: 0, fields: [{ bytes: vaultHash }, { int: claimRow.tx_index }] },
    { int: taskExpiry },
    { int: taskExpiry + 1_800_000 },
    { bytes: "22".repeat(32) },
  ],
};

const response = (value: unknown) => ({ statusCode: 200, body: new TextEncoder().encode(JSON.stringify(value)) });
const post: Post = (path, body: any) => {
  if (path === "tip") return response(fixture.tip);
  if (path === "tx_cbor") return response(fixture.spentBeforeExpiry.spendingTxCbor);
  if (path === "tx_info") {
    const tx = structuredClone(fixture.spentBeforeExpiry.spendingTxInfo[0]);
    const contract = tx.plutus_contracts[0];
    contract.input.redeemer.datum.value.constructor = 0;
    contract.script_hash = scriptHash;
    const payout = tx.outputs.find((o: any) => o.payment_addr?.cred === claim.beneficiary);
    payout.inline_datum = { value: { constructor: 0, fields: [{ bytes: vaultHash }, { int: claimRow.tx_index }] } };
    const invalid = structuredClone(tx);
    invalid.tx_hash = "ee".repeat(32);
    invalid.plutus_contracts[0].valid_contract = false;
    return response([invalid, tx]);
  }
  if (path.startsWith("credential_txs")) return response([{ tx_hash: fixture.spentBeforeExpiry.spendingTxInfo[0].tx_hash }]);
  if (path === "utxo_info") {
    const ref = body._utxo_refs[0];
    if (ref === `${coverageHash}#0`) return response([{ ...fixture.spentBeforeExpiry.coverageRow[0], inline_datum: { value: coverageDatum } }]);
    return response([{ ...claimRow, is_spent: true, payment_cred: scriptHash }]);
  }
  throw new Error(`unexpected Koios path ${path}`);
};

test("real claim datum and CBOR response parse, and attacker taskRef is ignored", () => {
  const result = adjudicate(post, {
    coverageRef: `${coverageHash}#0`,
    nonce: "test",
    taskRef: `${"ff".repeat(32)}#99`,
  } as any, taskExpiry - 1_000, scriptHash);
  expect(claim.sponsor).toHaveLength(56);
  expect(result.taskRef).toEqual({ txHash: vaultHash, index: 0 });
  expect(result.facts.spend?.kind).toBe("claim");
  expect(result.facts.spend?.blockTime).toBe(1_791_182_319_000);
  expect(result.facts.spend?.paysBeneficiary).toBe(true);
  expect(result.facts.spend?.signedBySponsor).toBe(false);
  expect(result.decision).toBe("SUCCESS");
});
