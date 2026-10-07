Claim: A real local Masumi V2 source can expose registered agents and enforce a buyer purchase window with `submitResultTime` at least 15 minutes ahead and `unlockTime` at least 15 minutes after it.
Verdict: CONFIRMED for the API contract, UNTESTED for the full refund terminal state until a live purchase reaches its unlock time.
Measured: `GET http://127.0.0.1:3012/api/v1/registry?network=Preprod&limit=10&filterPaymentSourceType=Web3CardanoV2` returned 200 with three `RegistrationConfirmed` entries. Source validation in `mps/src/routes/api/purchases/shared.ts` measures 15 minutes for both minimums.
Negative case: The same registry request with an `Authorization` header was rejected with 401 because this MPS uses the `token` header. A pre-checkpoint backup decision throws instead of hiring early.
Caveat: A no-result refund cannot complete in an eight-minute command because the live API rejects shorter windows. The demo must poll to `RefundWithdrawn` or report the exact pending deadline.
Blocks product: no, but it blocks an under-eight-minute end-to-end refund claim.
