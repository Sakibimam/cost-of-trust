import { strict as assert } from "node:assert";
import { test } from "bun:test";
import { canonicalJson, configDigest, deployment, termsHash } from "./index";
import { koiosOutputToUtxo } from "./provider";
test("canonical JSON sorts object keys", () => assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}'));
test("terms hash is deterministic", () => assert.equal(termsHash({ a: 1 }), termsHash({ a: 1 })));
test("config digest commits to the DON digest and rebuilt lock parameter", () => {
  const base = { signers: ["11".repeat(20), "22".repeat(20), "33".repeat(20)], f: 1n, workflowOwner: "44".repeat(20), workflowName: "55".repeat(10), workflowCid: "66".repeat(32), donConfigDigest: "77".repeat(32), claimVaultHash: "88".repeat(28) };
  assert.equal(configDigest(base).length, 64);
  assert.notEqual(configDigest(base), configDigest({ ...base, donConfigDigest: "88".repeat(32) }));
  const d = deployment({ txHash: "aa".repeat(32), outputIndex: 0 });
  assert.equal(d.configAddress.includes(d.configLockHash), false);
  assert.equal(d.coverageAddress.length > 0, true);
});

test("Koios inline datum output carries no datum hash so scripts see the inline datum", () => {
  const inline = koiosOutputToUtxo({ tx_hash: "aa".repeat(32), tx_index: 0, payment_addr: { bech32: "addr_test1" }, value: "5000000", asset_list: [], datum_hash: "bb".repeat(32), inline_datum: { bytes: "d87980" } });
  assert.equal(inline.datum, "d87980");
  assert.equal(inline.datumHash, undefined);
  const hashed = koiosOutputToUtxo({ tx_hash: "aa".repeat(32), tx_index: 1, payment_addr: { bech32: "addr_test1" }, value: "5000000", datum_hash: "bb".repeat(32), inline_datum: null });
  assert.equal(hashed.datumHash, "bb".repeat(32));
});

test("settle proof passes full 65-byte signatures with their recovered 64-byte public keys", async () => {
  const { secp256k1 } = await import("@noble/curves/secp256k1.js");
  const { keccak_256 } = await import("@noble/hashes/sha3.js");
  const { settleProof } = await import("./index");
  const raw = new Uint8Array(210).fill(7), context = new Uint8Array(64).fill(9);
  const digest = keccak_256(new Uint8Array([...keccak_256(raw), ...context]));
  const keys = [1, 2].map((n) => keccak_256(new Uint8Array([n])));
  const sigs = keys.map((k) => { const s = secp256k1.sign(digest, k, { prehash: false, lowS: true, format: "recovered" }); return Buffer.from([...s.slice(1), s[0] + 27]).toString("hex"); });
  const p = settleProof({ raw_report: Buffer.from(raw).toString("hex"), report_context: Buffer.from(context).toString("hex"), sigs }, 1n);
  assert.deepEqual(p.sigs.map((x) => x.length / 2), [65, 65]);
  assert.deepEqual(p.pubkeys, keys.map((k) => Buffer.from(secp256k1.getPublicKey(k, false).slice(1)).toString("hex")));
});
