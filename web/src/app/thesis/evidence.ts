import backtest from "@/data/backtest.json";

export const tx = (hash: string) => `https://preprod.cardanoscan.io/transaction/${hash}`;

export function measurementSentence(): string {
  const sample = backtest.policies;
  const p2 = sample.P2["100"].jobsDone;
  const p0 = sample.P0["100"].jobsDone;
  return `On ${backtest.calibration.observations} later mainnet jobs, reading refunds instead of disputes scores Brier ${backtest.calibration.betaBinomialBrier.toFixed(3)} against ${backtest.calibration.disputeRateBrier.toFixed(3)}, and skipping agents with more than one refund in five finishes ${p2} jobs instead of ${p0}.`;
}

export const measurement = {
  observations: backtest.calibration.observations,
  brier: backtest.calibration.betaBinomialBrier,
  disputeBrier: backtest.calibration.disputeRateBrier,
  jobs: backtest.eligibleDecisions,
  hireAllDone: backtest.policies.P0["100"].jobsDone,
  skipDone: backtest.policies.P2["100"].jobsDone,
  hireAllUndone: backtest.policies.P0["100"].undoneWorkAda,
  skipUndone: backtest.policies.P2["100"].undoneWorkAda,
} as const;

// Source: agents/runs/2026-10-06T04-12-36-912Z.json, 2026-10-06T04-23-09-081Z.json,
// 2026-10-06T04-35-49-319Z.json, 2026-10-06T04-40-21-303Z.json, 2026-10-06T04-45-57-790Z.json.
export const runs = [
  { time: "04:12", route: "underwritten", label: "claim and coverage settlement", hashes: ["f158c93d4ea5ff3c484755a3cd99bcbeea9c7e11dafa070f59cb4829a7f9a3b2", "5f44c119aba938848be23a20abd542f473cc4c6447b5e41e2450c032473d10ff"] },
  { time: "04:23", route: "underwritten", label: "expired forfeit and settlement", hashes: ["3f65613f45d16aa23a6a623c9dbe2215b4f3f248f71fd4a41b3d377642f16d70", "54c5eb596f9d351f4c73e74790e52ac30dc5fbe61b6d1a6bf6d9972b895af761"] },
  { time: "04:35", route: "redundant A + B", label: "seller A claims; seller B's payment was not confirmed", hashes: ["b26f22c362be625765324d31bfa15f7d58b73db84725801f32700aca65cc1a73", "99fd62a161501064cb5274a0ab3c25a14943c947f5487c82eb97c4818754e01d"] },
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
  { name: "Masumi", text: "Escrow, refunds, disputes, identity, and the on-chain agent registry.", href: "https://docs.masumi.network/" },
  { name: "Sokosumi", text: "Where a coworker discovers another agent and pays it.", href: "https://www.sokosumi.com/" },
  { name: "Cardano x402", text: "HTTP 402 on Cardano. The caller pays, and the same request returns the answer.", href: "https://www.npmjs.com/package/@x402/cardano" },
  { name: "Cardano Foundation", text: "The facilitator path for x402 payments on Cardano.", href: "https://github.com/cardano-foundation/cardano-x402-facilitator" },
] as const;

// Source: agents/runs/2026-10-07T07-36-20Z-masumi-backup-stall-final.json. Hashes checked with POST preprod.koios.rest/api/v1/tx_status.
export const stall = [
  ["A hired", "5d70db26db11b4e7e3711ce11febef7031b790f710e23c10927ff4ab3d9518d8"],
  ["B hired", "d9b06473307dbf9c056bc51a66637d5af2e153c63b770d4650434967ab74c63e"],
  ["B result", "7934f7a085a4c491469994f6c7964f601219487cb6888bcefebce05862189fdf"],
  ["A refund withdrawn", "f6445aa1b4a1eae1f69516d215763fe6e4cf20e8d6e4cb94340bd9e206ae9db8"],
] as const;

// Source: agents/runs/2026-10-06T04-44-21-919Z.json. Keeper B's submit returned ConwayUtxowFailure BadInputsUTxO for the lock tx input. No second claim was confirmed.
export const race = [
  ["Lock", "c0c104a07e8a375982ba72f0a7d0f949a2dbd194a69eb171d9ca375d7e60f814"],
  ["A paid", "e458925a99e85fe742b0f0a2a1dbf1dfc8ece3724752a8862227e27c89309cac"],
  ["B paid", "aa40b41742f98be7520e3003fc49e11266cab049dcabdafa59677a6042b9354a"],
  ["A claims", "43b27058c91abc30ff560251cc7997a0ca0343df4432319c265b4f140163de9b"],
] as const;

export const priorArt = [
  { name: "Plain x402 exact", does: "settles the payment", gap: "does not say whether the hiring agent should pay this seller", href: "https://github.com/x402-foundation/x402/issues/2943" },
  { name: "x402scan and CDP Bazaar", does: "rank resources by visible activity", gap: "activity is not paid, refunded, or disputed", href: "https://www.x402scan.com/" },
  { name: "Masumi", does: "holds the escrow, the refund, and the dispute", gap: "the hiring agent still chooses who receives the escrow", href: "https://docs.masumi.network/" },
  { name: "Verdikta", does: "resolves a dispute after the fact", gap: "a dispute is the outcome after a bad hire, not the decision before it", href: "https://github.com/verdikta/verdikta-docs" },
] as const;

export const footnotes = [
  ["1", "web/src/data/backtest.json, generated 2026-10-07. Policies P0 and P2 at 100 ADA on 283 later decisions. Both scores are Brier scores."],
  ["2", "Masumi stall: agents/runs/2026-10-07T07-36-20Z-masumi-backup-stall-final.json. A stalls, B delivers, A is refunded."],
  ["3", "One-claim race: agents/runs/2026-10-06T04-44-21-919Z.json. The second spend of the lock was rejected at submission with BadInputsUTxO."],
  ["4", "Trust Check payment, Sokosumi task 01a11153-9886. Funds locked, result submitted, seller collected."],
] as const;
