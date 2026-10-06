import { env, loadEnv } from "./config.ts";
import type { Evidence } from "./types.ts";

loadEnv();

type Network = "Preprod" | "Mainnet";

const policies = (network: Network) => network === "Mainnet"
  ? [
    env("MASUMI_REGISTRY_POLICY_V1_MAINNET", "ad6424e3ce9e47bbd8364984bd731b41de591f1d11f6d7d43d0da9b9"),
    env("MASUMI_REGISTRY_POLICY_V2_MAINNET", "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b"),
  ]
  : [
    env("MASUMI_REGISTRY_POLICY_V1_PREPROD", "7e8bdaf2b2b919a3a4b94002cafb50086c0c845fe535d07a77ab7f77"),
    env("MASUMI_REGISTRY_POLICY_V2_PREPROD", "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b"),
  ];

const koiosBase = (network: Network) => env(network === "Mainnet" ? "KOIOS_URL_MAINNET" : "KOIOS_URL_PREPROD", network === "Mainnet" ? "https://api.koios.rest/api/v1" : "https://preprod.koios.rest/api/v1");

const request = async (path: string, init: RequestInit = {}, network: Network = "Preprod"): Promise<unknown> => {
  const response = await fetch(`${koiosBase(network)}${path}`, {
    ...init,
    headers: { accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Koios HTTP ${response.status}`);
  return response.json();
};

const post = (path: string, body: unknown, network: Network = "Preprod") => request(path, { method: "POST", body: JSON.stringify(body) }, network);

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
  for (const policy of policies(network)) {
    const rows = await request(`/policy_asset_list?_asset_policy=${policy}&limit=1000`, {}, network) as Array<Record<string, unknown>>;
    const match = rows.find((row) => String(row.fingerprint ?? "").toLowerCase() === parts.fingerprint?.toLowerCase());
    if (match) return { policy, name: String(match.asset_name ?? "") };
  }
  return null;
}

async function assetInfo(identifier: string, network: Network): Promise<unknown[]> {
  const asset = await resolveAsset(identifier, network);
  if (!asset) return [];
  return await post("/asset_info", { _asset_policy: asset.policy, _asset_name: asset.name }, network) as unknown[];
}

export async function registryFromChain(identifier: string, network: Network = "Preprod"): Promise<Evidence> {
  try {
    const parts = assetParts(identifier);
    let assets = await assetInfo(identifier, network);
    if (/^[0-9a-f]{56}$/i.test(identifier)) {
      const matched: unknown[] = [];
      for (const policy of policies(network)) {
        const rows = await request(`/policy_asset_list?_asset_policy=${policy}&limit=1000`, {}, network) as Array<Record<string, unknown>>;
        for (const asset of rows) {
          const name = String(asset.asset_name ?? "");
          const holders = await post("/asset_addresses", { _asset_policy: policy, _asset_name: name }, network) as Array<Record<string, unknown>>;
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

export async function escrowHistory(identifier: string, network: Network = "Preprod"): Promise<Evidence> {
  try {
    const paymentAddress = env("MASUMI_PAYMENT_ADDRESS_V2_PREPROD", "addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g");
    const txs = await request(`/address_txs?_address=${encodeURIComponent(paymentAddress)}&offset=0&limit=1000`, {}, network);
    const asset = await resolveAsset(identifier, network);
    const assetRows = asset ? await post("/asset_txs", { _asset_policy: asset.policy, _asset_name: asset.name }, network) : [];
    return { source: "masumi_escrow_history", status: "ok", observedAt: new Date().toISOString(), data: { paymentAddress, identifier, contractTransactions: txs, identifierTransactions: assetRows, interpretation: "Koios contract and identifier transaction evidence; V2 action decoding follows the returned on-chain transaction data." } };
  } catch (error) {
    return { source: "masumi_escrow_history", status: "unavailable", observedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "Koios request failed" };
  }
}
