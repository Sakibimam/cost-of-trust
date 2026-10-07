# Mainnet walk-forward backtest

Run from the repository root after loading the live Koios key without printing it:

```sh
cd /Users/user/Desktop/canton/cost-of-trust/coworker
set -a; source /Users/user/Desktop/canton/recourse/.env.live; set +a
node --import tsx ../backtest/run.ts
node --import tsx ../backtest/test.ts
```

The run enumerates both mainnet Masumi registry policies, reads every registry asset and its holders, then scans the newest 1,000 transactions from each of the two Masumi payment contracts after the earliest registry mint block. This bounded scan is the measurement window, not a claim of complete chain history. Koios responses are cached under `backtest/cache/`. Escrow spends are attributed with the read-only `escrowParty` and `tallyDelivery` helpers. A V2 datum agent unit is authoritative. A V1 datum agent unit is used when present, otherwise the selling wallet is the documented fallback.

An escrow is resolved only when its valid spend redeemer is paid, refunded, or disputed. Outcomes are sorted by transaction timestamp. Agents enter the sample at six resolved escrows. For each agent, decision `k` uses only outcomes `0..k-1`; the first five are the warm-up and are not decisions. Refunded and disputed mean non-delivery and expose the buyer to the full loss at risk.

P0 hires the target agent. P1 skips when the past dispute rate is above 5%. P2 skips when past refunds plus disputes exceed 20%. P3 calls `evaluateRoutes` with the target and qualifying mainnet agents as candidates, using only each candidate's outcomes before that escrow timestamp. A selected target-only route is hire-as-is, an underwritten target route requires coverage, and a target-first backup route hires with backup. A route that does not put the target first is do-not-hire.

Fees are the router quote. Coverage reduces a realized failure by the quoted coverage amount. For backup routes, the target escrow outcome is observed but the backup success probability is modelled from the backup's pre-decision beta-binomial risk. No backup execution is claimed as observed. The JSON reports the count of these modelled legs and repeats this caveat.

Calibration uses Brier score against the target's next observed outcome. The beta-binomial probability is `(2 + past failures) / (10 + past resolved)`. The dispute-rate probability is past disputes divided by past resolved. `backtest/test.ts` proves that the walk-forward decision receives a sliced prefix. To mutation-test it, replace `outcomes.slice(0, k)` with `outcomes`, run the test and observe failure, then restore it and observe the pass.
