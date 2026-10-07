import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.MPS_URL ?? "http://127.0.0.1:3012/api/v1";
const token = process.env.MPS_API_TOKEN;
if (!token) throw new Error("MPS_API_TOKEN is required");
const headers = { "content-type": "application/json", token };
const json = async (path: string, init?: RequestInit) => { const response = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } }); const body = await response.json() as any; if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${JSON.stringify(body).slice(0, 800)}`); return body.data ?? body; };
const source = (await json("/payment-source?take=20")).PaymentSources.find((value: any) => value.network === "Preprod" && value.paymentSourceType === "Web3CardanoV2");
if (!source) throw new Error("no Preprod Web3CardanoV2 source");
const existing = (await json("/registry?network=Preprod&limit=100&filterPaymentSourceType=Web3CardanoV2")).Assets as any[];
const sellerVkey = existing.find((value) => value.SmartContractWallet?.walletVkey)?.SmartContractWallet.walletVkey;
if (!sellerVkey) throw new Error("no existing V2 seller wallet to reuse");
const register = async (role: "primary" | "backup", port: number) => {
  const name = `Masumi Backup ${role === "primary" ? "Primary" : "Fallback"}`;
  const found = existing.find((value) => value.name === name && value.state === "RegistrationConfirmed");
  if (found?.agentIdentifier) return found;
  const pending = existing.find((value) => value.name === name);
  if (pending) throw new Error(`${name} already exists in MPS with state ${pending.state}; wait for the existing request instead of submitting a duplicate`);
  return json("/registry", { method: "POST", body: JSON.stringify({ network: "Preprod", type: "Standard", sellingWalletVkey: sellerVkey, apiBaseUrl: `http://127.0.0.1:${port}`, name, description: `MIP-003 ${role} URL-title agent for the Masumi escrow backup demonstration.`, Capability: { name: "URL title extraction", version: "1.0.0" }, Author: { name: "Cost of Trust", organization: "Cost of Trust" }, Tags: ["MIP-003", "backup", role], ExampleOutputs: [{ name: "title", mimeType: "text/plain", url: "https://example.com/" }], supportedPaymentSources: [{ chain: "Cardano", network: "Preprod", paymentSourceType: "Web3CardanoV2", address: source.smartContractAddress, pricing: { pricingType: "Fixed", fixed: [{ asset: process.env.MASUMI_PRICE_ASSET ?? "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d", amount: process.env.MASUMI_PRICE_AMOUNT ?? "1000000" }] } }] }) });
};
const primary = await register("primary", 4511);
const backup = await register("backup", 4512);
await mkdir("masumi-backup", { recursive: true });
await writeFile("masumi-backup/agents.json", `${JSON.stringify({ primary: { name: primary.name, agentIdentifier: primary.agentIdentifier, apiBaseUrl: primary.apiBaseUrl }, backup: { name: backup.name, agentIdentifier: backup.agentIdentifier, apiBaseUrl: backup.apiBaseUrl }, paymentSource: { smartContractAddress: source.smartContractAddress, policyId: source.policyId } }, null, 2)}\n`);
console.log(JSON.stringify({ primary: primary.agentIdentifier, backup: backup.agentIdentifier, source: source.smartContractAddress }));
