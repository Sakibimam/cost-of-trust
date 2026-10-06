import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createReport } from "../src/report.ts";
import { registryFromChain } from "../src/koios.ts";

test("report rejects missing identifier and negative risk", async () => {
  await assert.rejects(() => createReport({ agentIdentifier: "", taskValueAtRiskAda: 1 }));
  await assert.rejects(() => createReport({ agentIdentifier: "x", taskValueAtRiskAda: -1 }));
});

test("registry reads a recorded Masumi unit with POST asset_info", async () => {
  const recorded = JSON.parse(await readFile(new URL("./fixtures/trust-check-asset-info.json", import.meta.url), "utf8"));
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body?: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: init?.body?.toString() });
    assert.equal(String(input), "https://preprod.koios.rest/api/v1/asset_info");
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify(recorded), { status: 200 });
  };
  try {
    const evidence = await registryFromChain("67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b101b443d8a410f64eb02369ab743ce57e0dcafc68a4c64ded88bab415e000000");
    assert.equal(evidence.status, "ok");
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), {
      _asset_policy: "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b",
      _asset_name: "101b443d8a410f64eb02369ab743ce57e0dcafc68a4c64ded88bab415e000000",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
