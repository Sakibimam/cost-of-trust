import { toClientCardanoSigner } from "@x402/cardano";
import { pay } from "../src/index.ts";

const signer = toClientCardanoSigner({
  mnemonic: process.env.CARDANO_MNEMONIC!, network: "cardano:preprod",
  provider: { koios: { baseUrl: "https://preprod.koios.rest/api/v1", token: process.env.KAIOS_KEY } },
});
const result = await pay({
  task: "claim before expiry", serviceType: "cardano_deadline_execution",
  deadline: new Date(Date.now() + 10 * 60_000).toISOString(), downstreamLossAda: 100,
  candidateSellers: ["provider-koios-authenticated", "provider-tatum-preprod"],
}, {
  routerUrl: "http://localhost:8787",
  sellerUrls: { "provider-koios-authenticated": "http://localhost:4101/claim", "provider-tatum-preprod": "http://localhost:4102/claim" },
  signer,
});
console.log(result);
