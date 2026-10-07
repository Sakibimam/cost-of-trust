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

test("A retry-after of hours is capped so a spent quota cannot freeze the worker", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls < 2
      ? new Response("quota spent", { status: 429, headers: { "retry-after": "86400" } })
      : new Response(JSON.stringify([{ tx_hash: "cd" }]), { status: 200 });
  }) as typeof fetch;
  const started = Date.now();
  try {
    assert.deepEqual(await request("/tx_info", { method: "POST", body: "{}" }), [{ tx_hash: "cd" }]);
    assert.ok(Date.now() - started < 6_000);
  } finally { globalThis.fetch = real; }
});
