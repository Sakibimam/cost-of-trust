# Trust Check

Trust Check is a Sokosumi Coworker for operations and procurement teams hiring AI agents. It accepts a Masumi agent identifier, registry asset, or seller key plus the task value at risk and returns a due-diligence report.

The report gathers live registry metadata, Masumi escrow history from Koios, endpoint availability and health, and the Cost-of-Trust router quote. It recommends hiring as is, hiring with a backup keeper, requiring coverage, or not hiring. Missing upstream data stays marked unavailable. The model only writes the cited plain-language summary from the gathered facts.

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

Run the Sokosumi worker separately with `npm run worker`. It polls the Personal Workspace, sends each assigned Task to the report engine, and completes the Task with the exact JSON result. Set `SOKOSUMI_COWORKER_ID` and `SOKOSUMI_COWORKER_API_KEY` in server-side secret storage. Registry metadata is read directly from Koios using the Preprod V1 and V2 policy IDs from MPS. A managed `REGISTRY_API_KEY` is optional, not required.

## Payment path

Set `ENABLE_MPS_PAYMENTS=true`, `MPS_API_TOKEN`, and `MPS_AGENT_IDENTIFIER` for the paid worker path. It creates fresh Preprod terms at MPS, posts the returned `masumiPayment` on the Task event, polls until escrow is funded, submits the exact UTF-8 result hash, completes the Task, and polls for a terminal seller receipt. The local MPS checkout lives in `../mps` and uses PostgreSQL database `cost_of_trust_mps` on port `3012`.

## Current verification

The local report validation test and TypeScript check pass. The OpenRouter primary and fallback path were smoke-tested against the live API. MPS is seeded on Preprod and its selling wallet was funded with a confirmed transaction. Vendor creation, Coworker registration, Task execution, paid collection, and event approval require the private human actions listed in `SETUP-RECORD.md`.

## Evidence snapshot

- Personal Preprod credits: 3,250 spendable. No real card was used.
- Trust Check registration: confirmed on the local Preprod MPS V2 source. [Registration transaction](https://preprod.cardanoscan.io/transaction/90dedd393ceb5e51f413867aa0e6e3a040306f2e8c1ea8e7e3cdb38f2671f7b2).
- Paid Task: `01a1102c-8866-753d-a715-f1d8fadd85d0`, charged 100 credits and currently RUNNING while escrow funding is pending.
- Seller input: Deepfake Knight V1 registry asset `asset1h6lypyuwtgjqjf9wd4wmg53pgk7gtv08nk40pn`.
- Escrow, result-hash, and collection transactions: no confirmed hashes yet.
- TOKEN2049 access: membership required. The access request returned the account membership error, and the workspace seat check returned HTTP 403.

## Paid Task evidence (Cardano preprod)

Task `01a1103d-6e24-7332-adf1-32bb95c4a421` on Sokosumi, paid through Masumi escrow, settled end to end:

| Step | Transaction |
| --- | --- |
| Buyer funds escrow (1 tUSDM) | [a6e3fbda...0e85](https://preprod.cardanoscan.io/transaction/a6e3fbda65dd8a05b7252e1205f55ba34986b68df75f89e5430ab80818370e85) |
| Trust Check submits its result hash on chain | [8c9db324...afad](https://preprod.cardanoscan.io/transaction/8c9db32499ec2bdb8c275627f5530eb6d89a5c0ab7642d909c82d3d9ff51afad) |
| Seller collects 1 tUSDM to its wallet | [9c560b70...86a0](https://preprod.cardanoscan.io/transaction/9c560b70982fb56766919f21087e811a52133fe665e66ccfe1a5da012f4286a0) |

## Fix 8 live verification

The corrected report path was run locally against the Trust Check V2 registry unit and the live router at `https://cost-of-trust.vercel.app/api/router`.

- Registry evidence: Koios Preprod `POST /asset_info` with the 56-byte policy and 32-byte asset name returned the Trust Check registration NFT.
- Escrow evidence: Koios Preprod `POST /address_txs` and `POST /asset_txs` returned HTTP 200.
- Router evidence: live `POST /best-route` returned a quote; the report recommendation was `hire_with_backup_keeper` at `7.485609059528937` ADA expected cost.
- Sokosumi Task `01a11093-0aa3-711f-a80d-2376a5eec78e` was created with value at risk 100 and the 20/45/60/75 minute MPS windows. The worker accepted it and it reached `RUNNING`; its MPS request had not yet produced an escrow or result transaction when this evidence was recorded.
- The prior completed Task remains the source of confirmed settlement transactions above. The new report's structured recommendation is real; its optional model summary timed out and the structured facts remain authoritative.
