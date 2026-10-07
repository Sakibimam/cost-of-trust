// Reads the Masumi mainnet registry policy from Koios and counts live agents per capability tag.
// Usage: node web/src/app/deck/gen-registry.mjs   -> writes registry-capabilities.json
import { writeFileSync } from "node:fs";

const POLICY = "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9";
const K = "https://api.koios.rest/api/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (path, init) => {
  for (let t = 0; t < 6; t++) {
    const res = await fetch(`${K}${path}`, init);
    if (res.ok) return res.json();
    await sleep(1500 * (t + 1));
  }
  throw new Error(`koios ${path} failed`);
};

const tip = (await get("/tip"))[0];
const rows = [];
for (let off = 0; ; off += 1000) {
  const page = await get(`/policy_asset_list?_asset_policy=${POLICY}&limit=1000&offset=${off}`);
  rows.push(...page);
  if (page.length < 1000) break;
}
const live = rows.filter((r) => Number(r.total_supply) > 0);
const agents = [];
for (let i = 0; i < live.length; i += 20) {
  const body = JSON.stringify({ _asset_list: live.slice(i, i + 20).map((r) => [POLICY, r.asset_name]) });
  const info = await get("/asset_info", { method: "POST", headers: { "content-type": "application/json" }, body });
  for (const a of info) {
    const m = a.minting_tx_metadata?.["721"]?.[POLICY]?.[a.asset_name];
    agents.push({ name: m?.name?.join?.("") ?? null, tags: [...new Set((m?.tags ?? []).map((t) => String(t).trim().toLowerCase()))] });
  }
  await sleep(250);
}
const perTag = new Map();
for (const a of agents) for (const t of a.tags) perTag.set(t, (perTag.get(t) ?? 0) + 1);
const dist = {};
for (const n of perTag.values()) dist[n] = (dist[n] ?? 0) + 1;
const tagged = agents.filter((a) => a.tags.length).length;
const out = {
  source: `Koios mainnet policy_asset_list + asset_info, policy ${POLICY}`,
  readAtBlock: tip.block_no,
  readAtBlockTime: new Date(tip.block_time * 1000).toISOString(),
  liveAgents: agents.length,
  taggedAgents: tagged,
  tags: perTag.size,
  tagsWithOneOrTwoAgents: [...perTag.values()].filter((n) => n <= 2).length,
  tagsWithOneAgent: dist[1] ?? 0,
  agentsPerTagDistribution: dist,
};
writeFileSync(new URL("./registry-capabilities.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
