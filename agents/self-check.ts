import { strict as assert } from "node:assert";
import { parseRef } from "./common";

assert.deepEqual(parseRef(`${"a".repeat(64)}#2`), { txHash: "a".repeat(64), outputIndex: 2 });
assert.throws(() => parseRef("not-an-out-ref"), /out-ref/);
console.log("agents self-check passed");
