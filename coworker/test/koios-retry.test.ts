import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "../src/koios.ts";

test("Koios 429 is retried after retry-after, then the body is returned", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls < 3
      ? new Response("rate limited", { status: 429, headers: { "retry-after": "0.01" } })
      : new Response(JSON.stringify([{ tx_hash: "ab" }]), { status: 200 });
  }) as typeof fetch;
  try {
    assert.deepEqual(await request("/tx_info", { method: "POST", body: "{}" }), [{ tx_hash: "ab" }]);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = real; }
});
