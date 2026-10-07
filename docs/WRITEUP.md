# Cost of Trust: technical writeup

## Problem

An autonomous buyer can pay an HTTP service, but price alone is a poor decision rule when missing a deadline destroys more value than the service costs. A buyer needs to compare counterparties, failure history, shared infrastructure, staggered execution, and protection before it spends.

The first user is an autonomous Cardano buyer running deadline work for a treasury or data pipeline. Its direct alternative is manually choosing a keeper and absorbing the loss when the keeper misses the deadline. Cost of Trust turns that choice into a route with explicit expected loss and tail risk.

## Technical approach

The router is a Bun and TypeScript HTTP service. `POST /best-route` takes the downstream loss, candidate sellers, risk aversion, infrastructure correlation, and constraints. It calculates a beta-binomial seller risk from chain-observed outcomes, then evaluates single, redundant, staggered, and underwritten routes:

`risk-adjusted cost = service price + premium + expected loss + risk aversion × loss standard deviation`

The router returns every route, its arithmetic, seller confidence, terms hash, and the selected route. A staggered route uses one claim-vault UTxO with ordered keeper validity intervals. The first keeper gets the first slot, the backup gets the second slot, and EUTXO contention makes the result one spend and one winner.

Coverage uses a separate collateral UTxO. A Chainlink CRE workflow reads the coverage and task UTxOs through Koios, classifies the outcome deterministically, and emits a signed report. Cardano verifies the report on chain with Plutus V3, f+1 distinct allowlisted secp256k1 signatures, a pinned DON config digest, workflow metadata, task binding, terms binding, and a finite settlement window. The validator pays the buyer on a signed FAILURE report, pays the underwriter on SUCCESS, and releases collateral after the decision window.

The decision path is deterministic. CRE supplies adjudication infrastructure and signatures; the Cardano validator enforces the report’s identity, scope, signer set, time window, and payout shape.

### CRE report path

The CRE workflow's decision body is signed by the config-pinned signer set implemented in [`agents/attest.ts`](../agents/attest.ts). Simulator keys rotate per run, so the local evidence path re-wraps the workflow decision with the signer set pinned by the preprod config NFT before validator verification. The production path is a deployed DON with its signer set recorded in a fresh config NFT. This keeps the decision body, workflow identity, DON digest, and validator allowlist aligned at the boundary where a report can release collateral.

## Tools and infrastructure

| Layer | Technology |
| --- | --- |
| Smart contracts | Aiken 1.1.19, Plutus V3, Aiken standard library 3.0.0 |
| Transaction building | Lucid-evolution 0.6.5 |
| Chain reads | Koios |
| Agent payments | x402 v2, `@x402/cardano` and `@x402/core` 2.28.0 |
| Agent protocol | Masumi MIP-003 keeper endpoints |
| Adjudication | Chainlink CRE TypeScript workflow |
| Services | Bun and TypeScript |
| Presentation | Next.js web route board |

The keeper lane uses x402 v2 Cardano exact transfers with the default asset transfer method. Cost of Trust adds its risk quote endpoint and terms hash as metadata around the payment.

## Deployment flow

The config NFT is minted once to an always-failing config-lock validator. Its datum stores the signer allowlist, f value, workflow identity, and DON config digest. Coverage UTxOs reference that immutable config. The claim-vault and coverage scripts enforce one-input spending and tagged payout outputs.

At runtime, the buyer asks the router for a route, locks the deadline value, and pays the selected keeper. The keeper claims in its validity interval. For an underwritten route, the underwriter locks collateral, the CRE workflow observes the task, and the relayer submits the signed report for validator verification. Every accepted transaction is polled through Koios before it is recorded by the buyer run.

The deployed preprod addresses are listed in the root README. The run records preserve route terms, selected sellers, and confirmed transaction hashes for explorer inspection.

The four completed 2026-10-06 preprod runs and their Cardanoscan links are recorded in the root [README](../README.md). The Trust Check Coworker gathers registry, escrow, endpoint, and router evidence into a cited report, as described in [`coworker/README.md`](../coworker/README.md). Provider selection uses the measured Koios and Tatum table in [`docs/GTM.md`](GTM.md), where each HTTP result becomes a route-history input.

## Scaling model

Seller histories are keyed by seller and service type, with chain events as the evidence source. Adding sellers expands the route set and keeps the same route arithmetic. Adding buyer workloads reuses the router API and terms hash. The on-chain lane remains bounded per task: one vault input, one coverage input, one report, and one settlement or expiry path.

The architecture separates high-volume quote computation from the small set of transactions that need Cardano execution. Koios supplies indexed reads, keepers expose MIP-003 services, and CRE handles deterministic state observation before the validator makes the final settlement decision.
