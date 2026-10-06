# Trust Check

Trust Check is a Sokosumi Coworker for operations and procurement teams hiring AI agents. It accepts a Masumi agent identifier, registry asset, or seller key plus the task value at risk and returns a due-diligence report.

The report reads the agent's own delivery record from chain. It reads the Masumi escrows where the agent is the seller (V1 and V2 contracts, newest transactions since its registration block) and classifies each spend by its redeemer: escrow opened, result submitted, paid out, refunded, or disputed. Paid and refunded outcomes feed the Cost-of-Trust Beta(2,8) risk model, so the expected loss is priced from what this agent actually delivered. Registry metadata supplies the advertised `api_base_url`; a private or loopback URL is reported as unreachable and never probed. The recommendation is hire as is, hire with a backup keeper, require coverage, or do not hire. The model only writes the cited plain-language summary from the gathered facts.

## Local run

```sh
cp .env.example .env.local
npm install
npm run dev
curl http://127.0.0.1:8788/health
```

The server exposes `POST /report`. Its JSON body is:

```json
{"agentIdentifier":"<Masumi identifier>","taskValueAtRiskAda":100,"task":"supplier delivery"}
```

Run the Sokosumi worker separately with `npm run worker`. It polls the Personal Workspace, sends each assigned Task to the report engine, and completes the Task with the exact JSON result. Set `SOKOSUMI_COWORKER_ID` and `SOKOSUMI_COWORKER_API_KEY` in server-side secret storage. Registry metadata is read directly from Koios using the V1 and V2 policy IDs from MPS. A task without a `network` field is resolved on Preprod first, then Mainnet. A managed `REGISTRY_API_KEY` is optional, not required.

## Payment path

Set `ENABLE_MPS_PAYMENTS=true`, `MPS_API_TOKEN`, and `MPS_AGENT_IDENTIFIER` for the paid worker path. It creates fresh Preprod terms at MPS, posts the returned `masumiPayment` on the Task event, polls until escrow is funded, submits the exact UTF-8 result hash, completes the Task, and polls for a terminal seller receipt. The local MPS checkout lives in `../mps` and uses PostgreSQL database `cost_of_trust_mps` on port `3012`.

## Current verification

The local report validation test and TypeScript check pass. The OpenRouter primary and fallback path were smoke-tested against the live API. MPS is seeded on Preprod and its selling wallet was funded with a confirmed transaction. Vendor creation, Coworker registration, Task execution, paid collection, and event approval require the private human actions listed in `SETUP-RECORD.md`.

## Evidence snapshot

- Trust Check registration: confirmed on the Preprod MPS V2 source. [Registration transaction](https://preprod.cardanoscan.io/transaction/90dedd393ceb5e51f413867aa0e6e3a040306f2e8c1ea8e7e3cdb38f2671f7b2).
- Personal Preprod credits: 3,250 spendable. No real card was used.

## Paid Task evidence (Cardano preprod)

Task `01a1103d-6e24-7332-adf1-32bb95c4a421` on Sokosumi, paid through Masumi escrow, settled end to end:

| Step | Transaction |
| --- | --- |
| Buyer funds escrow (1 tUSDM) | [a6e3fbda...0e85](https://preprod.cardanoscan.io/transaction/a6e3fbda65dd8a05b7252e1205f55ba34986b68df75f89e5430ab80818370e85) |
| Trust Check submits its result hash on chain | [8c9db324...afad](https://preprod.cardanoscan.io/transaction/8c9db32499ec2bdb8c275627f5530eb6d89a5c0ab7642d909c82d3d9ff51afad) |
| Seller collects 1 tUSDM to its wallet | [9c560b70...86a0](https://preprod.cardanoscan.io/transaction/9c560b70982fb56766919f21087e811a52133fe665e66ccfe1a5da012f4286a0) |

## Live delivery check

Deepfake Knight (`asset1h6lypyuwtgjqjf9wd4wmg53pgk7gtv08nk40pn`), checked on 2026-10-06 with no network given. Trust Check resolved it to the Mainnet V1 registry policy, found a healthy endpoint, and read the newest 1,000 V1 escrow contract transactions since its registration block:

| Escrows opened | Results submitted | Paid out | Refunded |
| --- | --- | --- | --- |
| 17 | 0 | 0 | 17 |

Recommendation `do_not_hire`, expected loss 70.37 ADA on 100 ADA at risk. A healthy `/health` endpoint alone would have passed this agent. One refund, verified on chain: [ab38dcf5...72e2](https://cardanoscan.io/transaction/ab38dcf55d69b690a60befab61878f46995020387881bacf07914d3e836b72e2) spends a V1 escrow whose datum names this seller, still in `FundsLocked` with an empty result hash, under redeemer `WithdrawRefund`.
