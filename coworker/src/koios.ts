import { env, loadEnv } from "./config.ts";
import type { Evidence } from "./types.ts";

loadEnv();

export type Network = "Preprod" | "Mainnet";

const policies = (network: Network) => network === "Mainnet"
  ? [
    env("MASUMI_REGISTRY_POLICY_V1_MAINNET", "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9"),
    env("MASUMI_REGISTRY_POLICY_V2_MAINNET", "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b"),
  ]
  : [
    env("MASUMI_REGISTRY_POLICY_V1_PREPROD", "7e8bdaf2b2b919a3a4b94002cafb50086c0c845fe535d07a77ab7f77"),
    env("MASUMI_REGISTRY_POLICY_V2_PREPROD", "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b"),
  ];

// Masumi payment (escrow) contracts, V2 then V1, from the Masumi Payment Service sources and migrations.
const contracts = (network: Network) => network === "Mainnet"
  ? env("MASUMI_PAYMENT_CONTRACTS_MAINNET", "addr1wxs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgge2j6d,addr1wx7j4kmg2cs7yf92uat3ed4a3u97kr7axxr4avaz0lhwdsq87ujx7").split(",")
  : env("MASUMI_PAYMENT_CONTRACTS_PREPROD", "addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g,addr_test1wz7j4kmg2cs7yf92uat3ed4a3u97kr7axxr4avaz0lhwdsqukgwfm").split(",");

const koiosBase = (network: Network) => env(network === "Mainnet" ? "KOIOS_URL_MAINNET" : "KOIOS_URL_PREPROD", network === "Mainnet" ? "https://api.koios.rest/api/v1" : "https://preprod.koios.rest/api/v1");

const request = async (path: string, init: RequestInit = {}, network: Network = "Preprod"): Promise<unknown> => {
  const response = await fetch(`${koiosBase(network)}${path}`, {
    ...init,
    headers: { accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Koios HTTP ${response.status} on ${path.split("?")[0]}`);
  return response.json();
};

const post = (path: string, body: unknown, network: Network = "Preprod") => request(path, { method: "POST", body: JSON.stringify(body) }, network);

type Row = Record<string, unknown>;
const PAGE = 1000;

async function policyAssets(policy: string, network: Network): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await request(`/policy_asset_list?_asset_policy=${policy}&limit=${PAGE}&offset=${offset}`, {}, network) as Row[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

function decodePaymentCredential(address: string): string | null {
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
export function escrowParty(datum: PlutusJson | undefined): { seller: string; agent?: string; state: number } | null {
  const fields = datum?.fields;
  if (!fields || (fields.length !== 19 && fields.length !== 16)) return null;
  const sellerAt = fields.length === 19 ? 2 : 1;
  const seller = fields[sellerAt]?.fields?.[0]?.fields?.[0]?.bytes;
  const state = fields[fields.length - 1]?.constructor;
  if (!seller || state === undefined) return null;
  return { seller, agent: fields.length === 19 ? fields[8]?.bytes : undefined, state };
}

// Redeemer constructors shared by V1 and V2 vested_pay: Withdraw 0, WithdrawRefund 3, WithdrawDisputed 4, SubmitResult 5.
const ACTIONS: Record<number, "paid" | "refunded" | "disputed" | "resultsSubmitted"> = { 0: "paid", 3: "refunded", 4: "disputed", 5: "resultsSubmitted" };

type TxOutput = { tx_hash?: string; tx_index?: number; payment_addr?: { bech32?: string }; inline_datum?: { value?: PlutusJson } | null };
type TxInfo = {
  tx_hash: string; tx_timestamp: number;
  inputs?: TxOutput[];
  outputs?: TxOutput[];
  plutus_contracts?: Array<{ valid_contract?: boolean; spends_input?: { tx_hash: string; tx_index: number } | null; input?: { redeemer?: { datum?: { value?: PlutusJson } } } }>;
};

export type DeliveryTally = { escrowsOpened: number; resultsSubmitted: number; paid: number; refunded: number; disputed: number; events: Array<{ txHash: string; blockTime: number; action: string; contract: string }> };

export function tallyDelivery(txs: TxInfo[], sellers: Set<string>, agentUnit: string, contract: string, tally: DeliveryTally): void {
  const ours = (datum: PlutusJson | undefined) => {
    const party = escrowParty(datum);
    return party && (sellers.has(party.seller) || party.agent === agentUnit) ? party : null;
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
      tally.events.push({ txHash: tx.tx_hash, blockTime: tx.tx_timestamp, action, contract });
    }
    if (spentOurs) continue;
    for (const output of tx.outputs ?? []) {
      const party = output.payment_addr?.bech32 === contract ? ours(output.inline_datum?.value) : null;
      if (party?.state !== 0) continue;
      tally.escrowsOpened += 1;
      tally.events.push({ txHash: tx.tx_hash, blockTime: tx.tx_timestamp, action: "escrowOpened", contract });
    }
  }
}

// ponytail: reads the newest SCAN_CAP contract txs since registration; a busy mainnet contract (33k txs) needs an indexer for full history.
const SCAN_CAP = Number(env("ESCROW_SCAN_CAP", "1000"));
const CHUNK = 50;

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
    const tally: DeliveryTally = { escrowsOpened: 0, resultsSubmitted: 0, paid: 0, refunded: 0, disputed: 0, events: [] };
    const coverage: Array<{ contract: string; scannedTxs: number; truncated: boolean }> = [];
    for (const contract of contracts(network)) {
      const listed: Row[] = [];
      for (let offset = 0; listed.length < SCAN_CAP; offset += PAGE) {
        const page = await post(`/address_txs?offset=${offset}&limit=${Math.min(PAGE, SCAN_CAP - listed.length)}`, { _addresses: [contract], _after_block_height: registeredAtBlock }, network) as Row[];
        listed.push(...page);
        if (page.length < PAGE) break;
      }
      for (let i = 0; i < listed.length; i += CHUNK) {
        const txs = await post("/tx_info", { _tx_hashes: listed.slice(i, i + CHUNK).map((row) => row.tx_hash), _inputs: true, _metadata: false, _assets: false, _withdrawals: false, _certs: false, _scripts: true, _bytecode: false }, network) as TxInfo[];
        tallyDelivery(txs, sellers, unit, contract, tally);
      }
      coverage.push({ contract, scannedTxs: listed.length, truncated: listed.length >= SCAN_CAP });
    }
    tally.events.sort((a, b) => b.blockTime - a.blockTime);
    return { source: "masumi_delivery_history", status: "ok", observedAt: observedAt(), data: { identifier, unit, network, sellerCredentials: [...sellers], registeredAtBlock, coverage, ...tally, events: tally.events.slice(0, 20) } };
  } catch (error) {
    return { source: "masumi_delivery_history", status: "unavailable", observedAt: observedAt(), error: error instanceof Error ? error.message : "Koios request failed" };
  }
}
