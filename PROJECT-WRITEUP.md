# Cost of Trust: project write-up

Live: https://cost-of-trust.vercel.app · Sokosumi Coworker: Trust Check (`01a10fcf-eed2-75ed-a385-a979349eeb93`) · Paid API: `POST /api/x402/trust-check`

## The problem

AI agents on Cardano now hire other AI agents. A buyer agent finds a seller in the Masumi registry, locks ADA in a Masumi escrow, and waits for the result. If the seller never delivers, Masumi refunds the fee.

The fee is rarely what the buyer loses, though. An agent hired to research a company before a 15 minute meeting, or to check a contract before a trade closes, is worth far more than its invoice when the deadline matters. A refund arrives after the deadline has passed. The buyer gets its 2 ADA back and still loses the 100 ADA job the result was for.

Today a buyer picks an agent by name or by dispute count and hopes. Dispute count is the signal most people reach for, and on Masumi mainnet it is close to useless: the agent called Knight has zero disputes and 251 refunds out of 293 escrows. A dispute filter hires it every time.

Cost of Trust answers the question a buyer actually has before it pays: should I hire this agent for this job, and if so, how should I buy it?

## What it does

Trust Check reads an agent's full escrow history from Cardano (paid, refunded, disputed, and how long each result took), checks that the agent's API is answering right now, and prices four ways to buy the job against the value the buyer has at risk:

| Way to buy | What happens |
| --- | --- |
| Hire it alone | One agent, one escrow. Cheapest when the agent is reliable and the deadline is loose. |
| Hire two at once | Two agents are paid up front. Costs more, and one of them is likely to deliver. |
| Hire one, keep a backup | A backup agent is paid only if the first misses its checkpoint. Cardano lets only one of them claim. |
| Hire alone, with cover | An underwriter locks collateral and pays the buyer if the job fails. |

The answer comes back in plain words. Three live examples from the production page:

- Knight, 100 ADA at risk: do not hire. 42 of 293 past jobs delivered.
- dpa Research Agent, 100 ADA, due in 15 minutes: do not hire. 175 paid, 51 refunded. This is the answer the Trust Check Coworker gave inside Sokosumi on task `01a115b5`.
- Company Researcher (Bansumi), 100 ADA, due in 1 minute: hire it with a backup. 199 paid, 42 refunded, API answering, expected cost 4.12 ADA.

### Measured on Masumi mainnet

We replayed 433 resolved Masumi mainnet escrows (15 Sep to 6 Oct 2026) walk-forward, so each decision only sees escrows that had already resolved. The model's prior is fitted on the first half and scored on the 277 jobs after it.

| At 100 ADA at risk | Jobs done | Cost per 100 jobs |
| --- | ---: | ---: |
| Hire the requested agent alone | 88.7% | 918.73 ADA |
| Cost of Trust | 91.3% | 866.43 ADA |

As a forecast of whether the next job fails, Trust Check scores a Brier of 0.062 against 0.092 for the dispute rate across 283 observations (lower is better). The backtest source is `backtest/run.ts` and the published numbers are `web/src/data/backtest.json`.

## Technical approach

### Reading the truth from Cardano

Every input comes from chain state, not from a seller's own claims.

- Registry: Masumi registry entries are NFTs under two mainnet policies. Trust Check resolves an agent by name or asset id through Koios (`/asset_info`, `/policy_asset_list`) and reads its advertised API URL and price from the NFT metadata.
- Escrow history: each Masumi escrow is a UTxO at the payment contract. The escrow indexer walks those transactions, decodes the datum and redeemer, and classifies each job as paid, refunded or disputed, with the time from lock to result. The index for 186 named agents ships with the site so the free preview needs no chain call.
- Liveness: the agent's MIP-003 `/availability` endpoint is called at check time. An agent whose API is down is never hired, whatever its history says.

### Pricing

Each agent's failure probability is a beta-binomial posterior over its own paid and refunded escrows, with a prior calibrated on held-out mainnet data. The router (`router/src/routes.ts`) prices every route as

`risk-adjusted cost = fees + premium + expected loss + risk aversion × loss standard deviation`

and returns all four routes, the arithmetic behind each, and the chosen one. One `decide()` function (`coworker/src/report.ts`) produces the verdict for the free web preview, the paid x402 report, the Sokosumi Coworker and the pitch deck, so every surface gives the same answer.

### Settlement on Cardano (preprod)

The backup and coverage routes are enforced on chain, not promised in a dashboard.

- Backup paid only if needed. A claim-vault UTxO, written in Aiken and compiled to Plutus V3, holds the job. Keeper A may claim in the first validity window. Keeper B may claim only after the checkpoint and only if the vault is still unspent. Because a UTxO can be spent once, the ledger itself refuses the second claim (`BadInputsUTxO`). We ran both paths: A delivers and B is never paid; A stalls and B is paid at the checkpoint and claims.
- Backup through Masumi itself. Agent A was hired through Masumi escrow (`5d70db26`) and stalled. At the checkpoint Trust Check hired agent B through a second escrow (`d9b06473`). B's result landed on chain (`7934f7a0`) before the buyer's deadline, and A's escrow was refunded and the refund withdrawn (`f6445aa1`).
- Coverage settled by a signed report. An underwriter locks collateral in a coverage UTxO. A Chainlink CRE workflow observes the task through Koios and signs the outcome. The Plutus V3 validator checks f+1 secp256k1 signatures from an allowlisted signer set pinned in a config NFT, the workflow identity, the task and terms binding, and the settlement window, then pays the buyer on FAILURE or the underwriter on SUCCESS. A report with the outcome flipped is rejected on chain; the valid one settled in `3e33929d`.

### How agents pay for it

- x402 on Cardano. `POST /api/x402/trust-check` answers `402 Payment Required` with a 1 ADA Cardano preprod `exact` requirement. The buyer signs, retries, and receives the report. The facilitator verifies and settles the payment on chain (`1e6a571a`), and replaying the same payment returns HTTP 409.
- Masumi and Sokosumi. Trust Check is a Sokosumi Coworker backed by a Masumi payment service. A paid task goes through the full escrow cycle: escrow locked (`be70aa09`), result submitted on chain (`0be9fa22`), payment collected by the seller (`6b8bab2e`) on task `01a11153`.
- Agent to agent. A Coworker-style buyer agent pays Trust Check over x402 for each candidate before it sub-hires. In the live run it refused dpa Research Agent, Knight and YouTube Channel Analysis, and hired Organization Analysis. All five Trust Check payments are confirmed on preprod.

### Tools and infrastructure

| Layer | Technology |
| --- | --- |
| Smart contracts | Aiken 1.1.19, Plutus V3, Aiken stdlib 3.0.0 |
| Transactions | Lucid Evolution |
| Chain reads | Koios (mainnet and preprod) |
| Agent marketplace | Masumi registry, Masumi payment service (MIP-003), Sokosumi Coworkers |
| Agent payments | x402 v2 with `@x402/cardano` and `@x402/core` |
| Adjudication | Chainlink CRE TypeScript workflow, secp256k1 report signatures |
| Services | Bun and TypeScript |
| Web | Next.js on Vercel (site, free preview API, paid x402 API, deck) |
| Coworker worker | Node on Fly.io, polling Sokosumi and the Masumi payment service |

## Deploying and scaling it in the real world

Who runs it. Any buyer agent can call Trust Check before it pays: over x402 for one call at a time, or as a Sokosumi Coworker for humans and agents that already work there. A marketplace can also run it as a pre-hire step inside its own checkout, so every buyer gets the answer without integrating anything.

Cost of a check. A check is a handful of indexed reads and one HTTP probe. The escrow index is built offline and refreshed on a schedule, so the hot path is a lookup plus the live `/availability` call; the free preview answers in about 1 to 1.5 seconds on production. Pricing runs in memory. Nothing in the check path writes to chain, so throughput scales with ordinary stateless web servers.

Where the chain is used. Only the parts that move money touch Cardano: the escrow, the claim vault, and the coverage UTxO. Each job is bounded to one vault input, one coverage input, one report and one settlement path, so on-chain cost per job stays flat as volume grows. The EUTXO model is what makes the backup safe without a coordinator: two keepers can race, and the ledger guarantees exactly one wins.

Moving to mainnet. The contracts, the Masumi integration and the x402 flow run on preprod today and read mainnet history already. Going live means minting the config NFT on mainnet with a production CRE DON's signer set, pointing the Masumi payment service at mainnet, and switching the x402 network id. The decision logic does not change.

Getting better with use. Every hire Trust Check routes produces a new escrow outcome, which feeds back into the next agent's history. The more buyers check before they pay, the sharper the forecast gets, and the clearer it becomes to sellers that delivering on time is what gets them hired.
