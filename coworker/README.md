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

Run the Sokosumi worker separately with `npm run worker`. It polls the Personal Workspace, sends each assigned Task to the report engine, and completes the Task with the exact JSON result. Set `SOKOSUMI_COWORKER_ID` in server-side secret storage. Registry lookup uses the managed Masumi registry `POST /registry-entry/` contract and needs a server-side `REGISTRY_API_KEY`.

## Payment path

The paid flow uses a fresh signed Masumi seller-term request, `masumiPayment` on the Sokosumi Task, confirmed escrow funding, the exact result hash submitted to MPS, Task completion, and independent seller collection verification. The local MPS checkout lives in `../mps` and uses PostgreSQL database `cost_of_trust_mps` on port `3012`.

## Current verification

The local report validation test and TypeScript check pass. The OpenRouter primary and fallback path were smoke-tested against the live API. MPS is seeded on Preprod and its selling wallet was funded with a confirmed transaction. Vendor creation, Coworker registration, registry credentials, Task execution, paid collection, and event approval require the private human actions listed in `SETUP-RECORD.md`.
