// Registers "Masumi Backup Fallback ADA": same MIP-003 server on :4512, priced in lovelace so the
// purchasing wallet can hire it without holding tUSDM. Prints the agent identifier once confirmed.
const mps = process.env.MPS_URL ?? "http://127.0.0.1:3012/api/v1";
const token = process.env.MPS_API_TOKEN;
if (!token) throw new Error("MPS_API_TOKEN required");
const json = async (path: string, init: RequestInit = {}) => { const r = await fetch(`${mps}${path}`, { ...init, headers: { "content-type": "application/json", token }, signal: AbortSignal.timeout(60_000) }); const b = await r.json() as any; if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(b).slice(0, 800)}`); return b.data; };
const name = "Masumi Backup Fallback ADA";
const source = (await json("/payment-source?take=20")).PaymentSources.find((v: any) => v.network === "Preprod" && v.paymentSourceType === "Web3CardanoV2");
const existing = (await json("/registry?network=Preprod&limit=100&filterPaymentSourceType=Web3CardanoV2")).Assets;
const sellerVkey = existing.find((v: any) => v.SmartContractWallet?.walletVkey)?.SmartContractWallet.walletVkey;
if (!existing.find((v: any) => v.name === name)) await json("/registry", { method: "POST", body: JSON.stringify({ network: "Preprod", type: "Standard", sellingWalletVkey: sellerVkey, apiBaseUrl: "http://127.0.0.1:4512", name, description: "MIP-003 backup URL-title agent priced in ADA for the Masumi escrow backup demonstration.", Capability: { name: "URL title extraction", version: "1.0.0" }, Author: { name: "Cost of Trust", organization: "Cost of Trust" }, Tags: ["MIP-003", "backup", "ada"], ExampleOutputs: [{ name: "title", mimeType: "text/plain", url: "https://example.com/" }], supportedPaymentSources: [{ chain: "Cardano", network: "Preprod", paymentSourceType: "Web3CardanoV2", address: source.smartContractAddress, pricing: { pricingType: "Fixed", fixed: [{ asset: "lovelace", amount: "3000000" }] } }] }) });
for (let i = 0; i < 60; i++) {
  const found = (await json("/registry?network=Preprod&limit=100&filterPaymentSourceType=Web3CardanoV2")).Assets.find((v: any) => v.name === name);
  console.error(i, found?.state);
  if (found?.state === "RegistrationConfirmed") { console.log(found.agentIdentifier); break; }
  if (found?.state?.endsWith("Failed")) throw new Error(found.state);
  await new Promise((r) => setTimeout(r, 10_000));
}
