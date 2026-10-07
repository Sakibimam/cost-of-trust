# BuilderBase

## Name

Cost of Trust

## Tracks

- Cardano Agentic Commerce: Risk-priced agent routes where a Cardano claim vault gives one keeper the job and a backup is paid only when the first keeper misses its checkpoint.
- Chainlink CRE: A Plutus V3 coverage validator settles only on a CRE report bound to the coverage UTxO, and rejects the same report with the decision byte flipped.
- Main: A live route board turns Masumi mainnet escrow history, Cardano execution, CRE settlement, and a paid x402 Trust Check into one purchase decision made before an agent pays.

## 150-word write-up

Cost of Trust lets agents buy reliability, not just access. Before an autonomous buyer pays a keeper, the router compares a single seller, redundant execution, a staggered backup, and underwritten coverage. It prices seller history, failure probability, infrastructure correlation, buyer risk aversion, and protection, then returns the arithmetic and a terms hash. The board shows a Masumi registry agent with four purchase routes and the Knight record, where zero disputes hide fifteen refunded escrows. On Cardano preprod, a staggered route pays the backup only after the first keeper misses its checkpoint, and one claim vault gives the first valid claim the job. Chainlink CRE carries the external outcome into a Plutus V3 coverage validator that rejects a flipped report. Trust Check adds the paid counterparty decision through Sokosumi and Masumi escrow, and x402 carries the request. A held-out mainnet backtest scores calibration: Brier 0.063 against 0.092 for dispute rate.

## Stack

Cardano preprod, Aiken and Plutus V3 validators, Bun and TypeScript, Next.js, Koios, Masumi registry and escrow, Sokosumi, x402 Cardano exact payments, and Chainlink CRE SDK.

## Live links

- Live app: https://cost-of-trust.vercel.app/
- Thesis: https://cost-of-trust.vercel.app/thesis
- Deck: https://cost-of-trust.vercel.app/deck
- Trust Check over x402: `POST https://cost-of-trust.vercel.app/api/x402/trust-check` with `{"agentName":"dpa Research Agent","taskValueAtRiskAda":100}` returns `402` with a Cardano preprod `exact` requirement of 1 ADA; a paid retry returns the due-diligence report.
- Sokosumi Coworker: `01a10fcf-eed2-75ed-a385-a979349eeb93`
- Demo script: [`docs/DEMO-SCRIPT.md`](DEMO-SCRIPT.md)

## Mainnet measurement

Held-out walk-forward backtest over 433 resolved Masumi mainnet escrows and 283 eligible decisions, 15 Sep to 6 Oct 2026 (`web/src/data/backtest.json`, definitions in `backtest/README.md`). At 100 ADA at risk, per 100 jobs:

| Policy | Jobs done | Cost |
| --- | ---: | ---: |
| Hire alone, always | 88.7% | 918.73 ADA |
| Skip above 5% dispute rate | 88.7% | 918.73 ADA |
| Skip above 20% refund plus dispute rate | 91.2% | 671.38 ADA |
| Cost of Trust: route to the best agent, backup when it pays | 91.3% | 866.43 ADA |

Trust Check Brier score 0.063 against 0.092 for the dispute rate across 283 observations. Cost of Trust uses 249 observed and 26 modelled backup legs at this risk level.

## Transaction evidence

Every transaction below returned a confirmed record from Koios preprod `tx_status` on 2026-10-07.

| Evidence | Block | Transaction |
| --- | ---: | --- |
| Keeper A claim-vault lock | 5262744 | [502926e99d...d85325a5](https://preprod.cardanoscan.io/transaction/502926e99ddd2f6dd15478ec1994d62ed4bded94936752c0a36fa80ad85325a5) |
| Keeper A payment | 5262746 | [314faaa5dc...8ca91f89](https://preprod.cardanoscan.io/transaction/314faaa5dc8c69f75bc53557c43f9832ce6bc833ee7bf80f835ee2dc8ca91f89) |
| Keeper A claim, backup unpaid | 5262747 | [8650e923c2...6b188cb1](https://preprod.cardanoscan.io/transaction/8650e923c2e2fcc0684976a062079c6cea4a3fa809e1f14db1f64cf96b188cb1) |
| Keeper A stalled lock | 5262764 | [4488de11cf...8166958d](https://preprod.cardanoscan.io/transaction/4488de11cf15ccd060bbf93be00611ca300e820b75afca8b03a6333d8166958d) |
| Keeper A stalled payment | 5262766 | [791e0480e5...9a837cee](https://preprod.cardanoscan.io/transaction/791e0480e5a14165a363adb36bd10d283dde7dfd40b16f276f31352e9a837cee) |
| Backup checkpoint payment | 5262772 | [ae6d7761d8...c0391810](https://preprod.cardanoscan.io/transaction/ae6d7761d845ccff08ac29ff7ecd9beecac9ca34fbea3969ea2eb9c0c0391810) |
| Keeper B claim after stall | 5262775 | [2851e9b2df...3aec638b](https://preprod.cardanoscan.io/transaction/2851e9b2df9bfabb621376f446b2dc2fd79944540b7a415cc3140ee63aec638b) |
| CRE coverage settlement | 5263020 | [3e33929dbf...8526ff1b](https://preprod.cardanoscan.io/transaction/3e33929dbf296722029680f3ff26676da5b420ebe4e4e34265b9992a8526ff1b) |
| Trust Check escrow | 5260681 | [be70aa0963...b7f08892](https://preprod.cardanoscan.io/transaction/be70aa09631cb3a7bda74bd09b91fa5d837e9408e2f889c80a71ce0bb7f08892) |
| Trust Check result | 5260711 | [0be9fa229a...de573f91](https://preprod.cardanoscan.io/transaction/0be9fa229a864ddbaa8847afa84657d535d93d4a26fdbab506e2a2ebde573f91) |
| Trust Check collection | 5260932 | [6b8bab2e1f...18108630](https://preprod.cardanoscan.io/transaction/6b8bab2e1f143467ba52001d928eade55ee71b9540b768d5870e9aaa18108630) |
| x402 Trust Check payment | 5263099 | [1e6a571ab3...1d74b70d](https://preprod.cardanoscan.io/transaction/1e6a571ab3546c04eae4f15922b4667b9dc000fa543971308952f8321d74b70d) |
| Masumi stall run, A escrow lock | n/a | [5d70db26db...3d9518d8](https://preprod.cardanoscan.io/transaction/5d70db26db11b4e7e3711ce11febef7031b790f710e23c10927ff4ab3d9518d8) |
| Masumi stall run, backup B escrow lock | n/a | [d9b0647330...ab74c63e](https://preprod.cardanoscan.io/transaction/d9b06473307dbf9c056bc51a66637d5af2e153c63b770d4650434967ab74c63e) |
| Masumi stall run, B result submitted | n/a | [7934f7a085...62189fdf](https://preprod.cardanoscan.io/transaction/7934f7a085a4c491469994f6c7964f601219487cb6888bcefebce05862189fdf) |
| Masumi stall run, A refund requested | n/a | [b6dde9c133...ae04ab5a](https://preprod.cardanoscan.io/transaction/b6dde9c1337932dcc5fd28713cf832ccb2788c9a374a55791791da40ae04ab5a) |
| Masumi stall run, A refund withdrawn | n/a | [f6445aa1b4...06ae9db8](https://preprod.cardanoscan.io/transaction/f6445aa1b4a1eae1f69516d215763fe6e4cf20e8d6e4cb94340bd9e206ae9db8) |

The five Masumi stall run transactions were read from Koios preprod `tx_status` on 2026-10-07 (run file `agents/runs/2026-10-07T07-36-20Z-masumi-backup-stall-final.json`): the first agent stalled, the backup delivered 5 min 12 s before the buyer deadline, and the first agent was refunded.
