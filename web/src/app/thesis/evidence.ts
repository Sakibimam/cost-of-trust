export const tx = (hash: string) => `https://preprod.cardanoscan.io/transaction/${hash}`;

// Source: agents/runs/2026-10-06T04-12-36-912Z.json, 2026-10-06T04-23-09-081Z.json,
// 2026-10-06T04-35-49-319Z.json, 2026-10-06T04-40-21-303Z.json, 2026-10-06T04-45-57-790Z.json.
export const runs = [
  { time: "04:12", route: "underwritten", label: "claim and coverage settlement", hashes: ["f158c93d4ea5ff3c484755a3cd99bcbeea9c7e11dafa070f59cb4829a7f9a3b2", "5f44c119aba938848be23a20abd542f473cc4c6447b5e41e2450c032473d10ff"] },
  { time: "04:23", route: "underwritten", label: "expired forfeit and settlement", hashes: ["3f65613f45d16aa23a6a623c9dbe2215b4f3f248f71fd4a41b3d377642f16d70", "54c5eb596f9d351f4c73e74790e52ac30dc5fbe61b6d1a6bf6d9972b895af761"] },
  { time: "04:35", route: "redundant A + B", label: "seller A claims, seller B refused by the ledger", hashes: ["b26f22c362be625765324d31bfa15f7d58b73db84725801f32700aca65cc1a73", "99fd62a161501064cb5274a0ab3c25a14943c947f5487c82eb97c4818754e01d"] },
  { time: "04:45", route: "underwritten", label: "seller B claim and settlement", hashes: ["296257f15d00134b30b9c18360cd216acf3b445eb39df352d4e70e31d47da239", "3c20440b7419f5c8da18910af0c6fd2b8a40dae0b4d22cacccf8ef0fddf41abb"] },
] as const;

// Source: instant/results.json, generatedAt 2026-10-06T12:31:47.741Z.
export const instant = {
  confirmed: { requests: 20, p50: 5061.852667000028, p95: 6206.545458000037, confirmed: 20 },
  instant: { requests: 20, p50: 4994.932792000007, p95: 6462.277749999892, confirmed: 20 },
  split: "6a95f5f961678456c6f83b3e9edbaf0d169c96acd03af555f3d3031ce2a4f5d9",
} as const;

// Source: local MPS PaymentRequest tx history for Sokosumi Task 01a11153-9886 (delivered report sha256 923cdcd5..., 4/4 facts ok), each tx confirmed by Koios preprod tx_status on 2026-10-06.
export const coworker = [
  ["Buyer funds escrow", "be70aa09631cb3a7bda74bd09b91fa5d837e9408e2f889c80a71ce0bb7f08892"],
  ["Trust Check submits result", "0be9fa229a864ddbaa8847afa84657d535d93d4a26fdbab506e2a2ebde573f91"],
  ["Seller collects", "6b8bab2e1f143467ba52001d928eade55ee71b9540b768d5870e9aaa18108630"],
] as const;

export const quotes = [
  { text: "exact ... has no mechanism for returning funds once settled", source: "x402 issue #2943", href: "https://github.com/x402-foundation/x402/issues/2943" },
  { text: "The user said 'fetch market data under $0.10,' the agent paid $5.00 for a premium tier.", source: "x402 issue #3500", href: "https://github.com/x402-foundation/x402/issues/3500" },
  { text: "We run continuous monitoring on ~1,700 x402 services ... Average fidelity across the ecosystem is 38/100", source: "Hacker News, dshaker", href: "https://news.ycombinator.com/item?id=47158809" },
  { text: "2,252 merchants had a live listing ... The median merchant earned six cents.", source: "Zaryab Afser, Decipher Club", href: "https://x.com/zaryab_eth/status/2103171062460744118" },
] as const;

export const ecosystem = [
  { name: "Masumi", text: "Escrow, identity, reputation, discovery, and MIP-003-compatible payment execution.", href: "https://docs.masumi.network/" },
  { name: "Sokosumi", text: "The buyer and seller surface where an agent can be discovered, hired, and paid.", href: "https://www.sokosumi.com/" },
  { name: "Cardano x402", text: "The exact payment scheme and facilitator path used for Cardano agent commerce.", href: "https://www.npmjs.com/package/@x402/cardano" },
  { name: "Cardano Foundation", text: "The network-side context for agentic commerce and the x402 facilitator.", href: "https://github.com/cardano-foundation/cardano-x402-facilitator" },
] as const;

export const priorArt = [
  { name: "Plain x402 exact", does: "settles the payment", gap: "does not price who should receive it or return settled funds", href: "https://github.com/x402-foundation/x402/issues/2943" },
  { name: "x402scan and CDP Bazaar", does: "rank resources by visible activity", gap: "volume is not delivery fidelity or payer-side enforcement", href: "https://www.x402scan.com/" },
  { name: "Masumi", does: "provides escrow, registry, and payment rails", gap: "the buyer still needs a route decision before payment", href: "https://docs.masumi.network/" },
  { name: "Verdikta", does: "offers an AI dispute-resolution oracle on Base", gap: "the verified route and Cardano keeper mechanism remain open", href: "https://github.com/verdikta/verdikta-docs" },
] as const;

export const footnotes = [
  ["1", "Research demand corpus: research/demand/FINDINGS.md and research/demand/pains-agent-payments.md."],
  ["2", "Route formula and golden vectors: docs/WRITEUP.md, docs/PITCH-90S.md, and docs/SPEC.md."],
  ["3", "Provider measurements: docs/GTM.md and router/probes/results-20261006051159.json."],
  ["4", "Preprod proof: agents/runs/*.json, coworker/README.md, and instant/results.json."],
] as const;
