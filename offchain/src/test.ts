import { strict as assert } from "node:assert";
import { test } from "bun:test";
import { canonicalJson, termsHash } from "./index";
test("canonical JSON sorts object keys", () => assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}'));
test("terms hash is deterministic", () => assert.equal(termsHash({ a: 1 }), termsHash({ a: 1 })));
