# Cost-of-Trust on-chain

Four Aiken validators (compiler v1.1.19, Plutus v3, aiken-lang/stdlib v3.0.0) that lock a deadline task, back it with underwriter collateral, and release that collateral on a Chainlink CRE report. `plutus.json` is the CIP-57 blueprint the off-chain lanes consume.

| Validator | Purpose |
|---|---|
| `claim_vault` | The deadline task. `Claim` before `expiry` pays the beneficiary, `Forfeit` after it returns the value to the sponsor. Exactly one vault input per transaction, every payout tagged with the vault out-ref. |
| `coverage(config_policy)` | Underwriter collateral. `Settle` between `task_expiry` and `decide_by` with a CRE report signed by f+1 DON signers pays the buyer on FAILURE and the underwriter on SUCCESS. `Expire` after `decide_by` returns the collateral. |
| `config_nft(utxo_ref, config_lock)` | One-shot minting policy for the config NFT. The NFT lands at the `config_lock` script address and its inline datum holds the signer allowlist, f, the workflow pins and the DON config digest. |
| `config_lock` | Always-fail spend script. The config NFT sits here, so the config is immutable once minted. |

## Layout

Validator logic lives in `lib/cot/` and each file in `validators/` is a thin wrapper that unwraps the handler arguments and calls it. Tests sit next to the logic in `lib/cot/*_test.ak`.

| File | Role |
|---|---|
| `lib/cot/model.ak` | Datums, redeemers, validity-range and value helpers, `config_digest`. |
| `lib/cot/cre.ak` | CRE report layout, digest, f+1 secp256k1 verification. |
| `lib/cot/vault.ak`, `cover.ak`, `config.ak` | Handler logic for the three spending and minting validators. |
| `lib/cot/attack_test.ak` | The attack transactions from the two independent reviews, one test per finding. |
| `lib/cot/vectors.ak` | Generated test vectors. Never edited by hand. |
| `scripts/generate_vectors.mjs` | Signs CRE-shaped reports with `@noble/curves` secp256k1 and writes `vectors.ak`. |

Regenerate vectors: `cd scripts && npm ci && node generate_vectors.mjs`. Check: `aiken check`. Blueprint: `aiken build`.

## Rules the validators enforce

`claim_vault` (datum `beneficiary, expiry, sponsor`)
- Exactly one input is locked under the vault script payment credential, whatever its stake part, so stake-variant addresses of the same script cannot be batched.
- `Claim`: the transaction upper bound is strictly below `expiry`; the beneficiary address receives at least the vault value in an output whose inline datum is this vault's out-ref. Anyone may submit.
- `Forfeit`: the lower bound is at or after `expiry`, the sponsor signs, and the sponsor payment credential receives the vault value in an output tagged with this vault's out-ref.

`coverage(config_policy)` (datum `terms_hash, buyer, underwriter, payout, task_ref, task_expiry, decide_by, config_digest`; `underwriter` and `buyer` are full addresses)
- Exactly one input is locked under the coverage script payment credential.
- The config is the reference input holding the config NFT of the validator parameter policy. The datum pins it through `config_digest = blake2b_256(f(1) | owner(20) | name(10) | cid(32) | don_config_digest(32) | n(1) | signers(20 each))`, so rotating the config never reaches live coverage UTxOs.
- `Settle`: the validity range is finite and sits inside `[task_expiry, decide_by]` (lower bound at or after `task_expiry`, upper bound at or before `decide_by`). Digest `keccak256(keccak256(raw_report) ++ report_context)` with a 64-byte context whose first 32 bytes equal the config `don_config_digest`; at least f+1 distinct allowlisted signers, each given as a 65-byte signature plus the 64-byte public key bound to the signer address by `keccak256(pubkey)[12..32]`, verified with `verify_ecdsa_secp256k1_signature` over the compressed key. The header pins workflow owner, name and cid. The 101-byte body carries this UTxO's own out-ref, the datum `terms_hash` and the datum `task_ref`. Decision 1 (FAILURE) pays `payout` lovelace to `buyer` and the remainder (every other asset included) to the full `underwriter` address, and requires `payout <= collateral - 2_000_000`. Decision 0 (SUCCESS) pays everything to the `underwriter` address. Every other decision byte, INCONCLUSIVE included, is rejected.
- `Expire`: the lower bound is at or after `decide_by`, the key behind the `underwriter` payment credential signs, and the full collateral returns to the `underwriter` address.
- Every coverage payout output carries the coverage out-ref as its inline datum, and only tagged outputs count toward that coverage.

`config_nft(utxo_ref, config_lock)`: the mint consumes the parameter out-ref, mints exactly one `COST_OF_TRUST_CONFIG` token, and pays it to an output at the `config_lock` script address whose inline datum is a well-formed config: `f >= 1`, unique 20-byte signers, at least `2f + 1` of them, owner 20, name 10, cid 32 and `don_config_digest` 32 bytes.

Report layout (210 bytes): header 109 bytes (cid at 45, name at 77, owner at 87), body 101 bytes at 109: `terms_hash(32) | decision(1) | coverage_tx_hash(32) | coverage_index(2, big-endian) | task_tx_hash(32) | task_index(2, big-endian)`.

## Tests

`aiken check`: 78 tests, 78 passed, 0 failed. Every rejection test shares its builder with an acceptance test, so each rejection is caused by the one field it alters.

- `claim_vault` (18): claim before expiry pays beneficiary; claim after expiry, at the expiry instant, without an upper bound, paying someone else, underpaying, untagged and tagged for another vault all rejected; two vaults in one transaction rejected with one payment, with a full payment and across stake-variant addresses; forfeit before expiry, unsigned, untagged, not returned to sponsor and with two vaults rejected; forfeit after expiry by sponsor accepted; spend without datum fails.
- `coverage` (25): FAILURE settle pays buyer and underwriter; SUCCESS settle; INCONCLUSIVE settle rejected; SUCCESS paying the buyer rejected; one flipped byte in `raw_report`, f signatures, duplicate signer, non-allowlisted signer and a signature by a different key than the pubkey rejected; f+1 signatures from any two signers accepted; wrong out-ref, index, terms hash, workflow name and decision byte rejected; underpaying buyer or underwriter rejected; payout tagged for another coverage and untagged payout rejected; config digest mismatch rejected; Expire before `decide_by`, unsigned and without returning the collateral rejected; Expire after `decide_by` by the underwriter accepted.
- `attack_test` (29): the double-satisfaction shapes from both reviews, the settle window (before `task_expiry`, after `decide_by`, unbounded), task binding in the report body (tx hash and index), the pinned DON context digest, the exact underwriter address on Settle and Expire, the collateral headroom boundary, the config lock destination, and the config shape rules (unique signers, `f >= 1`, `2f + 1` signers, 32-byte DON digest), plus an acceptance guard for each.
- `config_nft` (6): valid mint accepted; seed not consumed, two NFTs, f above the signer count, short workflow name and missing inline datum rejected.

Signatures are genuine secp256k1: `generate_vectors.mjs` derives four DON keys and one outsider key from public labels and signs ten distinct reports.

## Mutation proof

The f+1 threshold line `list.length(sigs) >= f + 1,` in `lib/cot/cre.ak` was changed to `>= f` and `aiken check` run:

```
Summary 78 checks, 1 error, 0 warnings
FAIL f_signatures_not_f_plus_one_rejected
```

Restored: `Summary 78 checks, 0 errors, 0 warnings`.

Every other guard was removed one at a time in a scratch copy and each went red on the test that names it: one-input rule (`claim_two_vaults_at_stake_variant_addresses_with_one_payment_rejected`, `settle_two_coverage_inputs_in_one_tx_rejected`, `expire_two_coverage_inputs_in_one_tx_rejected`, `forfeit_two_vaults_in_one_tx_rejected`), vault payout tags (`claim_untagged_payment_rejected`, `forfeit_untagged_payment_rejected`, `vault_and_coverage_cannot_share_one_tagged_beneficiary_payment`), settle lower and upper bounds (`settle_before_task_expiry_rejected`, `settle_after_decide_by_rejected`, `settle_without_a_finite_upper_bound_rejected`), INCONCLUSIVE (`inconclusive_settle_rejected`), task binding (`report_naming_another_task_rejected`, `report_naming_another_task_index_rejected`), context digest (`report_context_config_digest_mismatch_rejected`), exact underwriter address (`settle_underwriter_output_with_attacker_stake_rejected`, `expire_to_an_address_with_another_stake_part_rejected`), headroom (`failure_with_payout_above_collateral_headroom_rejected`), config lock (`mint_paying_the_nft_to_a_spendable_wallet_rejected`), unique signers, `f >= 1`, `2f + 1`, DON digest length, allowlist membership, signer deduplication.

## Execution units per path

Measured by `aiken check` on the accepting path of each handler. Transaction limits are 14,000,000 mem and 10,000,000,000 cpu, so the heaviest path (FAILURE settle with the signers that cost the most) uses 4.9 percent of memory and 3.1 percent of cpu.

| Path | Test | mem | cpu |
|---|---|---|---|
| claim_vault Claim | `claim_before_expiry_pays_beneficiary` | 154.12K | 51.97M |
| claim_vault Forfeit | `forfeit_after_expiry_by_sponsor_ok` | 162.39K | 54.85M |
| coverage Settle FAILURE | `failure_settle_pays_payout_to_buyer_and_rest_to_underwriter` | 642.78K | 303.23M |
| coverage Settle FAILURE (max) | `f_plus_one_signatures_accepted_from_any_two_signers` | 680.24K | 314.31M |
| coverage Settle SUCCESS | `success_settle_pays_underwriter` | 488.82K | 253.41M |
| coverage Expire | `expire_after_decide_by_by_underwriter_ok` | 206.44K | 67.32M |
| config_nft mint | `mint_consuming_the_seed_with_a_valid_config_ok` | 262.86K | 81.37M |
