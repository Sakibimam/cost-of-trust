import { env, loadEnv } from "./config.ts";
import type { Evidence } from "./types.ts";

loadEnv();

const policies = [
  env("MASUMI_REGISTRY_POLICY_V1_PREPROD", "7e8bdaf2b2b919a3a4b94002cafb50086c0c845fe535d07a77ab7f77"),
  env("MASUMI_REGISTRY_POLICY_V2_PREPROD", "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b"),
];

const request = async (path: string, init: RequestInit = {}): Promise<unknown> => {
  const response = await fetch(`${env("KOIOS_URL", "https://preprod.koios.rest/api/v1")}${path}`, {
    ...init,
    headers: { accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Koios HTTP ${response.status}`);
  return response.json();
};

const post = (path: string, body: unknown) => request(path, { method: "POST", body: JSON.stringify(body) });

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
  if (/^[0-9a-f]{112}$/i.test(identifier)) return { policy: identifier.slice(0, 56), name: identifier.slice(56) };
  if (/^[0-9a-f]{56}$/i.test(identifier)) return { policy: identifier };
  return null;
}

async function assetInfo(identifier: string): Promise<unknown[]> {
  const parts = assetParts(identifier);
  if (!parts) return [];
  if (parts.fingerprint) return await request(`/asset_info?_asset_fingerprint=${encodeURIComponent(parts.fingerprint)}`) as unknown[];
  if (parts.name) return await post("/asset_info", { _asset_policy: parts.policy, _asset_name: parts.name }) as unknown[];
  const rows: unknown[] = [];
  for (const policy of policies) rows.push(...await request(`/policy_asset_list?_asset_policy=${policy}&limit=1000`) as unknown[]);
  return rows.filter((row) => (row as Record<string, unknown>).policy_id === parts.policy);
}

export async function registryFromChain(identifier: string): Promise<Evidence> {
  try {
    const parts = assetParts(identifier);
    let assets = await assetInfo(identifier);
    if (/^[0-9a-f]{56}$/i.test(identifier)) {
      const matched: unknown[] = [];
      for (const policy of policies) {
        const rows = await request(`/policy_asset_list?_asset_policy=${policy}&limit=1000`) as Array<Record<string, unknown>>;
        for (const asset of rows) {
          const name = String(asset.asset_name ?? "");
          const holders = await post("/asset_addresses", { _asset_policy: policy, _asset_name: name }) as Array<Record<string, unknown>>;
          if (holders.some((holder) => decodePaymentCredential(String(holder.payment_address ?? "")) === identifier)) matched.push({ asset, holders });
        }
      }
      assets = matched;
    }
    if (!assets.length) return { source: "registry_chain", status: "not_found", observedAt: new Date().toISOString(), data: { identifier, policies } };
    return { source: "registry_chain", status: "ok", observedAt: new Date().toISOString(), data: { identifier, policies, assets } };
  } catch (error) {
    return { source: "registry_chain", status: "unavailable", observedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "Koios request failed" };
  }
}

export async function escrowHistory(identifier: string): Promise<Evidence> {
  try {
    const paymentAddress = env("MASUMI_PAYMENT_ADDRESS_V2_PREPROD", "addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g");
    const txs = await request(`/address_txs?_address=${encodeURIComponent(paymentAddress)}&offset=0&limit=1000`);
    const asset = assetParts(identifier);
    const assetRows = asset?.fingerprint
      ? await request(`/asset_txs?_asset_fingerprint=${encodeURIComponent(asset.fingerprint)}`)
      : asset?.name
        ? await request(`/asset_txs?_asset_policy=${asset.policy}&_asset_name=${asset.name}`)
        : [];
    return { source: "masumi_escrow_history", status: "ok", observedAt: new Date().toISOString(), data: { paymentAddress, identifier, contractTransactions: txs, identifierTransactions: assetRows, interpretation: "Koios contract and identifier transaction evidence; V2 action decoding follows the returned on-chain transaction data." } };
  } catch (error) {
    return { source: "masumi_escrow_history", status: "unavailable", observedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "Koios request failed" };
  }
}
