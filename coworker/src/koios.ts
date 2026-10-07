import registryNames from "./registry-names.json" with { type: "json" };
import { env, loadEnv } from "./config.ts";
import type { Evidence } from "./types.ts";
import escrowIndexFile from "../../web/src/data/escrow-index.json" with { type: "json" };

loadEnv();

export type Network = "Preprod" | "Mainnet";

export const policies = (network: Network) => network === "Mainnet"
  ? [
    env("MASUMI_REGISTRY_POLICY_V1_MAINNET", "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9"),
    env("MASUMI_REGISTRY_POLICY_V2_MAINNET", "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b"),
  ]
  : [
    env("MASUMI_REGISTRY_POLICY_V1_PREPROD", "7e8bdaf2b2b919a3a4b94002cafb50086c0c845fe535d07a77ab7f77"),
    env("MASUMI_REGISTRY_POLICY_V2_PREPROD", "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b"),
  ];

// Masumi payment (escrow) contracts, V2 then V1, from the Masumi Payment Service sources and migrations.
export const contracts = (network: Network) => network === "Mainnet"
  ? env("MASUMI_PAYMENT_CONTRACTS_MAINNET", "addr1wxs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgge2j6d,addr1wx7j4kmg2cs7yf92uat3ed4a3u97kr7axxr4avaz0lhwdsq87ujx7").split(",")
  : env("MASUMI_PAYMENT_CONTRACTS_PREPROD", "addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g,addr_test1wz7j4kmg2cs7yf92uat3ed4a3u97kr7axxr4avaz0lhwdsqukgwfm").split(",");

const koiosBase = (network: Network) => env(network === "Mainnet" ? "KOIOS_URL_MAINNET" : "KOIOS_URL_PREPROD", network === "Mainnet" ? "https://api.koios.rest/api/v1" : "https://preprod.koios.rest/api/v1");

export const request = async (path: string, init: RequestInit = {}, network: Network = "Preprod", attempt = 0): Promise<unknown> => {
  // A key whose quota is spent gets 429 on every call while anonymous access still works, so after
  // two keyed 429s the request continues without the key.
  const key = attempt >= 2 ? "" : env("KAIOS_KEY");
  const response = await fetch(`${koiosBase(network)}${path}`, {
    ...init,
    headers: { accept: "application/json", "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 429 && attempt < 4) {
    const wait = Number(response.headers.get("retry-after")) * 1000 || 2_000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, wait));
    return request(path, init, network, attempt + 1);
  }
  if (!response.ok) throw new Error(`Koios HTTP ${response.status} on ${path.split("?")[0]}`);
  return response.json();
};

export const post = (path: string, body: unknown, network: Network = "Preprod") => request(path, { method: "POST", body: JSON.stringify(body) }, network);

type Row = Record<string, unknown>;
const PAGE = 1000;

// Registry policies change slowly; listing them on every task is the call Koios rate-limits first.
const policyCache = new Map<string, { at: number; rows: Row[] }>();
const POLICY_TTL_MS = 30 * 60_000;

async function policyAssets(policy: string, network: Network): Promise<Row[]> {
  const key = `${network}:${policy}`;
  const hit = policyCache.get(key);
  if (hit && Date.now() - hit.at < POLICY_TTL_MS) return hit.rows;
  try {
    const rows: Row[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await request(`/policy_asset_list?_asset_policy=${policy}&limit=${PAGE}&offset=${offset}`, {}, network) as Row[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    policyCache.set(key, { at: Date.now(), rows });
    return rows;
  } catch (error) {
    if (hit) return hit.rows;
    throw error;
  }
}

export function decodePaymentCredential(address: string): string | null {
  const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const separator = address.lastIndexOf("1");
  if (separator < 1) return null;
  const values = address.slice(separator + 1, -6).toLowerCase().split("").map((char) => alphabet.indexOf(char));
  if (values.some((value) => value < 0)) return null;
  let acc = 0; let bits = 0; const bytes: number[] = [];
  for (const value of values) {
    acc = (acc << 5) | value; bits += 5;
    while (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); }
  }
  return bytes.length >= 29 ? Buffer.from(bytes.slice(1, 29)).toString("hex") : null;
}

function assetParts(identifier: string): { policy: string; name?: string; fingerprint?: string } | null {
  if (/^asset1[a-z0-9]+$/i.test(identifier)) return { policy: "", fingerprint: identifier };
  if (/^[0-9a-f]{112,120}$/i.test(identifier)) return { policy: identifier.slice(0, 56), name: identifier.slice(56) };
  if (/^[0-9a-f]{56}$/i.test(identifier)) return { policy: identifier };
  return null;
}

async function resolveAsset(identifier: string, network: Network): Promise<{ policy: string; name: string } | null> {
  const parts = assetParts(identifier);
  if (!parts) return null;
  if (parts.name) return { policy: parts.policy, name: parts.name };
  if (!parts.fingerprint) return null;
  for (const policy of policies(network)) {
    const match = (await policyAssets(policy, network)).find((row) => String(row.fingerprint ?? "").toLowerCase() === parts.fingerprint?.toLowerCase());
    if (match) return { policy, name: String(match.asset_name ?? "") };
  }
  return null;
}

async function assetInfo(identifier: string, network: Network): Promise<Row[]> {
  const asset = await resolveAsset(identifier, network);
  if (!asset) return [];
  return await post("/asset_info", { _asset_policy: asset.policy, _asset_name: asset.name }, network) as Row[];
}

function containsName(value: unknown, name: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsName(item, name));
  const record = value as Row;
  if (typeof record.name === "string" && record.name.toLowerCase() === name.toLowerCase()) return true;
  if (Array.isArray(record.name) && record.name.some((item) => typeof item === "string" && item.toLowerCase() === name.toLowerCase())) return true;
  return Object.values(record).some((item) => containsName(item, name));
}

export async function registryMatchesByName(name: string): Promise<Array<{ identifier: string; network: Network }>> {
  // Bundled snapshot of registry names first: listing whole registry policies per task is what Koios rate-limits.
  const known = (registryNames.names as Record<string, Array<{ identifier: string; network: Network }>>)[name.trim().toLowerCase()];
  if (known?.length) return known.map(({ identifier, network }) => ({ identifier, network }));

  const scan = async (network: Network): Promise<Array<{ identifier: string; network: Network }>> => {
    const matches: Array<{ identifier: string; network: Network }> = [];
    for (const policy of policies(network)) {
      const assets = await policyAssets(policy, network);
      for (let i = 0; i < assets.length; i += 100) {
        const batch = await Promise.all(assets.slice(i, i + 100).map(async (asset) => {
          const assetName = String(asset.asset_name ?? "");
          if (!assetName) return null;
          try {
            const info = await post("/asset_info", { _asset_policy: policy, _asset_name: assetName }, network) as Row[];
            return info.some((row) => containsName(row, name)) ? { identifier: policy + assetName, network } : null;
          } catch { return null; }
        }));
        matches.push(...batch.filter((match): match is { identifier: string; network: Network } => Boolean(match)));
      }
    }
    return matches;
  };
  return (await Promise.all((["Mainnet", "Preprod"] as const).map(scan))).flat();
}

// A task that omits the network is looked up on Preprod first, then Mainnet.
export async function detectNetwork(identifier: string): Promise<Network> {
  for (const network of ["Preprod", "Mainnet"] as const) {
    if ((await assetInfo(identifier, network)).length) return network;
  }
  return "Preprod";
}

export async function registryFromChain(identifier: string, network: Network = "Preprod"): Promise<Evidence> {
  try {
    let assets: unknown[] = await assetInfo(identifier, network);
    if (/^[0-9a-f]{56}$/i.test(identifier)) {
      const matched: unknown[] = [];
      for (const policy of policies(network)) {
        for (const asset of await policyAssets(policy, network)) {
          const name = String(asset.asset_name ?? "");
          const holders = await post("/asset_addresses", { _asset_policy: policy, _asset_name: name }, network) as Row[];
          if (holders.some((holder) => decodePaymentCredential(String(holder.payment_address ?? "")) === identifier)) matched.push({ asset, holders });
        }
      }
      assets = matched;
    }
    if (!assets.length) return { source: "registry_chain", status: "not_found", observedAt: new Date().toISOString(), data: { identifier, network, policies: policies(network) } };
    return { source: "registry_chain", status: "ok", observedAt: new Date().toISOString(), data: { identifier, network, assets } };
  } catch (error) {
    return { source: "registry_chain", status: "unavailable", observedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "Koios request failed" };
  }
}

type PlutusJson = { constructor?: number; fields?: PlutusJson[]; bytes?: string; int?: number };

// Escrow datum layouts from the Masumi vested_pay validators: V2 has 19 fields (seller at 2, agent_identifier at 8), V1 has 16 (seller at 1).
// V1 vested_pay stores submit_result_time at field 10. V2 stores it at field 13.
// A value above 1e11 is POSIX milliseconds. The caller compares it with tx_timestamp, which is seconds.
export function submitResultTimeSeconds(datum: PlutusJson | undefined): number | null {
  const fields = datum?.fields;
  if (!fields) return null;
  const slot = fields.length === 19 ? fields[13] : fields.length === 16 ? fields[10] : undefined;
  const raw = (slot as { int?: number | string } | undefined)?.int;
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" && /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : null;
  if (parsed === null || !Number.isFinite(parsed)) return null;
  return parsed > 1e11 ? parsed / 1000 : parsed;
}

export function escrowParty(datum: PlutusJson | undefined): { seller: string; buyer?: string; agent?: string; state: number } | null {
  const fields = datum?.fields;
  if (!fields || (fields.length !== 19 && fields.length !== 16)) return null;
  const sellerAt = fields.length === 19 ? 2 : 1;
  const seller = fields[sellerAt]?.fields?.[0]?.fields?.[0]?.bytes;
  const state = fields[fields.length - 1]?.constructor;
  if (!seller || state === undefined) return null;
  if (fields.length === 19) return { seller, agent: fields[8]?.bytes, state };
  // V1 (16 fields): buyer at 0, blockchainIdentifier at 4 = 32-byte hash || agent registry unit (28-byte policy + 32-byte name).
  const identifier = fields[4]?.bytes ?? "";
  const agent = identifier.length === 184 ? identifier.slice(64) : identifier.length === 120 ? identifier : undefined;
  return { seller, buyer: fields[0]?.fields?.[0]?.fields?.[0]?.bytes, agent, state };
}

// Redeemer constructors shared by V1 and V2 vested_pay: Withdraw 0, WithdrawRefund 3, WithdrawDisputed 4, SubmitResult 5.
const ACTIONS: Record<number, "paid" | "refunded" | "disputed" | "resultsSubmitted"> = { 0: "paid", 3: "refunded", 4: "disputed", 5: "resultsSubmitted" };

type TxOutput = { tx_hash?: string; tx_index?: number; payment_addr?: { bech32?: string }; inline_datum?: { value?: PlutusJson } | null };
export type TxInfo = {
  block_height?: number;
  tx_hash: string; tx_timestamp: number;
  inputs?: TxOutput[];
  outputs?: TxOutput[];
  plutus_contracts?: Array<{ valid_contract?: boolean; spends_input?: { tx_hash: string; tx_index: number } | null; input?: { redeemer?: { datum?: { value?: PlutusJson } } } }>;
};

export type DeliveryTally = { escrowsOpened: number; resultsSubmitted: number; paid: number; refunded: number; disputed: number; walletOnly?: number; buyers?: string[]; submissions?: Array<{ openTx: string; at: number }>; responseSeconds?: number[]; responseSecondsMedian?: number | null; responseSecondsP90?: number | null; ceilingByOpenTx?: Record<string, number>; ceilingSeconds?: number[]; events: Array<{ txHash: string; blockTime: number; action: string; contract: string }> };

const THIRTY_DAYS_S = 30 * 24 * 60 * 60;

function rememberCeiling(tally: DeliveryTally, openTx: string | undefined, datum: PlutusJson | undefined): void {
  const seconds = submitResultTimeSeconds(datum);
  if (!openTx || seconds === null) return;
  (tally.ceilingByOpenTx ??= {})[openTx] = seconds;
}

export function tallyDelivery(txs: TxInfo[], sellers: Set<string>, agentUnit: string, contract: string, tally: DeliveryTally): void {
  const ours = (datum: PlutusJson | undefined) => {
    const party = escrowParty(datum);
    // The datum names the agent when it can, so a selling wallet shared by several registry agents does not merge their histories.
    if (!party) return null;
    return (party.agent ? party.agent === agentUnit : sellers.has(party.seller)) ? party : null;
  };
  for (const tx of txs) {
    let spentOurs = false;
    for (const spend of tx.plutus_contracts ?? []) {
      // Koios leaves the script datum off plutus_contracts; the spent escrow comes from the matching input.
      const spent = tx.inputs?.find((input) => input.tx_hash === spend.spends_input?.tx_hash && input.tx_index === spend.spends_input?.tx_index);
      if (spend.valid_contract === false || spent?.payment_addr?.bech32 !== contract || !ours(spent.inline_datum?.value)) continue;
      spentOurs = true;
      const action = ACTIONS[spend.input?.redeemer?.datum?.value?.constructor ?? -1];
      if (!action) continue;
      tally[action] += 1;
      const party = escrowParty(spent.inline_datum?.value);
      if (action === "resultsSubmitted" && spend.spends_input?.tx_hash) (tally.submissions ??= []).push({ openTx: spend.spends_input.tx_hash, at: tx.tx_timestamp });
      rememberCeiling(tally, spend.spends_input?.tx_hash, spent.inline_datum?.value);
      // V1 escrow datums carry no agent identifier, so the outcome belongs to the selling wallet, which several registry agents can share.
      if (action !== "resultsSubmitted" && escrowParty(spent.inline_datum?.value)?.agent === undefined) tally.walletOnly = (tally.walletOnly ?? 0) + 1;
      tally.events.push({ txHash: tx.tx_hash, blockTime: tx.tx_timestamp, action, contract });
    }
    if (spentOurs) continue;
    for (const output of tx.outputs ?? []) {
      const party = output.payment_addr?.bech32 === contract ? ours(output.inline_datum?.value) : null;
      if (party?.state !== 0) continue;
      tally.escrowsOpened += 1;
      rememberCeiling(tally, tx.tx_hash, output.inline_datum?.value);
      if (party.buyer && !(tally.buyers ??= []).includes(party.buyer)) tally.buyers.push(party.buyer);
      tally.events.push({ txHash: tx.tx_hash, blockTime: tx.tx_timestamp, action: "escrowOpened", contract });
    }
  }
}

// Full escrow history up to a block is precomputed by scripts/escrow-index.ts with no scan cap.
// deliveryHistory reads that snapshot and live-scans only the txs after it, so the result is
// complete and still fast.
export type Wait = { at: number; seconds: number };
export type IndexedAgent = {
  paid: number; refunded: number; disputed: number; resultsSubmitted: number; escrowsOpened: number; walletOnly: number;
  buyers: string[]; responseSecondsMedian: number | null; responseSecondsP90: number | null; ceilingSeconds?: number[]; lastTxTime: number | null;
  scannedThroughBlock: number; generatedAt: string;
  waits: Wait[]; openPending: Record<string, number>; events: DeliveryTally["events"];
};
export type EscrowIndex = { network: "Mainnet"; generatedAt: string | null; agents: Record<string, IndexedAgent> };

let escrowIndex = escrowIndexFile as unknown as EscrowIndex;
export function setEscrowIndexForTests(next: EscrowIndex | undefined) { escrowIndex = next ?? (escrowIndexFile as unknown as EscrowIndex); }

const WAITS_KEPT = 200;
const PENDING_KEPT = 100;

// Sorts events, derives response times (opening tx known from this tally or carried over in
// priorOpens) and returns the data the index must carry forward to merge later txs.
export function finishTally(tally: DeliveryTally, priorOpens: Record<string, number> = {}, priorWaits: Wait[] = [], priorCeilings: number[] = []): { waits: Wait[]; openPending: Record<string, number> } {
  tally.events.sort((a, b) => b.blockTime - a.blockTime);
  const opened = new Map<string, number>(Object.entries(priorOpens));
  for (const event of tally.events) if (event.action === "escrowOpened") opened.set(event.txHash, event.blockTime);
  const slacks: number[] = [];
  for (const [openTx, ceilingAt] of Object.entries(tally.ceilingByOpenTx ?? {})) {
    const openedAt = opened.get(openTx);
    if (openedAt === undefined) continue;
    const slack = ceilingAt - openedAt;
    if (slack > 0 && slack < THIRTY_DAYS_S) slacks.push(slack);
  }
  tally.ceilingSeconds = [...slacks, ...priorCeilings].slice(0, WAITS_KEPT);
  const submissions = tally.submissions ?? [];
  const waits = [
    ...submissions.filter((s) => opened.has(s.openTx)).map((s) => ({ at: s.at, seconds: s.at - opened.get(s.openTx)! })),
    ...priorWaits,
  ].sort((a, b) => b.at - a.at).slice(0, WAITS_KEPT);
  const sortedWaits = waits.map((wait) => wait.seconds).sort((a, b) => a - b);
  tally.responseSeconds = waits.map((wait) => wait.seconds);
  tally.responseSecondsMedian = sortedWaits.length ? sortedWaits[Math.floor(sortedWaits.length / 2)] : null;
  tally.responseSecondsP90 = sortedWaits.length ? sortedWaits[Math.ceil(sortedWaits.length * 0.9) - 1] : null;
  const answered = new Set(submissions.map((s) => s.openTx));
  const openPending = Object.fromEntries([...opened].filter(([tx]) => !answered.has(tx)).sort((a, b) => b[1] - a[1]).slice(0, PENDING_KEPT));
  return { waits, openPending };
}

export function toIndexed(tally: DeliveryTally, scannedThroughBlock: number, generatedAt: string, priorOpens: Record<string, number> = {}, priorWaits: Wait[] = []): IndexedAgent {
  const { waits, openPending } = finishTally(tally, priorOpens, priorWaits);
  return {
    paid: tally.paid, refunded: tally.refunded, disputed: tally.disputed, resultsSubmitted: tally.resultsSubmitted, escrowsOpened: tally.escrowsOpened,
    walletOnly: tally.walletOnly ?? 0, buyers: tally.buyers ?? [],
    responseSecondsMedian: tally.responseSecondsMedian ?? null, responseSecondsP90: tally.responseSecondsP90 ?? null, ceilingSeconds: tally.ceilingSeconds ?? [],
    lastTxTime: tally.events[0]?.blockTime ?? null, scannedThroughBlock, generatedAt,
    waits, openPending, events: tally.events.slice(0, 20),
  };
}

// indexed covers every tx up to scannedThroughBlock, live only txs after it: the two never overlap.
export function mergeIndexed(indexed: IndexedAgent, live: DeliveryTally): DeliveryTally {
  const merged: DeliveryTally = {
    escrowsOpened: indexed.escrowsOpened + live.escrowsOpened,
    resultsSubmitted: indexed.resultsSubmitted + live.resultsSubmitted,
    paid: indexed.paid + live.paid,
    refunded: indexed.refunded + live.refunded,
    disputed: indexed.disputed + live.disputed,
    buyers: [...new Set([...indexed.buyers, ...(live.buyers ?? [])])],
    submissions: live.submissions,
    ceilingByOpenTx: live.ceilingByOpenTx,
    events: [...live.events, ...indexed.events],
  };
  const walletOnly = indexed.walletOnly + (live.walletOnly ?? 0);
  if (walletOnly) merged.walletOnly = walletOnly;
  finishTally(merged, indexed.openPending, indexed.waits, indexed.ceilingSeconds ?? []);
  return merged;
}

const CHUNK = 50;
const SCAN_CAP = Number(env("ESCROW_SCAN_CAP", "1000"));

export async function deliveryHistory(identifier: string, network: Network = "Preprod"): Promise<Evidence> {
  const observedAt = () => new Date().toISOString();
  try {
    const asset = await resolveAsset(identifier, network);
    if (!asset) return { source: "masumi_delivery_history", status: "not_found", observedAt: observedAt(), data: { identifier, network } };
    const unit = asset.policy + asset.name;
    const [info] = await post("/asset_info", { _asset_policy: asset.policy, _asset_name: asset.name }, network) as Row[];
    if (!info) return { source: "masumi_delivery_history", status: "not_found", observedAt: observedAt(), data: { identifier, network } };
    const holders = await request(`/asset_addresses?_asset_policy=${asset.policy}&_asset_name=${asset.name}`, {}, network) as Row[];
    const sellers = new Set(holders.map((holder) => decodePaymentCredential(String(holder.payment_address ?? ""))).filter((cred): cred is string => Boolean(cred)));
    const [mint] = await post("/tx_info", { _tx_hashes: [info.minting_tx_hash], _inputs: false, _metadata: false, _assets: false, _withdrawals: false, _certs: false, _scripts: false, _bytecode: false }, network) as Row[];
    const registeredAtBlock = Number(mint?.block_height ?? 0);
    const indexed = network === "Mainnet" ? escrowIndex.agents[unit] : undefined;
    const afterBlock = indexed ? Math.max(indexed.scannedThroughBlock, registeredAtBlock) : registeredAtBlock;
    const tally: DeliveryTally = { escrowsOpened: 0, resultsSubmitted: 0, paid: 0, refunded: 0, disputed: 0, events: [] };
    const coverage: Array<{ contract: string; scannedTxs: number; truncated: boolean }> = [];
    for (const contract of contracts(network)) {
      let listed: Row[] = [];
      for (let offset = 0; listed.length < SCAN_CAP; offset += PAGE) {
        const page = await post(`/address_txs?offset=${offset}&limit=${Math.min(PAGE, SCAN_CAP - listed.length)}`, { _addresses: [contract], _after_block_height: afterBlock }, network) as Row[];
        listed.push(...page);
        if (page.length < PAGE) break;
      }
      const truncated = listed.length >= SCAN_CAP;
      // The koios filter is inclusive: with an index, drop the block it already covers.
      if (indexed) listed = listed.filter((row) => Number(row.block_height) > afterBlock);
      for (let i = 0; i < listed.length; i += CHUNK) {
        const txs = await post("/tx_info", { _tx_hashes: listed.slice(i, i + CHUNK).map((row) => row.tx_hash), _inputs: true, _metadata: false, _assets: false, _withdrawals: false, _certs: false, _scripts: true, _bytecode: false }, network) as TxInfo[];
        tallyDelivery(txs, sellers, unit, contract, tally);
      }
      coverage.push({ contract, scannedTxs: listed.length, truncated });
    }
    const result = indexed ? mergeIndexed(indexed, tally) : tally;
    if (!indexed) finishTally(result);
    delete result.submissions;
    return { source: "masumi_delivery_history", status: "ok", observedAt: observedAt(), data: { identifier, unit, network, sellerCredentials: [...sellers], registeredAtBlock, coverage, indexedThroughBlock: indexed?.scannedThroughBlock ?? null, indexGeneratedAt: indexed?.generatedAt ?? null, ...result, events: result.events.slice(0, 20) } };
  } catch (error) {
    return { source: "masumi_delivery_history", status: "unavailable", observedAt: observedAt(), error: error instanceof Error ? error.message : "Koios request failed" };
  }
}
