# Mainnet walk-forward backtest

This benchmark uses the bounded mainnet Masumi sample in `web/src/data/backtest.json`: 30 agents, 433 resolved escrow outcomes, and 283 decisions. It scans the newest 1,000 transactions per payment contract after the earliest registry mint block. Koios responses are cached in `backtest/cache/` and attribution uses the read-only escrow and delivery helpers.

Run it with the repository's existing TypeScript runtime:

```sh
node --import ../coworker/node_modules/tsx/dist/loader.mjs backtest/run.ts
node --import ../coworker/node_modules/tsx/dist/loader.mjs backtest/test.ts
```

## Method

The time window is split at its timestamp midpoint, `2026-09-26T02:57:07.000Z`. The first half calibrates a Beta prior from first-half outcomes only: `Beta(0.5, 9.6212)`, mean failure probability 3.79%. Every decision uses only outcomes strictly before its decision timestamp. The held-out table contains only second-half decisions, while the full table contains the complete window using the same calibrated prior.

P0 hires the requested agent. P1 skips above a 5% dispute rate. P2 skips above a 20% total failure rate and routes the skipped job to the best observed same-policy alternative. P3 is the old route policy and is retained for diagnosis only. P3-new calls the product capability policy in `router/src/routes.ts`: rank the same-policy capability group by posterior failure probability, select the best primary, and add a staggered backup when primary posterior failure times loss exceeds the backup fee. It never refuses a job.

For a selected alternative, the next outcome after the decision is used when observed. Missing primary or backup legs are counted as modelled failures. `observedBackupLegs` and `modelledBackupLegs` stay separate. Costs include fees and undone work. `jobsDoneRate` is completed jobs divided by decisions, not attempted jobs.

## Diagnosis of old P3

| Decision type | Decisions | Jobs done | Done rate |
| --- | ---: | ---: | ---: |
| hire_as_is | 0 | 0 | 0.0% |
| backup | 8 | 8 | 100.0% |
| coverage | 0 | 0 | 0.0% |
| do_not_hire | 275 | 200 | 72.7% |
| insufficient_data | 0 | 0 | 0.0% |

The drop is refusal, not a bad backup: the old policy marks a route whose winner is not the requested agent as `do_not_hire`. That is 275 of 283 decisions. Its fallback completes 200 of those jobs. P3-new removes that refusal path, uses calibrated evidence for new agents, and shares the routing function with the backtest.

## Held-out second half

| Policy | L | Done rate | Undone ADA | Fees ADA | Total ADA / 100 jobs | Observed backup legs | Modelled backup legs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| P0 | 100 | 88.7% | 2,600 | 0 | 918.73 | 0 | 0 |
| P2 | 100 | 91.2% | 1,900 | 0 | 671.38 | 0 | 0 |
| P3-new | 100 | 91.3% | 2,400 | 0 | 866.43 | 53 | 24 |
| P0 | 500 | 88.7% | 13,000 | 0 | 4,593.64 | 0 | 0 |
| P2 | 500 | 91.2% | 9,500 | 0 | 3,356.89 | 0 | 0 |
| P3-new | 500 | 91.3% | 12,000 | 0 | 4,332.13 | 53 | 24 |

P3-new wins the held-out completion rate by 0.2 percentage points over P2, but it does not win total cost. The honest headline is therefore: the root fix repairs P3's refusal failure and slightly improves completion, but this sample does not prove a cost win or justify claiming the policy dominates P2.

## Full window

P0 completes 90.8%, P2 completes 93.3%, and P3-new completes 91.5%. At L=100, total cost per 100 decisions is 918.73 ADA for P0, 671.38 ADA for P2, and 848.06 ADA for P3-new. At L=500, the corresponding totals are 4,593.64, 3,356.89, and 4,240.28 ADA.

The sample is bounded, wallet attribution remains the documented V1 fallback when no agent unit is present, and registry prices without a lovelace quote are reported as zero rather than guessed.
