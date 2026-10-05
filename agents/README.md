# Cost-of-Trust agents

The agents use Cardano preprod, Koios, Lucid-evolution 0.6.5, and x402 2.28.0. Load the Koios bearer key from the recourse environment without printing it:

```sh
set -a
source /Users/user/Desktop/canton/recourse/.env.live
set +a
```

Run the checks before starting services:

```sh
(cd ../offchain && bun run typecheck && bun test ./src/test.ts)
bun run typecheck
bun run self-check
```

Start the router, underwriter, relayer, and the three MIP-003 keeper services in separate terminals:

```sh
(cd ../router && PORT=8787 bun src/server.ts)
PORT=4110 bun underwriter.ts
PORT=4111 bun relayer.ts
SELLER_ID=seller-a PORT=4101 bun keeper.ts
SELLER_ID=seller-b PORT=4102 bun keeper.ts
SELLER_ID=seller-c PORT=4103 bun keeper.ts
```

Each keeper implements `GET /availability`, `GET /input_schema`, `POST /start_job`, and `GET /status?job_id=...`. Payments are x402 v2 Cardano exact transfers with `assetTransferMethod: "default"`. The installed package supports the Masumi method on preprod, but this service uses the default method because the Masumi method requires seller-issued escrow quotes and Masumi seller authorization.

The buyer needs `offchain/deployment.json` and `offchain/config.json` or equivalent paths supplied by `COT_DEPLOYMENT` and `COT_CONFIG`. Run the underwritten success flow:

```sh
BUYER_RISK_AVERSION=0.25 SHARED_INFRA=true bun buyer.ts
```

Run the underwritten failure flow with seller B accepting payment but not claiming:

```sh
SELLER_ID=seller-b PORT=4102 STALL=true bun keeper.ts
BUYER_RISK_AVERSION=0.25 SHARED_INFRA=true bun buyer.ts
```

Run the EUTXO redundancy race. Both selected keepers are paid, one claim confirms, and the other records the ledger rejection:

```sh
BUYER_RISK_AVERSION=0.25 SHARED_INFRA=false bun buyer.ts
```

Run the report-integrity proof. The relayer first submits a report with one flipped raw-report byte, records the script rejection, then submits the untouched CRE report:

```sh
FLIP_REPORT=true BUYER_RISK_AVERSION=0.25 SHARED_INFRA=true bun buyer.ts
```

Every buyer run writes `agents/runs/<timestamp>.json`. Each accepted transaction is polled through Koios `tx_status` before it is recorded. CRE simulation output and the report received by the relayer are written under `cre/evidence/`.
