// Full, uncapped escrow history for every mainnet registry agent that advertises an API URL.
// One pass per payment contract: every contract tx is fetched once and tallied for all agents.
// Output: web/src/data/escrow-index.json, merged with a live scan by deliveryHistory.
//   set -a; source <env file with KAIOS_KEY>; set +a; node --import tsx scripts/escrow-index.ts
import { writeFile } from "node:fs/promises";
import { env, loadEnv } from "../src/config.ts";
import { contracts, decodePaymentCredential, policies, post, request, tallyDelivery, toIndexed, type DeliveryTally, type EscrowIndex, type TxInfo } from "../src/koios.ts";

loadEnv();
if (!env("KAIOS_KEY")) throw new Error("KAIOS_KEY is not set");

const NETWORK = "Mainnet" as const;
const PAGE = 1000;
const CHUNK = 50;
const CONCURRENCY = Number(env("INDEX_CONCURRENCY", "4"));
const OUT = new URL("../../web/src/data/escrow-index.json", import.meta.url);

type Row = Record<string, any>;
type Agent = { unit: string; name: string; apiBase: string; mintTx: string; sellers: Set<string>; registeredAtBlock: number; tally: DeliveryTally };

const log = (message: string) => console.error(`[escrow-index ${new Date().toISOString()}] ${message}`);
const asText = (value: unknown) => (Array.isArray(value) ? value.join("") : String(value ?? ""));

async function retry<T>(label: string, work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await work(); } catch (error) {
      if (attempt >= 4) throw new Error(`${label}: ${error instanceof Error ? error.message : error}`);
      await new Promise((resolve) => setTimeout(resolve, 1_500 * 2 ** attempt));
    }
  }
}

async function pool<T, R>(items: T[], work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await work(items[index], index); }
  }));
  return results;
}

async function discoverAgents(): Promise<Agent[]> {
  const agents: Agent[] = [];
  for (const policy of policies(NETWORK)) {
    const listed: Row[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await retry("policy_asset_list", () => request(`/policy_asset_list?_asset_policy=${policy}&limit=${PAGE}&offset=${offset}`, {}, NETWORK)) as Row[];
      listed.push(...page);
      if (page.length < PAGE) break;
    }
    const batches: Row[][] = [];
    for (let i = 0; i < listed.length; i += 10) batches.push(listed.slice(i, i + 10));
    const infos = await pool(batches, (batch) => retry("asset_info", () => post("/asset_info", { _asset_list: batch.map((asset) => [policy, asset.asset_name]) }, NETWORK)) as Promise<Row[]>);
    for (const row of infos.flat()) {
      const meta = row.minting_tx_metadata?.["721"]?.[policy]?.[row.asset_name];
      const apiBase = meta ? asText(meta.api_base_url).replace(/\/$/, "") : "";
      if (!apiBase) continue;
      agents.push({ unit: policy + row.asset_name, name: asText(meta.name), apiBase, mintTx: row.minting_tx_hash, sellers: new Set(), registeredAtBlock: 0, tally: { escrowsOpened: 0, resultsSubmitted: 0, paid: 0, refunded: 0, disputed: 0, events: [] } });
    }
    log(`policy ${policy.slice(0, 8)}: ${listed.length} registry assets`);
  }
  await pool(agents, async (agent) => {
    const holders = await retry("asset_addresses", () => request(`/asset_addresses?_asset_policy=${agent.unit.slice(0, 56)}&_asset_name=${agent.unit.slice(56)}`, {}, NETWORK)) as Row[];
    for (const holder of holders) { const cred = decodePaymentCredential(String(holder.payment_address ?? "")); if (cred) agent.sellers.add(cred); }
  });
  const mintTxs = [...new Set(agents.map((agent) => agent.mintTx))];
  const blocks = new Map<string, number>();
  for (let i = 0; i < mintTxs.length; i += CHUNK) {
    const rows = await retry("mint tx_info", () => post("/tx_info", { _tx_hashes: mintTxs.slice(i, i + CHUNK), _inputs: false, _metadata: false, _assets: false, _withdrawals: false, _certs: false, _scripts: false, _bytecode: false }, NETWORK)) as Row[];
    for (const row of rows) blocks.set(row.tx_hash, Number(row.block_height ?? 0));
  }
  for (const agent of agents) agent.registeredAtBlock = blocks.get(agent.mintTx) ?? 0;
  return agents;
}

async function main() {
  const generatedAt = new Date().toISOString();
  const [tip] = await retry("tip", () => request("/tip", {}, NETWORK)) as Row[];
  const scannedThroughBlock = Number(tip.block_no);
  if (!Number.isFinite(scannedThroughBlock) || scannedThroughBlock <= 0) throw new Error("tip has no block_no");
  const agents = await discoverAgents();
  if (!agents.length) throw new Error("registry returned no agents with an API URL");
  log(`tip block ${scannedThroughBlock}, ${agents.length} agents with an API URL`);
  const firstBlock = Math.min(...agents.map((agent) => agent.registeredAtBlock));

  for (const contract of contracts(NETWORK)) {
    const hashes = new Set<string>();
    for (let offset = 0; ; offset += PAGE) {
      const page = await retry("address_txs", () => post(`/address_txs?offset=${offset}&limit=${PAGE}`, { _addresses: [contract], _after_block_height: firstBlock }, NETWORK)) as Row[];
      for (const row of page) if (Number(row.block_height) <= scannedThroughBlock) hashes.add(row.tx_hash);
      if (page.length < PAGE) break;
    }
    const all = [...hashes];
    log(`contract ${contract.slice(0, 12)}: ${all.length} txs up to block ${scannedThroughBlock}`);
    const chunks: string[][] = [];
    for (let i = 0; i < all.length; i += CHUNK) chunks.push(all.slice(i, i + CHUNK));
    let done = 0;
    let fetched = 0;
    await pool(chunks, async (chunk) => {
      const txs = await retry("tx_info", () => post("/tx_info", { _tx_hashes: chunk, _inputs: true, _metadata: false, _assets: false, _withdrawals: false, _certs: false, _scripts: true, _bytecode: false }, NETWORK)) as TxInfo[];
      fetched += txs.length;
      for (const agent of agents) {
        const mine = txs.filter((tx) => Number(tx.block_height ?? 0) >= agent.registeredAtBlock);
        if (mine.length) tallyDelivery(mine, agent.sellers, agent.unit, contract, agent.tally);
      }
      if (++done % 50 === 0) log(`contract ${contract.slice(0, 12)}: ${done}/${chunks.length} chunks`);
    });
    if (fetched !== all.length) throw new Error(`tx_info returned ${fetched} of ${all.length} txs for ${contract}`);
  }

  const out: EscrowIndex = { network: NETWORK, generatedAt, agents: {} };
  for (const agent of [...agents].sort((a, b) => a.unit.localeCompare(b.unit))) {
    agent.tally.buyers?.sort();
    out.agents[agent.unit] = toIndexed(agent.tally, scannedThroughBlock, generatedAt);
  }
  await writeFile(OUT, JSON.stringify(out));
  const knight = out.agents["ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9f72c4fd88720ace11d813fd94dc27c74034d951f8b27dbc7b871e6a048cbf495"];
  const dpa = out.agents["ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b90400955cf54fddbcf102f572621b97268ab645f8f99d56f0780e98d2187865ab"];
  log(`wrote ${Object.keys(out.agents).length} agents through block ${scannedThroughBlock}`);
  log(`Knight ${JSON.stringify({ paid: knight?.paid, refunded: knight?.refunded, disputed: knight?.disputed })}`);
  log(`dpa ${JSON.stringify({ paid: dpa?.paid, refunded: dpa?.refunded, disputed: dpa?.disputed })}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
