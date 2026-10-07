// Verifies every transaction hash shown in the deck against Koios.
// 1. proofs.json is the only registry of hashes the slides render.
// 2. Every 64-hex string found in the deck sources must be registered there.
// 3. Every registered hash must report num_confirmations >= 1 on preprod.
// Usage: node web/src/app/deck/verify-proofs.mjs   (exit 1 on any unregistered or unconfirmed hash)
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const proofs = JSON.parse(readFileSync(path.join(dir, "proofs.json"), "utf8"));
const registered = new Map(Object.entries(proofs.txs).map(([id, t]) => [t.txHash, id]));
const HEX64 = /(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;

const scanned = readdirSync(dir).filter((f) => /\.(tsx?|css|json|html)$/.test(f) && !["slider.json", "registry-capabilities.json", "run-timeline.json", "verify-proofs.mjs"].includes(f));
const problems = [];
for (const f of scanned) {
  for (const h of readFileSync(path.join(dir, f), "utf8").match(HEX64) ?? []) {
    if (!registered.has(h.toLowerCase())) problems.push(`${f}: unregistered 64-hex string ${h}`);
  }
}

const hashes = [...registered.keys()];
if (hashes.length < 8) problems.push(`only ${hashes.length} hashes registered; refusing to pass on a near-empty set`);
const res = await fetch(proofs.koios, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ _tx_hashes: hashes }) });
if (!res.ok) { console.error(`koios ${proofs.koios} answered HTTP ${res.status}`); process.exit(2); }
const rows = await res.json();
const conf = new Map(rows.map((r) => [r.tx_hash, r.num_confirmations]));
for (const h of hashes) {
  const n = conf.get(h);
  const ok = typeof n === "number" && n >= 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${registered.get(h).padEnd(18)} ${h.slice(0, 10)}..${h.slice(-6)} confirmations=${n ?? "unknown"}`);
  if (!ok) problems.push(`${registered.get(h)} ${h} is not confirmed on ${proofs.network}`);
}
console.log(`checked ${hashes.length} hashes on ${proofs.network} via ${proofs.koios}; scanned ${scanned.join(", ")}`);
if (problems.length) { console.error(problems.map((p) => `PROBLEM ${p}`).join("\n")); process.exit(1); }
console.log("all deck transaction hashes confirmed");
