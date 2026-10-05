import { strict as assert } from "node:assert";
import { test } from "bun:test";
import { canonicalJson, configDigest, deployment, termsHash } from "./index";
test("canonical JSON sorts object keys", () => assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}'));
test("terms hash is deterministic", () => assert.equal(termsHash({ a: 1 }), termsHash({ a: 1 })));
test("config digest commits to the DON digest and rebuilt lock parameter", () => {
  const base = { signers: ["11".repeat(20), "22".repeat(20), "33".repeat(20)], f: 1n, workflowOwner: "44".repeat(20), workflowName: "55".repeat(10), workflowCid: "66".repeat(32), donConfigDigest: "77".repeat(32) };
  assert.equal(configDigest(base).length, 64);
  assert.notEqual(configDigest(base), configDigest({ ...base, donConfigDigest: "88".repeat(32) }));
  const d = deployment({ txHash: "aa".repeat(32), outputIndex: 0 });
  assert.equal(d.configAddress.includes(d.configLockHash), false);
  assert.equal(d.coverageAddress.length > 0, true);
});
