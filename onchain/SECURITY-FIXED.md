# Security fixes: findings, fixes, tests

Fixes for `SECURITY-codex.md` and `SECURITY-opus.md`. Aiken v1.1.19, stdlib v3.0.0, Plutus V3.

Method: every attack test below was written first and run against the unfixed validators. The tests marked RED-BEFORE failed there (the attack transaction was accepted); all pass after the fix. Before the fix `aiken check` ran 44 tests, all green; after, 78 tests, all green. Every guard was then removed one at a time in a scratch copy and the named test went red (listed under MUTATION). The Codex Critical test was probed separately on the unfixed code: both validators accepted the shared-payment transaction.

Evidence on the unfixed code (15 of the 16 first-stage attack tests failed, the 16th is the positive headroom boundary):

```
claim_two_vaults_at_stake_variant_addresses_with_one_payment_rejected  FAIL
claim_two_vaults_in_one_tx_rejected                                    FAIL
claim_untagged_payment_rejected                                        FAIL
vault_and_coverage_cannot_share_one_tagged_beneficiary_payment         FAIL
settle_two_coverage_inputs_in_one_tx_rejected                          FAIL
settle_after_decide_by_rejected                                        FAIL
inconclusive_settle_rejected                                           FAIL
settle_requires_the_datum_task_ref                                     FAIL
report_context_config_digest_mismatch_rejected                         FAIL
settle_underwriter_output_with_attacker_stake_rejected                 FAIL
failure_with_payout_above_collateral_headroom_rejected                 FAIL
mint_paying_the_nft_to_a_spendable_wallet_rejected                     FAIL
mint_with_duplicate_signers_rejected                                   FAIL
mint_with_f_zero_rejected                                              FAIL
mint_with_fewer_than_two_f_plus_one_signers_rejected                   FAIL
```

## Finding to fix to test

| Finding | Fix | Test (RED-BEFORE / green after) | MUTATION that turns it red |
|---|---|---|---|
| Codex Critical: coverage payout satisfies a vault (cross-validator double satisfaction) | Vault `Claim` and `Forfeit` payouts carry the vault out-ref as inline datum; exactly one input under the vault script payment credential | `vault_and_coverage_cannot_share_one_tagged_beneficiary_payment` (RED-BEFORE), `claim_untagged_payment_rejected` (RED-BEFORE), `claim_payment_tagged_for_another_vault_rejected`, `forfeit_untagged_payment_rejected` | tag removed from Claim: `claim_untagged_payment_rejected`, `vault_and_coverage_cannot_share_one_tagged_beneficiary_payment`; tag removed from Forfeit: `forfeit_untagged_payment_rejected` |
| Opus M-1: vault double satisfaction across stake-variant addresses | `sole_script_input`: exactly one input whose payment credential is the vault script hash, any stake part (`script_inputs_value` deleted) | `claim_two_vaults_at_stake_variant_addresses_with_one_payment_rejected` (RED-BEFORE), `claim_two_vaults_in_one_tx_rejected` (RED-BEFORE), `claim_two_vaults_at_stake_variant_addresses_rejected`, `forfeit_two_vaults_in_one_tx_rejected`, `claim_single_vault_at_a_stake_variant_address_with_tagged_payment_ok` (acceptance guard) | one-input rule off: five Claim tests red; Forfeit variant: `forfeit_two_vaults_in_one_tx_rejected` |
| Coverage batching (same class, coverage side) | Exactly one input under the coverage script payment credential for `Settle` and `Expire` | `settle_two_coverage_inputs_in_one_tx_rejected` (RED-BEFORE), `expire_two_coverage_inputs_in_one_tx_rejected` | one-input rule off in Settle or Expire: the matching test red |
| Codex High: `Settle` valid after `decide_by` | `Settle` needs a finite lower bound >= `task_expiry` and a finite upper bound <= `decide_by` (datum gains `task_expiry`) | `settle_after_decide_by_rejected` (RED-BEFORE), `settle_before_task_expiry_rejected`, `settle_without_a_finite_upper_bound_rejected`, `settle_with_upper_bound_past_decide_by_rejected`, `baseline_failure_settle_accepted` and `success_settle_in_the_window_ok` (acceptance guards) | lower bound off: `settle_before_task_expiry_rejected`; upper bound off: the three upper-bound tests |
| Opus H-1: INCONCLUSIVE is terminal and settles at any time | Only decision 0 (SUCCESS) and 1 (FAILURE) settle; INCONCLUSIVE is rejected; `Expire` is the recovery path | `inconclusive_settle_rejected` (RED-BEFORE; the old `inconclusive_settle_pays_underwriter` was inverted into it) | decision 2 re-allowed: `inconclusive_settle_rejected` |
| Codex High and Opus M-3: signed report does not bind `task_ref` | Body grows to 101 bytes (`task_tx_hash(32)` then `task_index(2 BE)`); validator requires both to equal `datum.task_ref`; CRE reads `task_ref` and `task_expiry` from the coverage datum via Koios, never from the trigger | `settle_requires_the_datum_task_ref` (RED-BEFORE), `report_naming_another_task_rejected`, `report_naming_another_task_index_rejected` | task tx check off: `report_naming_another_task_rejected`; task index check off: `report_naming_another_task_index_rejected` |
| Codex Medium: `report_context` not pinned to the config | Config datum gains `don_config_digest(32)`; Settle requires `report_context[0..32] == don_config_digest` (and `config_digest` covers it) | `report_context_config_digest_mismatch_rejected` (RED-BEFORE) | context check off: `report_context_config_digest_mismatch_rejected` |
| Codex Medium and Opus L-2: config NFT mutable or at a spendable address | New always-fail validator `config_lock`; `config_nft(utxo_ref, config_lock)` requires the NFT output at `Script(config_lock)` | `mint_paying_the_nft_to_a_spendable_wallet_rejected` (RED-BEFORE), `mint_paying_the_nft_to_another_script_rejected`, `mint_paying_the_nft_to_the_lock_ok` (acceptance guard) | lock check off: both rejection tests |
| Opus L-3: duplicate signers, f = 0 | `config_ok`: `f >= 1`, `list.unique(signers)`, `len(signers) >= 2f + 1`, `don_config_digest` is 32 bytes | `mint_with_duplicate_signers_rejected` (RED-BEFORE), `mint_with_f_zero_rejected` (RED-BEFORE), `mint_with_fewer_than_two_f_plus_one_signers_rejected` (RED-BEFORE), `mint_with_a_short_don_config_digest_rejected` | each guard off: its own test red |
| Opus L-1: submitter chooses the underwriter's stake credential | `CoverageDatum.underwriter` is a full `Address`; Settle and Expire pay it with `paid_to_address` (exact address); `Expire` signs with the key hash derived from its payment credential | `settle_underwriter_output_with_attacker_stake_rejected` (RED-BEFORE), `expire_to_an_address_with_another_stake_part_rejected` | exact address replaced by payment-key match: both tests red |
| Opus M-2 (payout above collateral) and Codex Low (min-ADA) | `Settle` FAILURE fails closed unless `payout <= collateral lovelace - 2_000_000` | `failure_with_payout_above_collateral_headroom_rejected` (RED-BEFORE), `failure_with_payout_at_the_headroom_limit_ok` (boundary, accepted) | headroom off: `failure_with_payout_above_collateral_headroom_rejected` |
| f+1 threshold (re-run of the mutation proof) | unchanged logic | `f_signatures_not_f_plus_one_rejected` | `>= f + 1` changed to `>= f`: red; restored: 78/78 |

Max execution units on an accepting path: coverage Settle FAILURE 680.24K mem and 314.31M cpu (`f_plus_one_signatures_accepted_from_any_two_signers`), 4.9 percent and 3.1 percent of the transaction limits. Full table in `onchain/README.md`.

Blueprint (`plutus.json`, `aiken build`): `claim_vault` 584e049c..., `config_lock` fc200701..., `config_nft` (parameters `utxo_ref`, `config_lock`), `coverage` (parameter `config_policy`). All script hashes change with this build; the config NFT policy and coverage hash depend on the parameters the deployer applies.

## Remaining on-chain surface

- Codex Low (exact payments): `covers` still uses `>=`, so a settler can add native-asset dust or extra lovelace to a tagged output. No theft path; recipients accept it.
- Opus L-4 (payee datums): payouts now carry the out-ref inline datum, so a script beneficiary, buyer or underwriter must accept that datum. The buyer agent refuses non-key `buyer` and `underwriter` addresses (SPEC section 6).
- Opus M-2 (datum authored by the underwriter): the chain enforces the payout headroom; the other datum checks (`decide_by` against `task_expiry`, `config_digest` against the live config, `task_ref`, `task_expiry` against the vault) are the buyer agent's duty before it pays (SPEC section 6, MUST list).
- Settle timing relies on the validity range, which the ledger checks against the slot of the transaction; a relayer must submit with a range inside `[task_expiry, decide_by]`.
- CRE: `readFacts` now reads the task from the datum. Its live Koios classification path (`kind: "other"`, `signedBySponsor: false`) was already in place and is unchanged; the datum-driven reads are covered by `decide.test.ts` only for body construction.

## CHANGELOG FOR OFFCHAIN

Everything the off-chain builders (`offchain/`), the relayer and the agents must apply. Datum field order is the Plutus constructor field order.

### Datums

`ClaimDatum` (unchanged): `beneficiary: Address, expiry: Int, sponsor: ByteArray`.

`CoverageDatum` is now 8 fields in this order:
`terms_hash: ByteArray(32)`, `buyer: Address`, `underwriter: Address` (was `ByteArray` key hash), `payout: Int`, `task_ref: OutputReference`, `task_expiry: Int` (new, POSIX ms, equals the vault `expiry`), `decide_by: Int`, `config_digest: ByteArray(32)`.
- `underwriter` must be a key address (payment credential `VerificationKey`); build it with the underwriter's stake credential if any. Settle and Expire pay exactly that address.
- `decide_by` must be >= `task_expiry + 30 minutes` or the buyer agent refuses the coverage.

`ConfigDatum` is now 6 fields: `signers, f, workflow_owner, workflow_name, workflow_cid, don_config_digest: ByteArray(32)` (new, last). Constraints: `f >= 1`, unique signers, `len(signers) >= 2f + 1`.

`config_digest = blake2b_256(f(1) | owner(20) | name(10) | cid(32) | don_config_digest(32) | n(1) | signers(20 each))`. The new `don_config_digest` sits between `cid` and `n`. Recompute every coverage `config_digest` with it.

### Parameters and scripts

- `config_nft` now takes two parameters: `(utxo_ref: OutputReference, config_lock: ByteArray)`. Apply `utxo_ref` first, `config_lock` second (blueprint parameter order).
- New validator `config_lock` (always fails). Its script hash is the `config_lock` parameter. Pay the minted config NFT to the address whose payment credential is `Script(config_lock_hash)`, inline datum `ConfigDatum`. Any other address fails the mint.
- `coverage(config_policy)` takes the same single parameter, but its hash and the `config_nft` policy id change because the code changed. Re-read both from `plutus.json`.
- Reference the config NFT UTxO at the lock address as the Settle reference input.

### Redeemers

`ClaimRedeemer` and `CoverageRedeemer` constructors are unchanged (`Claim`, `Forfeit`, `Settle { raw_report, report_context, sigs, pubkeys }`, `Expire`). Behaviour changes:
- `report_context` must start with the config `don_config_digest` (first 32 bytes of the 64-byte context the DON signs). The CRE DON config digest has to be the value stored in the config datum.
- `raw_report` is 210 bytes (header 109 plus body 101).
- INCONCLUSIVE (decision byte 2) is rejected on chain. Never submit it; the relayer must skip INCONCLUSIVE reports and the underwriter reclaims through `Expire`.

### Transaction shape

- Vault `Claim` and `Forfeit`: exactly one vault input per transaction. The beneficiary (Claim) or sponsor (Forfeit) output must carry `InlineDatum(vault_out_ref)` (the out-ref of the vault input being spent). One output per vault; no batching, even across stake-variant addresses.
- Coverage `Settle` and `Expire`: exactly one coverage input per transaction. Buyer and underwriter outputs keep carrying `InlineDatum(coverage_out_ref)`; the underwriter output goes to the datum `underwriter` Address exactly, stake part included.
- Settle validity range: finite on both ends, lower bound >= `task_expiry`, upper bound <= `decide_by`. Expire: lower bound >= `decide_by`, signed by the key hash of the `underwriter` address.
- FAILURE: reject or never request `payout > collateral lovelace - 2_000_000`.
- Buyer and underwriter outputs must meet the ledger minimum UTxO on their own; the validator guarantees the underwriter remainder is at least 2 ADA, the buyer `payout` must itself be at least the minimum.

### Report body (CRE workflow)

101 bytes: `terms_hash(32) | decision(1) | coverage_tx_hash(32) | coverage_index(2 BE) | task_tx_hash(32) | task_index(2 BE)`. `decision` is 0 SUCCESS or 1 FAILURE only. In `cre/cot-adjudicator`: `buildBody(termsHash, decision, coverageTxHash, coverageIndex, taskTxHash, taskIndex)`; it throws for INCONCLUSIVE. The HTTP trigger is `{ coverageRef }`; `taskRef` and `termsHash` are read from the coverage datum, so any value the caller sends for them is ignored. The workflow refuses to report when the vault `expiry` differs from the coverage `task_expiry`, when the decision is INCONCLUSIVE, and when `now > decide_by`.

### Vectors

`onchain/lib/cot/vectors.ak` is regenerated by `onchain/scripts/generate_vectors.mjs` for the 210-byte report and the pinned DON digest; off-chain tests that reuse those vectors need the new file.
