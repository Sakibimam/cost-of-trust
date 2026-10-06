# Trust Check setup record

Private record. Do not publish.

## Intended job

- Buyer: operations and procurement teams, plus orchestrator agents hiring AI agents on Sokosumi and Masumi.
- Input: Masumi agent identifier, registry asset, or seller key; task value at risk in ADA.
- Output: live registry facts, Koios escrow history, endpoint health, router expected cost, recommendation, and cited summary.
- Decision: whether to hire and whether to add backup keeper or coverage.
- Direct alternative: manually inspect the registry, endpoint, and chain history before each hire.
- New capability: one deterministic, evidence-linked trust decision before an agent payment.
- Kill shot: if the report cannot read live delivery history and change the hire decision, it is only a generic agent directory wrapper.

## Checkpoints

| Stage | Evidence | Status |
|---|---|---|
| Guide and source reading | `agent-guide.md`, quickstart, workshop, Masumi skill, `docs/SPEC.md`, router server, and M1 reader read in full | PASS |
| CLI | Sokosumi CLI `1.0.4`; exact subcommand help inspected | PASS |
| Auth | `sokosumi --preprod auth whoami --json` returned user `01a10fa2-aaf1-71da-97b6-13a0081efeb8`, CLI `1.0.4` | PASS |
| Human action | OAuth login completed; organization `COT` (`cot-vyoipg`) now exists and is owned by the authenticated account | PASS |
| Model access | OpenRouter credential present privately; primary model is overloaded, fallback available | PASS |
| Model action | OpenRouter smoke: primary overloaded; fallback `nvidia/nemotron-3-super-120b-a12b:free` returned content | PASS |
| Registry access | Direct Koios registry probe confirmed the chain lookup shape; live report retry hit Koios HTTP 429 and preserved `insufficient_data` | PARTIAL |
| Eve | `eve@0.71.2` CLI could not initialize because its published CLI imported missing `ai`; retry after adding `ai` emitted no project | BLOCKED |
| Coworker service | TypeScript check and validation test pass | PASS |
| Report HTTP click-through | Local `/health` passed; synthetic `/report` returned all five evidence channels, `insufficient_data`, and a cited fallback-model summary | PASS |
| MPS clone | Masumi Payment Service revision `71455701ac22c3380c50da54089e1b7363f6825d` | PASS |
| PostgreSQL | Dedicated database `cost_of_trust_mps`, local port `5432` | PASS |
| MPS config | Private `.env`, port `3012`, generated encryption/admin keys, collection override empty | PASS |
| Blockfrost | `BLOCKFROST_API_KEY_PREPROD` present privately in `mps/.env`; direct parameter request HTTP 200 | PASS |
| MPS database | `pnpm install --frozen-lockfile`, Prisma generate, and migrations pass | PASS |
| MPS seed | Seed completed after removing empty contract overrides; V2 source and wallets created, seed output suppressed | PASS |
| MPS health | PID `87817`; `GET http://127.0.0.1:3012/api/v1/health` returned `status=success,data.status=ok`; live OpenAPI exposed 122 paths | PASS |
| Selling wallet | V2 selling wallet address recorded privately from `/wallet/list`; collection address is null | PASS |
| Wallet funding | Transaction `cfaa643ce4253b0ccadd4ef972b509962ca615c8124b32be4f01f012ea81e601`; Blockfrost confirmed, 200000000 lovelace at seller | PASS |
| MPS runtime key | Scoped Preprod `ReadAndPay` key created for selling wallet `cmuw8p6zc0009nxr4qhyk2eeq`; read endpoint returned HTTP 200; token remains only in ignored `.env.local` | PASS |
| MPS registration | Request `cmuwa7esz0004rdr4piebssps` accepted; state remains `RegistrationRequested`, no agentIdentifier yet; polling continues | PENDING |
| Vendor and Coworker | Vendor `01a10fcf-be3e-766d-b32c-300330ed9187`; Coworker `01a10fcf-eed2-75ed-a385-a979349eeb93`; Personal access `01a10fd0-2e91-725b-8fc2-66221e1e664c` is `GRANTED`; runtime key imported | PASS |
| Rehearsal Task | Task `01a10fd1-2d04-7041-85fb-1f7e11d7b8c0`; RUNNING event `01a10fd1-c540-739c-87f0-cc561f5bec36`; COMPLETED event `01a10fd2-9bee-710d-9a0a-475170459afb`; result was a real cited report with `insufficient_data` because Koios returned HTTP 429 | PASS_WITH_DATA_CAVEAT |
| Personal credits | Authenticated Preprod API returned `spendable=3250`; subscription remaining `250`, extra remaining `3000`; no checkout required | PASS |
| Paid Task | Task `01a1100a-8fbd-762a-9d32-b708380d25aa` created READY with `totalCredits=0`; Deepfake Knight registry asset is `asset1h6lypyuwtgjqjf9wd4wmg53pgk7gtv08nk40pn`; MPS rejected the request HTTP 404 because the configured source is V2 and the V1 registry policy is unsupported | BLOCKED |
| Worker and MPS | MPS health `status=ok`, process PID `40758`; worker launch exited on MPS HTTP 404, so no worker PID remains running | BLOCKED |
| Event access | Connect returned a membership error before any 429 retry; `workspaces check` returned HTTP 403 `organization_membership_required`; no access ID | BLOCKED |

## Processes

Trust Check HTTP server is running in the active local session; MPS is running with PID `40758` and health is `ok`. The worker cannot stay running because the configured V2-only MPS rejects the selected V1 seller asset.

## Corrections and unresolved work

- The initial TypeScript check found missing Node types and TS extension settings. Added `@types/node`, `types: ["node"]`, and `allowImportingTsExtensions`; the check then passed.
- Eve initialization remains unresolved at the installed published CLI. The working Trust Check HTTP agent is intentionally kept separate from that failed initialization.
- MPS seed initially failed because empty optional contract override variables shadowed built-in defaults. Removing those empty lines fixed it. No secrets, wallet seeds, API keys, or OAuth tokens are stored in this record.
- Organization action completed: `COT` was created in Sokosumi Preprod and verified by `workspaces list --json`.
- Exact human action: open `https://preprod.sokosumi.com/join/9Ycw8wzmzXB2WEKa-umzUJX6_GEFiVdu` in the authenticated account to join the TOKEN2049 Workspace, then rerun `sokosumi --preprod workspaces list --json`.
- Personal credit balance was checked through the authenticated Preprod API. It was 3,250 spendable, so no checkout was needed.
- Exact registry action: none required. The report reads the V1 and V2 registry policies directly from Koios. A managed `REGISTRY_API_KEY` may be added privately only if the participant elects to use the managed registry path.
- Commit: `965c20a` (`Build Trust Check coworker report path`), tracked files only under `coworker/`.
