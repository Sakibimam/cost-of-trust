# Cost-of-Trust on-chain

Three Aiken validators (compiler v1.1.19, Plutus v3, aiken-lang/stdlib v3.0.0) that lock a deadline task, back it with underwriter collateral, and release that collateral on a Chainlink CRE report. `plutus.json` is the CIP-57 blueprint the off-chain lanes consume.

| Validator | Purpose |
|---|---|
| `claim_vault` | The deadline task. `Claim` before `expiry` pays the beneficiary, `Forfeit` after it returns the value to the sponsor. |
| `coverage(config_policy)` | Underwriter collateral. `Settle` with a CRE report signed by f+1 DON signers pays the buyer on FAILURE and the underwriter otherwise. `Expire` after `decide_by` returns the collateral. |
| `config_nft(utxo_ref)` | One-shot minting policy for the config NFT whose inline datum holds the signer allowlist, f and the workflow pins. |

## Layout

Validator logic lives in `lib/cot/` and each file in `validators/` is a thin wrapper that unwraps the handler arguments and calls it. Tests sit next to the logic in `lib/cot/*_test.ak`.

| File | Role |
|---|---|
| `lib/cot/model.ak` | Datums, redeemers, validity-range and value helpers, `config_digest`. |
| `lib/cot/cre.ak` | CRE report layout, digest, f+1 secp256k1 verification. |
| `lib/cot/vault.ak`, `cover.ak`, `config.ak` | Handler logic for the three validators. |
| `lib/cot/vectors.ak` | Generated test vectors. Never edited by hand. |
| `scripts/generate_vectors.mjs` | Signs CRE-shaped reports with `@noble/curves` secp256k1 and writes `vectors.ak`. |

Regenerate vectors: `cd scripts && npm ci && node generate_vectors.mjs`. Check: `aiken check`. Blueprint: `aiken build`.

## Rules the validators enforce

`claim_vault` (datum `beneficiary, expiry, sponsor`)
- `Claim`: the transaction upper bound is strictly below `expiry`; the beneficiary address receives at least the sum of every input at the vault address. Anyone may submit. Because the payment is measured against all vault inputs in the transaction, one output cannot satisfy two vault UTxOs.
- `Forfeit`: the lower bound is at or after `expiry`, the sponsor signs, and the sponsor payment credential receives the same sum.

`coverage` (datum `terms_hash, buyer, underwriter, payout, task_ref, decide_by, config_digest`)
- The config is the reference input holding the config NFT of the validator parameter policy. The datum pins it through `config_digest = blake2b_256(f(1) | owner(20) | name(10) | cid(32) | n(1) | signers(20 each))`, so rotating the config never reaches live coverage UTxOs.
- `Settle`: digest `keccak256(keccak256(raw_report) ++ report_context)` with a 64-byte context; at least f+1 distinct allowlisted signers, each given as a 65-byte signature plus the 64-byte public key bound to the signer address by `keccak256(pubkey)[12..32]`, verified with `verify_ecdsa_secp256k1_signature` over the compressed key. Header pins workflow owner, name and cid. The 67-byte body must carry this UTxO's own out-ref and the datum `terms_hash`. FAILURE pays `payout` lovelace to `buyer` and the remainder (every other asset included) to the underwriter; SUCCESS and INCONCLUSIVE pay everything to the underwriter. Any other decision byte is rejected.
- `Expire`: lower bound at or after `decide_by`, underwriter signs, collateral returns to the underwriter.
- Every coverage payout output carries the coverage out-ref as its inline datum, and only tagged outputs count toward that coverage, so one output cannot settle two coverage UTxOs in the same transaction.

`config_nft`: the mint consumes the parameter out-ref, mints exactly one `COST_OF_TRUST_CONFIG` token, and pays it to an output whose inline datum is a well-formed config (f >= 0, at least f+1 signers of 20 bytes, owner 20, name 10, cid 32 bytes).

Report layout (176 bytes): header 109 bytes (cid at 45, name at 77, owner at 87), body 67 bytes at 109: `terms_hash(32) | decision(1) | coverage_tx_hash(32) | coverage_index(2, big-endian)`.

## Tests

`aiken check`: 44 tests, 44 passed, 0 failed. Every rejection test shares its builder with an acceptance test, so each rejection is caused by the one field it alters.

- `claim_vault` (13): claim before expiry pays beneficiary; claim after expiry rejected; claim at the expiry instant rejected; claim without an upper bound rejected; claim paying someone else rejected; claim underpaying rejected; two vaults with one payment rejected; two vaults with full payment accepted; forfeit before expiry rejected; forfeit after expiry by sponsor accepted; forfeit unsigned rejected; forfeit not returned to sponsor rejected; spend without datum fails.
- `coverage` (25): FAILURE settle pays buyer and underwriter; SUCCESS settle; INCONCLUSIVE settle; SUCCESS paying the buyer rejected; one flipped byte in `raw_report` rejected; f signatures rejected; f+1 signatures from any two signers accepted; duplicate signer rejected; non-allowlisted signer rejected; signature made by a different key than the pubkey rejected; body for a different out-ref rejected; body for a different index rejected; wrong `terms_hash` rejected; wrong workflow name rejected; unknown decision byte rejected; FAILURE underpaying buyer rejected; FAILURE underpaying underwriter rejected; payout tagged for another coverage rejected; untagged payout rejected; config digest mismatch rejected; Expire before `decide_by` rejected; Expire after by underwriter accepted; Expire unsigned rejected; Expire without returning collateral rejected; `config_digest` equals the digest computed by the generator.
- `config_nft` (6): valid mint accepted; seed not consumed rejected; two NFTs rejected; f above signer count rejected; short workflow name rejected; no inline datum rejected.

Signatures are genuine secp256k1: `generate_vectors.mjs` derives four DON keys and one outsider key from public labels and signs eight distinct reports.

## Mutation proof

The f+1 threshold line `list.length(sigs) >= f + 1,` in `lib/cot/cre.ak` was deleted and `aiken check` run:

```
    ┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 6 tests | 6 passed | 0 failed
    │ FAIL [mem: 525.69 K, cpu: 216.92 M] f_signatures_not_f_plus_one_rejected
    ┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 25 tests | 24 passed | 1 failed
    ┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 13 tests | 13 passed | 0 failed
      Summary 44 checks, 1 error, 1 warning
```

The line was restored (`git checkout lib/cot/cre.ak`):

```
    ┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 6 tests | 6 passed | 0 failed
    ┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 25 tests | 25 passed | 0 failed
    ┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 13 tests | 13 passed | 0 failed
      Summary 44 checks, 0 errors, 0 warnings
```

Other deletions confirmed red, each naming the test that guards it: allowlist membership (`non_allowlisted_signer_rejected`), duplicate-signer check (`duplicate_signer_counted_twice_rejected`), the ECDSA verification call (`one_flipped_byte_in_raw_report_rejected`, `signature_from_a_different_key_than_the_pubkey_rejected`), terms-hash binding, out-ref binding, workflow-name pin, config-digest pin, claim upper bound, forfeit lower bound, forfeit signature, and the payout tag (`payout_tagged_for_another_coverage_rejected`, `untagged_payout_rejected`).

## Execution units per path

Measured by `aiken check` on the accepting path of each handler. Transaction limits are 14,000,000 mem and 10,000,000,000 cpu, so the heaviest path (FAILURE settle) uses 4.2 percent of memory and 2.8 percent of cpu.

| Path | Test | mem | cpu |
|---|---|---|---|
| claim_vault Claim | `claim_before_expiry_pays_beneficiary` | 149.00K | 48.60M |
| claim_vault Forfeit | `forfeit_after_expiry_by_sponsor_ok` | 157.27K | 51.48M |
| coverage Settle FAILURE | `failure_settle_pays_payout_to_buyer_and_rest_to_underwriter` | 587.89K | 280.66M |
| coverage Settle SUCCESS | `success_settle_pays_underwriter` | 431.34K | 230.49M |
| coverage Settle INCONCLUSIVE | `inconclusive_settle_pays_underwriter` | 431.74K | 230.61M |
| coverage Expire | `expire_after_decide_by_by_underwriter_ok` | 184.22K | 58.40M |
| config_nft mint | `mint_consuming_the_seed_with_a_valid_config_ok` | 200.29K | 60.45M |

