# Mainnet walk-forward backtest

Run from the repository root after loading the live Koios key without printing it:

```sh
cd /Users/user/Desktop/canton/cost-of-trust/coworker
set -a; source /Users/user/Desktop/canton/recourse/.env.live; set +a
node --import tsx ../backtest/run.ts
node --import tsx ../backtest/test.ts
```

The run enumerates both mainnet Masumi registry policies, reads every registry asset and its holders, then scans the newest 1,000 transactions from each payment contract after the earliest registry mint block. This bounded scan is the measurement window, not a claim of complete chain history. Koios responses are cached under `backtest/cache/`. Escrow spends are attributed with the read-only `escrowParty` and `tallyDelivery` helpers. A V2 datum agent unit is authoritative. A V1 datum agent unit is used when present, otherwise the selling wallet is the documented fallback.

An escrow is resolved only when its valid spend redeemer is paid, refunded, or disputed. Outcomes are sorted by transaction timestamp. Agents enter the sample at six resolved escrows. For each agent, decision `k` uses only outcomes `0..k-1`; the first five are warm-up and are not decisions. Refunded and disputed outcomes are non-delivery and expose the buyer to the full loss at risk.

Every decision is a job the buyer still needs completed. A delivered job costs the fees paid. An undelivered job costs those fees plus `L`. A skipped job is routed to the best same-capability alternative in the same registry policy group, ranked by its observed failure rate before the decision, with more prior observations breaking ties. The alternative's next escrow after the decision is used when available. That outcome is marked observed. If no usable alternative history exists, the job is charged `L` and marked modelled. This prevents a never-hire policy from scoring as free work.

P0 hires the target agent. P1 skips when the past dispute rate is above 5%. P2 skips when past refunds plus disputes exceed 20%. P3 calls `evaluateRoutes` with the target and qualifying mainnet agents as candidates, using only each candidate's outcomes before that escrow timestamp. A selected target-only route is hire-as-is, an underwritten target route requires coverage, and a target-first backup route hires with backup. Backup success or failure is taken from the best same-capability alternative's next observed escrow when available. Backup fees are charged only when that backup is used. `observedBackupLegs` and `modelledBackupLegs` are reported separately.

The JSON reports jobs done and done rate, ADA lost to undone work, fees, realized total cost, total cost per 100 decisions, skips, and backup provenance for P0, P1, P2, and P3 at `L = 5, 25, 100, 500`. `agentsWithSameCapabilityAlternative` reports how many sampled agents have at least one same-policy alternative. In the current sample, all 30 do, so ranking is not the scarce part. The buy-or-backup decision remains the material choice.

Calibration uses Brier score against each target's next observed outcome. The beta-binomial probability is `(2 + past failures) / (10 + past resolved)`. The dispute-rate probability is past disputes divided by past resolved. `backtest/test.ts` proves that the walk-forward decision receives a sliced prefix and that always skipping cannot beat hiring when the target failure rate is below 50%. To mutation-test the first guard, replace `outcomes.slice(0, k)` with `outcomes`, run the test and observe failure, then restore it and observe the pass.
