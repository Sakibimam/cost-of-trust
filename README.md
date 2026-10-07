# Cost of Trust

Agents can buy reliability, not just access.

Live: https://cost-of-trust.vercel.app/

Cost of Trust does not rank agents. Most Masumi registry capabilities have one or two agents, so a ranking has nothing to choose between. The buyer still has a decision: how to pay for this job. For one registry agent, Trust Check prices four purchases from that agent's own on-chain escrow outcomes (paid, refunded, disputed, results submitted before or after the escrow deadline) and the value at risk: hire it alone, hire it with a backup that is paid only if it misses a checkpoint, hire it plus a backup up front, or hire it with coverage.

- Live mainnet example (`web/src/data/showcase.json`): dpa Research Agent, 13 paid escrows, 0 refunds, a median 109 s from escrow to result. At 5 ADA at risk: hire it alone. At 100 and 500 ADA: hire it with a backup.
- The agent named Knight has 0 disputes, so a dispute rate ranks it as flawless; all 15 of its escrows ended in refunds. Trust Check answers do not hire.
- The backup is paid only if it is needed, executed on preprod: keeper A delivers and keeper B is never paid ([8650e923c2...](https://preprod.cardanoscan.io/transaction/8650e923c2e2fcc0684976a062079c6cea4a3fa809e1f14db1f64cf96b188cb1)); keeper A stalls, the vault is still unspent at the checkpoint, keeper B is paid and claims ([2851e9b2df...](https://preprod.cardanoscan.io/transaction/2851e9b2df9bfabb621376f446b2dc2fd79944540b7a415cc3140ee63aec638b)).
- Held-out Masumi mainnet backtest (`web/src/data/backtest.json`): 433 resolved escrows and 283 eligible decisions, 15 Sep to 6 Oct 2026. At 100 ADA at risk, a refund-plus-dispute threshold completes 93.3% of jobs at 671.38 ADA per 100 jobs against 918.73 ADA for hiring alone, and a dispute-only threshold skips no job. Trust Check scores a Brier of 0.063 against 0.092 for the dispute rate. The live board lists all four policies with observed and modelled backup legs separated.

Demo moment: two keepers race for one claim UTxO, keeper A claims and keeper B is rejected by Cardano with `BadInputsUTxO`; then the CRE workflow settles coverage and Trust Check returns a paid counterparty decision.

- Race lock: [c0c104a07e...f814](https://preprod.cardanoscan.io/transaction/c0c104a07e8a375982ba72f0a7d0f949a2dbd194a69eb171d9ca375d7e60f814)
- Winning claim: [43b27058c9...de9b](https://preprod.cardanoscan.io/transaction/43b27058c91abc30ff560251cc7997a0ca0343df4432319c265b4f140163de9b)
- CRE settlement: [3e33929dbf...ff1b](https://preprod.cardanoscan.io/transaction/3e33929dbf296722029680f3ff26676da5b420ebe4e4e34265b9992a8526ff1b)
- Trust Check result: [0be9fa229a...3f91](https://preprod.cardanoscan.io/transaction/0be9fa229a864ddbaa8847afa84657d535d93d4a26fdbab506e2a2ebde573f91)

## How to run

```sh
(cd ../router && PORT=8787 bun src/server.ts)
cd agents
PORT=4110 bun underwriter.ts
PORT=4111 bun relayer.ts
SELLER_ID=seller-a PORT=4101 bun keeper.ts
SELLER_ID=seller-b PORT=4102 bun keeper.ts
SELLER_ID=seller-c PORT=4103 bun keeper.ts
BUYER_RISK_AVERSION=0.25 SHARED_INFRA=false bun buyer.ts
```

The web route board runs from `web/`. Keeper services expose MIP-003 availability, input schema, start-job, and status endpoints. x402 uses Cardano exact payments on preprod.

## What it does

Cost of Trust is a Cardano execution router for autonomous agents with deadline work. Before payment, it prices seller history, failure risk, infrastructure correlation, and protection. It returns the cheapest successful outcome across single, redundant, staggered, and underwritten routes.

The live page presents the product in three proof sections: the keeper race, CRE settlement, and Trust Check.

## Cardano mechanism

The claim vault enforces one claim before expiry. A sponsor refund is available after expiry when the claim is not taken. The preprod race used redundant execution against the same claim UTxO. Keeper A consumed it first, and the ledger rejected keeper B with `BadInputsUTxO`.

Coverage collateral is released only by a CRE report that the Plutus V3 validator verifies. The validator binds the report to the coverage UTxO, task, terms, workflow metadata, DON digest, and validity window, then requires the configured signer threshold.

## Confirmed preprod evidence

### Keeper race

| Step | Evidence |
| --- | --- |
| Claim vault lock | [c0c104a07e...f814](https://preprod.cardanoscan.io/transaction/c0c104a07e8a375982ba72f0a7d0f949a2dbd194a69eb171d9ca375d7e60f814) |
| Keeper A payment | [e458925a99...9cac](https://preprod.cardanoscan.io/transaction/e458925a99e85fe742b0f0a2a1dbf1dfc8ece3724752a8862227e27c89309cac) |
| Keeper A claim | [43b27058c9...de9b](https://preprod.cardanoscan.io/transaction/43b27058c91abc30ff560251cc7997a0ca0343df4432319c265b4f140163de9b) |
| Keeper B payment | [aa40b41742...354a](https://preprod.cardanoscan.io/transaction/aa40b41742f98be7520e3003fc49e11266cab049dcabdafa59677a6042b9354a) |
| Keeper B claim | Rejected by the ledger with `BadInputsUTxO`; no transaction was confirmed. |

### CRE settlement

| Step | Evidence |
| --- | --- |
| Claim vault lock | [296257f15d...a239](https://preprod.cardanoscan.io/transaction/296257f15d00134b30b9c18360cd216acf3b445eb39df352d4e70e31d47da239) |
| Coverage lock | [0646c8af88...bcf9](https://preprod.cardanoscan.io/transaction/0646c8af88359bb10b13fdddc67dcc4258f54efa59572ddd84564be69099bcf9) |
| Seller payment | [44df00ebd0...fe71](https://preprod.cardanoscan.io/transaction/44df00ebd0ccd9f48a6341b3f9f35c5c9e5ce0d7be61020d971159067eaefe71) |
| Seller claim | [4afb027d...775f](https://preprod.cardanoscan.io/transaction/4afb027dfc182ac65b854bcdb4bee0eb07775fe194edf49cef1c7b98060a775f) |
| CRE coverage settlement | [3e33929dbf...ff1b](https://preprod.cardanoscan.io/transaction/3e33929dbf296722029680f3ff26676da5b420ebe4e4e34265b9992a8526ff1b) |

### Trust Check

| Step | Evidence |
| --- | --- |
| Masumi escrow | [be70aa0963...8892](https://preprod.cardanoscan.io/transaction/be70aa09631cb3a7bda74bd09b91fa5d837e9408e2f889c80a71ce0bb7f08892) |
| Trust Check result hash | [0be9fa229a...3f91](https://preprod.cardanoscan.io/transaction/0be9fa229a864ddbaa8847afa84657d535d93d4a26fdbab506e2a2ebde573f91) |
| Seller collection | [6b8bab2e1f...8630](https://preprod.cardanoscan.io/transaction/6b8bab2e1f143467ba52001d928eade55ee71b9540b768d5870e9aaa18108630) |

## CRE report path

The CRE workflow's decision body is signed by the configured signer set in [`agents/attest.ts`](agents/attest.ts). The workflow reads the claim and coverage state, creates a signed adjudication report, and the Cardano validator checks the report binding before settlement.

## Preprod deployment

| Contract | Address |
| --- | --- |
| Config lock | [`addr_test1wr7zqpcdrefhjsp6m44vhammyvajlqjqsgwps7ees5jau2q8gr5av`](https://preprod.cardanoscan.io/address/addr_test1wr7zqpcdrefhjsp6m44vhammyvajlqjqsgwps7ees5jau2q8gr5av) |
| Claim vault | [`addr_test1wpvyupyu5rclc55v8j342y295mc8f6wdc434ansa7j64vwc2mvcle`](https://preprod.cardanoscan.io/address/addr_test1wpvyupyu5rclc55v8j342y295mc8f6wdc434ansa7j64vwc2mvcle) |
| Coverage | [`addr_test1wqzezvaj9mg39pdfg8hakgx7r5hkr8fra9xcqk7whre7ams7d25s9`](https://preprod.cardanoscan.io/address/addr_test1wqzezvaj9mg39pdfg8hakgx7r5hkr8fra9xcqk7whre7ams7d25s9) |

Config policy: `5834a137e2612283f02c2b9942372d081cac914bd7528eea56c9ac18`.

## Selection map

The buyer's risk appetite and keeper infrastructure determine the route.

| Buyer risk aversion | Independent keepers | Shared infrastructure |
| --- | --- | --- |
| 0 | Staggered A > B, 10.82 ADA | Staggered A > B, 17.70 ADA |
| 0.25 | Staggered A > B, 14.89 ADA | Underwritten B, 23.70 ADA |
| 0.5 | Staggered A > B, 18.96 ADA | Underwritten B, 25.20 ADA |
| 1 | Staggered B > A, 26.98 ADA | Underwritten B, 28.20 ADA |

The router returns each eligible route with expected loss, standard deviation, premium, arithmetic, and risk-adjusted cost. It selects the minimum risk-adjusted cost.

## Masumi and Cost of Trust

| Masumi | Cost of Trust |
| --- | --- |
| Escrow, identity, reputation, and discovery | Risk-priced routing over seller histories and infrastructure correlation |
| Payment execution policy | Counterparty selection and protection route before payment |

Cost of Trust uses Masumi-compatible keeper services and x402 v2 Cardano exact payments. It adds the route decision before payment.

## Checks

```sh
(cd onchain && aiken check)
(cd router && bun test)
(cd cre/cot-adjudicator && bun test)
```

Run the integrated proof flow with:

```sh
bash scripts/judge-demo.sh
```
