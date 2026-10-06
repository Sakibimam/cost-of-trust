# Cost of Trust

Your AI agent prices who to trust before it spends: the cheapest keeper is not the cheapest route.

Cost of Trust is a Cardano preprod routing layer for deadline work. The router compares seller price, observed delivery history, correlated failure, buyer risk tolerance, staggered keepers, and coverage before an agent pays over x402.

## Cardano mechanism

The default protection is a staggered keeper schedule enforced by validity intervals.

Keeper A has the first slot and keeper B has the late slot. One claim-vault UTxO means one spend and one winner. The chain pays the keeper whose slot lands, and the unused fee returns to the sponsor.

Coverage collateral is released only by a CRE report that the Plutus V3 validator verifies itself. The validator binds the report to the coverage UTxO, task, terms, workflow metadata, DON digest, and validity window, then requires f+1 distinct allowlisted secp256k1 signatures. A flipped report byte is rejected by the validator test suite.

Pre-screen: preprod contracts are the config lock, claim vault, and coverage addresses below; the 2x2 map is independent versus shared infrastructure across risk aversion 0, 0.25, 0.5, and 1; confirmed run evidence links the transactions recorded by the buyer.

## Completed preprod runs

Four completed runs exercise the underwritten and fallback paths. Each transaction is confirmed on Cardano preprod and linked for inspection.

| Run | Path | Confirmed transactions |
| --- | --- | --- |
| 2026-10-06 04:12:36Z | underwritten seller-b claim and coverage settlement | [claim](https://preprod.cardanoscan.io/transaction/a55009e5c4b602ed4d18f798a5827f70b12d358fa2a0eaf85d41affdc5647392), [settlement](https://preprod.cardanoscan.io/transaction/5f44c119aba938848be23a20abd542f473cc4c6447b5e41e2450c032473d10ff) |
| 2026-10-06 04:23:09Z | expired claim-vault forfeit and coverage settlement | [forfeit](https://preprod.cardanoscan.io/transaction/2ea81cf20fc0fb52f876a7eea0605b10add9b1743d62a7868a6993e7a1c98a6c), [settlement](https://preprod.cardanoscan.io/transaction/54c5eb596f9d351f4c73e74790e52ac30dc5fbe61b6d1a6bf6d9972b895af761) |
| 2026-10-06 04:40:21Z | fallback seller-a claim | [claim](https://preprod.cardanoscan.io/transaction/4838b4c2cfa07a7c7198a7ced989214cb43bde74073cdb329fa506deece6bee0) |
| 2026-10-06 04:45:57Z | underwritten seller-b claim and coverage settlement | [claim](https://preprod.cardanoscan.io/transaction/4afb027dfc182ac65b854bcdb4bee0eb07775fe194edf49cef1c7b98060a775f), [settlement](https://preprod.cardanoscan.io/transaction/3c20440b7419f5c8da18910af0c6fd2b8a40dae0b4d22cacccf8ef0fddf41abb) |

The router ingests seller outcomes through `POST /ingest` only after Koios `tx_status` reports at least one confirmation. The measured provider table is in [`docs/GTM.md`](docs/GTM.md), and the Trust Check Coworker report path is in [`coworker/README.md`](coworker/README.md).

## CRE report path

The CRE workflow's decision body is signed by the config-pinned signer set in [`agents/attest.ts`](agents/attest.ts). The local simulator keys rotate per run, so the test path re-wraps the workflow decision with the signer set pinned by the preprod config NFT. The production path is a deployed DON with its signer set recorded in a fresh config NFT.

## Preprod deployment

| Contract | Address |
| --- | --- |
| Config lock | [`addr_test1wr7zqpcdrefhjsp6m44vhammyvajlqjqsgwps7ees5jau2q8gr5av`](https://preprod.cardanoscan.io/address/addr_test1wr7zqpcdrefhjsp6m44vhammyvajlqjqsgwps7ees5jau2q8gr5av) |
| Claim vault | [`addr_test1wpvyupyu5rclc55v8j342y295mc8f6wdc434ansa7j64vwc2mvcle`](https://preprod.cardanoscan.io/address/addr_test1wpvyupyu5rclc55v8j342y295mc8f6wdc434ansa7j64vwc2mvcle) |
| Coverage | [`addr_test1wqzezvaj9mg39pdfg8hakgx7r5hkr8fra9xcqk7whre7ams7d25s9`](https://preprod.cardanoscan.io/address/addr_test1wqzezvaj9mg39pdfg8hakgx7r5hkr8fra9xcqk7whre7ams7d25s9) |

Config policy: `5834a137e2612283f02c2b9942372d081cac914bd7528eea56c9ac18`.

## Selection map

The buyer’s risk appetite and keeper infrastructure determine the route.

| Buyer risk aversion | Independent keepers | Shared infrastructure |
| --- | --- | --- |
| 0, can absorb loss | Staggered A > B, 11.10 ADA | Staggered A > B, 18.24 ADA |
| 0.25 | Staggered A > B, 15.36 ADA | Staggered B > A, 25.75 ADA |
| 0.5, treasury needs tail protection | Staggered A > B, 19.63 ADA | Underwritten B, 29.60 ADA |
| 1 | Staggered B > A, 27.71 ADA | Underwritten B, 37.00 ADA |

The router returns every eligible route with expected loss, standard deviation, premium, arithmetic, and risk-adjusted cost. It selects the minimum risk-adjusted cost.

## Confirmed preprod run evidence

Each row below is copied from an `agents/runs/*.json` record whose transaction record has `confirmed: true`.

| Run | Step | Confirmed transaction |
| --- | --- | --- |
| 2026-10-05 22:00:29Z | claim-vault lock | [`95a81257...e90640`](https://preprod.cardanoscan.io/transaction/95a8125734447b219154688e5a51ecb3ec11937ec4ac7e71ecdf67aab9e90640) |
| 2026-10-05 23:56:23Z | claim-vault lock | [`83ba9c15...6d8fbd`](https://preprod.cardanoscan.io/transaction/83ba9c155047eb78e459b536aef437aab73a69283404babbaeca7f1596b8dfbd) |
| 2026-10-06 01:42:38Z | claim-vault lock | [`870f8f61...c3c120`](https://preprod.cardanoscan.io/transaction/870f8f61ff56a4228f2392cc5996965056ed906c0a9948b2a1f2f1a04c3c1208) |
| 2026-10-06 01:43:39Z | claim-vault lock | [`e1d1190e...912fad`](https://preprod.cardanoscan.io/transaction/e1d1190e8e9953c31c67cfd03619aeb78afdfe1ceca7634f4110d6a14912fad1) |
| 2026-10-06 01:46:11Z | claim-vault lock | [`e4a5e294...ba4b2`](https://preprod.cardanoscan.io/transaction/e4a5e294b64502de656fee1900d9da425ec68ccc1c4fa929d18b754cabcba4b2) |
| 2026-10-06 01:50:16Z | claim-vault lock | [`dea55a02...45bd5`](https://preprod.cardanoscan.io/transaction/dea55a0248a57a89c0923cb8e02d8ca9929d4618c7d3ac4e1a8e90c6e5345bd5) |

These confirmed transactions show the live buyer flow creating a deadline vault on Cardano preprod. The router also records the chosen route and its terms hash in each run record.

## Masumi and Cost of Trust

| Masumi | Cost of Trust |
| --- | --- |
| Answers: should this payment happen, and can it be refunded? | Answers: which counterparty and which protection route, at what price? |
| Escrow, identity, reputation, and discovery | Risk-priced routing over seller histories and infrastructure correlation |
| Payment execution policy | Counterparty selection before payment |

Cost of Trust uses Masumi MIP-003-compatible keeper services and x402 v2 Cardano exact payments. It adds the decision layer before the payment.

## How to run

Load the Koios environment from the sibling `recourse` project, then start each service in its own terminal:

```sh
(cd ../router && PORT=8787 bun src/server.ts)
cd agents
PORT=4110 bun underwriter.ts
PORT=4111 bun relayer.ts
SELLER_ID=seller-a PORT=4101 bun keeper.ts
SELLER_ID=seller-b PORT=4102 bun keeper.ts
SELLER_ID=seller-c PORT=4103 bun keeper.ts
BUYER_RISK_AVERSION=0.25 SHARED_INFRA=true bun buyer.ts
```

The web route board runs from `web/`. Keeper services expose the MIP-003 availability, input schema, start-job, and status endpoints. x402 uses the Cardano exact default transfer method on preprod.

## Checks

```sh
(cd onchain && aiken check)
(cd router && bun test)
(cd cre/cot-adjudicator && bun test)
```

The on-chain suite reports 78 checks passed, and the router and CRE suites cover route arithmetic, report construction, and decision rules.
