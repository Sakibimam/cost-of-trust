import test from "node:test";
import assert from "node:assert/strict";
import { parseTaskInput, USAGE_RESULT } from "../src/task-input.ts";

test("extracts registry assets and defaults risk", () => {
  assert.deepEqual(parseTaskInput("check asset1h6lypyuwtgjqjf9wd4wmg53pgk7gtv08nk40pn"), { agentIdentifier: "asset1h6lypyuwtgjqjf9wd4wmg53pgk7gtv08nk40pn", taskValueAtRiskAda: 100 });
  assert.deepEqual(parseTaskInput("policy 0123456789abcdef0123456789abcdef0123456789abcdef01234567"), { agentIdentifier: "0123456789abcdef0123456789abcdef0123456789abcdef01234567", taskValueAtRiskAda: 100 });
});

test("accepts JSON and returns help for unaddressed text", () => {
  assert.deepEqual(parseTaskInput('{"agentIdentifier":"asset1abc","taskValueAtRiskAda":25}'), { agentIdentifier: "asset1abc", taskValueAtRiskAda: 25 });
  assert.equal(parseTaskInput("what can you do for me?"), null);
  assert.match(USAGE_RESULT, /agent identifier/);
});
