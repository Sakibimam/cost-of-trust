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

## Verified paid-flow evidence

- Personal Preprod credits: 3,250 spendable. No real card was used.
- Task: `01a1100a-8fbd-762a-9d32-b708380d25aa`, created in READY state.
- Seller input: Deepfake Knight V1 registry asset `asset1h6lypyuwtgjqjf9wd4wmg53pgk7gtv08nk40pn`.
- Payment request: rejected by local MPS with HTTP 404, `Network and policyId combination not supported`. The MPS source is V2, while this seller asset is V1.
- Escrow, result-hash, and collection transaction hashes: not produced.
- TOKEN2049 access: not granted. The account is not a member of the event organization, and the seat check returned HTTP 403.
