# Cost-of-Trust Routing: interface spec

Single source of truth for every lane. If code and this file disagree, fix one of them in the same commit.

An economic routing layer that lets autonomous agents price the cost of trusting a counterparty before they transact.
Vertical: Cardano deadline execution. Network: Cardano preprod. Assets: lovelace (ADA) for prices, premiums and collateral.

## 1. Components

| Dir | Role |
|---|---|
| `router/` | Risk model + route engine + HTTP API (`POST /best-route`, `GET /quotes/:taskId`, `GET /sellers`). Bun + TypeScript. |
| `onchain/` | Aiken (v1.1.19, Plutus V3, stdlib v3.0.0): `claim_vault` (the deadline task) and `coverage` (underwriter collateral settled by a CRE decision). |
| `offchain/` | Lucid-evolution 0.6.5 tx builders + Koios reads, shared by agents, relayer and scripts. |
| `agents/` | Keeper sellers A/B/C (x402 v2 servers), underwriter, buyer agent, relayer (receives CRE reports, submits `Settle`). |
| `cre/` | CRE workflow (TypeScript SDK): adjudicates a coverage claim from Cardano state read over HTTP (Koios), emits a signed report. CRE has no Cardano chain family; Cardano verifies the report itself. |
| `web/` | One screen: three routes, expected costs, correlation toggle, chosen route, live tx links, settlement state. |

## 2. Pricing model (router)

Per seller and service type, Beta-binomial on failures:
- prior `alpha0 = 2` (failures), `beta0 = 8` (successes); prior mean 0.20. The only configured number; labelled as such in API and UI.
- `alpha = alpha0 + failures`, `beta = beta0 + successes`, `posterior = alpha / (alpha + beta)`, `confidence = alpha + beta`.
- `pLoss = clamp(posterior + dependencyRiskPenalty + recentIncidentPenalty - bondDiscount, 0.001, 0.999)`.
- `pClaim = pLoss * coverageApplicabilityRate` (default 0.8).
Histories are counted from chain events (preprod keeper outcomes; optional Masumi V1 mainnet per-seller delivery counts), never typed in.

## 3. Route pricing (router)

Inputs: `downstreamLossAda` L, candidate sellers with `priceAda`, `pLoss`, `provider`, and the buyer's `riskAversion` lambda (>= 0; 0 = risk-neutral).
Every route is a loss distribution. Objective: `riskAdjustedCost = servicePrice + premium + E[loss] + lambda * sd(loss)` (mean-variance certainty equivalent). Pick the minimum; return every route with mean, sd and the arithmetic.
Routes quoted (all of them, never pruned to favour one):
- **single(s)** for every seller s, uncovered: loss L w.p. pLoss. `E = pLoss*L`, `sd = L*sqrt(pLoss(1-pLoss))`.
- **redundant(a,b)** for every seller pair when `allowRedundancy`: joint failure `pJ = pa*pb` if providers differ, `pa*pb + rho*sqrt(pa(1-pa)pb(1-pb))` if shared (`rho = sharedProviderCorrelation`, default 0.5). `E = pJ*L`, `sd = L*sqrt(pJ(1-pJ))`. Single-spend tasks (claim_vault): EUTXO makes redundant keepers safe: only one tx can spend the UTxO, the other is rejected at submission (no double execution, no fee), but both keepers are paid their x402 price. Request flag `sharedInfrastructure: true` treats every seller as one provider (all pairs correlated); false uses each seller's declared `provider`.
- **staggered(a,b)**: one claim_vault with an ordered keeper schedule and the keeper fees escrowed inside the vault. Keeper a may Claim only in slot 1 `[t0, t1)`, keeper b only in slot 2 `[t1, expiry)`, enforced by validity intervals; the Claim pays the beneficiary and pays the fee only to the keeper whose slot it is (signed by that keeper); the unused fee returns to the sponsor. One spend, one winner, one fee. Cost: `price_a * P(a succeeds) + price_b * P(a fails and b succeeds)` (expected fee, pay-on-success) and loss `L` with probability `pa * pb_given_late`, where `pb_given_late = pb + lateSlotPenalty` (default 0.05: b has less time). Correlation as for redundant. No oracle, no CRE: the chain alone decides who is paid.
- **underwritten(s)** for every seller with an underwriter offer: outcomes: success (1-pLoss) loss 0; covered failure (pClaim) loss `L - coverage`; uncovered failure (pLoss - pClaim) loss L. `E = pLoss*L - pClaim*coverage`; sd from those three outcomes.
Premium: `pClaim*coverage + capitalCost + fraudRisk + correlationRisk + margin`; `capitalCost = 0.005*coverage`, `fraudRisk 0.3`, `correlationRisk 0.5`, `margin 1.0`.
Why underwriting can win at all: with any margin, premium > pClaim*coverage, so coverage never wins for a risk-neutral buyer. It wins when the buyer cannot absorb the tail (lambda > 0). The router says this in `reason`.

Golden vectors (L = 100; A: 8, 0.20, koios-shared; B: 10, 0.10, own-node, pClaim 0.08, coverage 80; C: 8, 0.20, koios-shared), to 0.01:
| Route | E[cost] | sd(loss) | lambda 0 | lambda 0.25 |
|---|---|---|---|---|
| single A | 28.00 | 40.00 | 28.00 | 38.00 |
| single B | 20.00 | 30.00 | 20.00 | 27.50 |
| redundant A+C shared (pJ 0.12) | 28.00 | 32.50 | 28.00 | 36.12 |
| redundant A+C independent (pJ 0.04) | 20.00 | 19.60 | 20.00 | 24.90 |
| underwritten B (premium 8.60) | 22.20 | 14.80 | 22.20 | 25.90 |
Selections with all routes incl. staggered (measured from the router, commit 93cbc06; L=100):
| Buyer riskAversion | sharedInfrastructure false | sharedInfrastructure true |
|---|---|---|
| 0 (can absorb) | staggered A>B 11.10 | staggered A>B 18.24 |
| 0.25 | staggered A>B 15.36 | staggered B>A 25.75 |
| 0.5 (treasury, cannot absorb) | staggered A>B 19.63 | underwritten B 29.60 |
| 1 | staggered B>A 27.71 | underwritten B 37.00 |
The UI's two buyer presets are 0 and 0.5.
Thesis in one line: on Cardano the default protection is a staggered keeper schedule the chain itself enforces (one spend, one winner, fee paid only on success); coverage is worth its premium only when keepers share infrastructure and the buyer cannot absorb the tail.

## 4. API (router)

`POST /best-route`
```json
{ "task": "claim before expiry", "serviceType": "cardano_deadline_execution", "deadline": "ISO-8601",
  "downstreamLossAda": 100, "candidateSellers": ["seller-a","seller-b","seller-c"],
  "riskAversion": 0.25, "sharedInfrastructure": true, "constraints": { "allowRedundancy": true, "requireCoverage": false, "maxServiceSpendAda": 25 } }
```
Response: `selectedRoute` (single | redundant | underwritten), `selectedSellers`, `reason`, per-route `{ route, sellers, servicePriceAda, premiumAda, premiumBreakdown, coverageAda, pLoss, pClaim, confidence, expectedLossAda, sdLossAda, expectedTotalCostAda, riskAdjustedCostAda }`, `alternatives`, `assumptions` (prior, rho, applicability, each flagged configured vs measured), `quoteId`, `termsHash`.

`GET /quotes/:taskId`: the per-seller quote incl. `coverageOffers[] { underwriter, premiumAda, coverageLimitAda, deductibleAda, collateralRef, termsHash }` and `risk`.
`GET /sellers`: each seller's history (successes, failures, source tx hashes) and posterior.

## 5. x402 (v2, Cardano exact scheme)

Per x402-foundation/x402 `specs/schemes/exact/scheme_exact_cardano.md`. Keeper 402 response:
```json
{ "x402Version": 2, "accepts": [{ "scheme": "exact", "network": "cardano:preprod", "amount": "10000000", "asset": "lovelace",
  "payTo": "addr_test1...", "maxTimeoutSeconds": 600,
  "extra": { "costOfTrust": { "riskQuoteEndpoint": "https://<router>/quotes/<taskId>", "riskTermsHash": "<hex>" } } }] }
```
Use `@x402/cardano` 2.28.0 + `@x402/core` 2.28.0. `extra.assetTransferMethod: "masumi"` only if the package supports it on preprod (check source); otherwise the default method, stated in the README. `costOfTrust` is our metadata, not a proposed standard field.

## 6. On-chain

### claim_vault (the deadline task)
Datum `{ beneficiary: Address, expiry: Int (POSIX ms), sponsor: VerificationKeyHash }`. Exactly one input locked under the vault script payment credential (any stake part) is spent per transaction. Every payout output carries this vault's out-ref as its inline datum, and only tagged outputs count. Redeemers:
- `Claim`: tx upper validity bound < `expiry`; the whole vault value paid to `beneficiary` in a tagged output; anyone may submit (keepers have no special key).
- `Forfeit`: lower validity bound >= `expiry`; signed by `sponsor`; the whole vault value returns to the sponsor payment credential in a tagged output.
Missing the expiry = the buyer loses the claim value (the downstream loss L). One UTxO, one winner: redundant keepers conflict.

### coverage (underwriter collateral)
Locked by the underwriter for one task. Datum:
`{ terms_hash: ByteArray(32), buyer: Address, underwriter: Address, payout: Int (lovelace), task_ref: OutputReference (the claim_vault UTxO), task_expiry: Int (POSIX ms, the vault expiry), decide_by: Int (POSIX ms), config_digest: ByteArray(32) }`. `underwriter` is a full address whose payment credential is a key; that key signs `Expire`.
Config: reference input holding the config NFT (policy is the validator parameter). The NFT sits at the always-fail `config_lock` script address, so the config never changes after the mint. Datum `{ signers: List<ByteArray(20)> (EVM addresses), f: Int, workflow_owner: ByteArray(20), workflow_name: ByteArray(10), workflow_cid: ByteArray(32), don_config_digest: ByteArray(32) }` with `f >= 1`, unique signers and at least `2f + 1` of them. `config_digest = blake2b_256(f(1) | owner(20) | name(10) | cid(32) | don_config_digest(32) | n(1) | signers(20 each))`.
Exactly one input locked under the coverage script payment credential is spent per transaction. Redeemers:
- `Settle { raw_report, report_context, sigs: List<ByteArray(65)>, pubkeys: List<ByteArray(64)> }`: finite validity range with lower bound >= `task_expiry` and upper bound <= `decide_by`; digest `keccak256(keccak256(raw_report) ++ report_context)`; the first 32 bytes of `report_context` equal the config `don_config_digest`; f+1 distinct allowlisted signers verified with `verify_ecdsa_secp256k1_signature`; header metadata pins workflow owner/name/cid; the body (below) carries this UTxO's own out-ref, the datum's `terms_hash` and the datum's `task_ref`. FAILURE (1): `payout` to `buyer` and the remainder to the `underwriter` address, and only when `payout <= collateral lovelace - 2_000_000`. SUCCESS (0): all to the `underwriter` address. Any other decision byte, INCONCLUSIVE included, is rejected.
- `Expire`: lower bound >= `decide_by`, signed by the key of the `underwriter` address: collateral back to that address.
Body layout (fixed, 101 bytes): `terms_hash(32) | decision(1: 0 SUCCESS, 1 FAILURE) | coverage_tx_hash(32) | coverage_index(2, big-endian) | task_tx_hash(32) | task_index(2, big-endian)`. The full report is the 109-byte header plus this body, 210 bytes.
Header layout: as CRE `KeystoneForwarder` metadata (see reference `../recourse/onchain/lib/cre.ak` and the Keystone source it cites). Re-implement; do not copy.
Payout outputs are tagged with the coverage out-ref as inline datum, so one output cannot satisfy two coverage UTxOs or a vault in the same tx.
Buyer agent MUST read the coverage datum and refuse the coverage when `payout > collateral - 2 ADA`, `decide_by <= task_expiry + 30 minutes`, `config_digest` differs from the digest of the current config NFT datum, `task_ref` is not the vault it is paying for, `task_expiry` differs from that vault's `expiry`, or `underwriter` or `buyer` is not a key address.

## 7. CRE workflow (adjudication)
HTTP trigger with `{ coverageRef }`. The task, its expiry and the terms come only from the coverage datum on chain, never from the trigger payload. Steps: read the coverage datum via Koios (`task_ref`, `task_expiry`, `decide_by`, `terms_hash`) and the claim_vault datum at `task_ref`; refuse when the vault `expiry` differs from `task_expiry`; read whether the vault was spent, by which tx, its block time, and whether the spending tx paid `beneficiary`; apply exclusions (expiry already passed at lock time, buyer-signed forfeit, chain halt = no blocks in the window); classify SUCCESS (claimed before expiry), FAILURE (forfeited or unspent after expiry, not excluded), INCONCLUSIVE; consensus on the decision byte only (identical aggregation). INCONCLUSIVE and any run after `decide_by` cut no report: the underwriter recovers the collateral through `Expire`. Otherwise build the 101-byte body (coverage out-ref and the datum `task_ref` inside) and `sendReport` to `${relayerUrl}/report`. The relayer submits `Settle` with a validity range inside `[task_expiry, decide_by]`. Deterministic only. No LLM in the decision path.

## 8. Demo task loop (end to end, preprod)
1. Sponsor locks a claim_vault UTxO worth L (demo L = 100 tADA scaled to 10 tADA if funds are short; ratios unchanged), expiry = now + N minutes.
2. Buyer agent calls `/best-route`; router prices A, A+C, B+coverage.
3. If the underwritten route wins: underwriter locks coverage collateral (real UTxO); buyer pays keeper B over x402.
4. Keeper submits `Claim` before expiry (success) or is made to stall (failure demo).
5. Relayer triggers CRE; CRE decides; relayer submits `Settle`; validator pays out or releases.
6. Router ingests the outcome as a new success/failure for that seller; posteriors move.
Every step yields a tx hash confirmed by Koios `tx_status`, shown in the web UI.

## 9. Wallets
Preprod seeds live in `../recourse/.wallets.json` (buyer, seller, relayer, admin1, admin2; read the `seed` field in code only, never print). Map: buyer -> buyer agent, seller -> keeper B, relayer -> relayer + keeper A, admin1 -> underwriter, admin2 -> sponsor / keeper C. Koios bearer key: `KAIOS_KEY` in `../recourse/.env.live`.
