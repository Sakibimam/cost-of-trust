# On-chain security review

Reviewer: codex

Scope: `docs/SPEC.md` section 6, `onchain/README.md`, all Aiken sources under
`onchain/lib/cot/` and `onchain/validators/`, and the contract-review checklist.

`aiken check` could not be run in this environment because the `aiken` binary is
not installed. Findings below are based on source-level transaction traces.

## Findings

### Critical: a coverage payout can satisfy a vault while the vault value is routed elsewhere

**Location:** `onchain/lib/cot/vault.ak:21-26`; `onchain/lib/cot/model.ak:147-160`

**Pattern:** double satisfaction across validators and address-scoped value accounting.

`claim_vault.Claim` counts every output to the beneficiary, with no vault tag. It
also defines `locked` as the value of inputs whose full address equals the current
vault input. Two vaults at different full addresses are therefore checked against
different input groups, while a single beneficiary output is counted by both
validators. More importantly, an output tagged for a coverage UTxO is still a
normal output to the vault beneficiary and can satisfy the vault.

**Attack transaction shape:**

1. Spend a vault containing 9,000,000 lovelace and a coverage containing
   10,000,000 lovelace in one transaction.
2. Use a valid FAILURE report for the coverage with `payout = 9,000,000` and set
   the coverage buyer equal to the vault beneficiary.
3. Pay 9,000,000 lovelace to the beneficiary in an output tagged with the
   coverage out-ref.
4. Pay 10,000,000 lovelace to the underwriter in an output tagged with the same
   coverage out-ref.

The vault validator sees its full 9,000,000 payment and accepts. The coverage
validator sees at least its required 9,000,000 buyer payout and its required
1,000,000 underwriter remainder and accepts. Value conservation is satisfied by
routing the vault's 9,000,000 into the underwriter output. The vault's intended
beneficiary payment was therefore funded by coverage collateral, and the vault
value was released to the underwriter.

**Test that fails before a fix:**
`vault_and_coverage_cannot_share_one_tagged_beneficiary_payment`.
Construct the two inputs and two tagged outputs above, run both validators with
the same transaction, and assert that at least one validator rejects. A fix must
bind each vault payment to its own out-ref, or otherwise prevent heterogeneous
script inputs and cross-validator satisfaction.

### High: `Settle` remains valid after `decide_by`

**Location:** `onchain/lib/cot/cover.ak:43-79`

**Pattern:** missing validity bound on a deadline branch.

`Expire` requires a lower bound at or after `decide_by`, but `Settle` has no upper
bound or lower bound. A valid CRE report can therefore settle indefinitely after
the underwriter's expiry right becomes available. An attacker or delayed relayer
can race `Expire` with a late `Settle`; whichever transaction consumes the UTxO
first wins, so expiry is not a state-machine deadline.

**Attack transaction shape:** spend the coverage after `decide_by`, with a valid
FAILURE report, f+1 valid signatures, and the normal tagged buyer and underwriter
outputs. The validator accepts even though the settle deadline has passed.

**Test that fails before a fix:**
`settle_after_decide_by_rejected`. Run the existing accepted FAILURE settlement
with `interval.after(decide_by)` and assert rejection. The intended fix is an
explicit finite upper bound at or before the settle deadline, with the exact
boundary chosen consistently with `Expire`.

### High: the signed report does not bind the insured `task_ref`

**Location:** `onchain/lib/cot/model.ak:28-39`; `onchain/lib/cot/cover.ak:43-63`; `onchain/lib/cot/cre.ak:47-61`

**Pattern:** missing datum-to-report binding and missing linked-UTxO authentication.

`CoverageDatum.task_ref` is never read by the coverage validator. The report body
binds only `terms_hash` and the coverage out-ref. `Settle` also does not require
the referenced vault as an input or verify that it was the vault represented by
the CRE workflow. Consequently, a valid signed report produced for another task
can settle this coverage if its body is changed to this coverage's ref and terms
and the signers sign that report. The on-chain state machine has no proof that
the insured claim_vault UTxO was the subject of the decision.

**Attack transaction shape:** spend coverage `C` without spending its
`task_ref` vault. Submit a valid f+1-signed report whose decision was computed for
another vault or task, but whose body carries `C`'s out-ref and `C`'s
`terms_hash`. The current validator accepts the payout.

**Test that fails before a fix:**
`settle_requires_the_datum_task_ref`. Set `datum.task_ref` to `vault_a`, provide a
valid signed report generated for `vault_b`, omit `vault_a` from the transaction,
and assert rejection. The report format should include a canonical task out-ref,
or the validator should authenticate the task input and bind it to the datum.

### Medium: the config NFT's datum is mutable after minting, allowing config rotation and freezing old coverage

**Location:** `onchain/lib/cot/config.ak:10-30`; `onchain/validators/config_nft.ak:5-8`

**Pattern:** protocol-identity token is authenticated only at mint time.

The minting policy proves that one config NFT was created with a valid datum, but
it has no spend branch and does not require the NFT to remain with the same inline
datum. The holder can consume the NFT output and recreate the same token with a
different signer set, threshold, or workflow metadata. Existing coverage pins the
old config digest, so `config_from` will reject settlement while the rotated
datum is referenced. This can force otherwise settleable collateral to wait for
`Expire`, and a malicious rotation can control which signer set new coverage
accepts.

**Attack transaction shape:** consume the current config-NFT UTxO, pay the same
policy/name token to a new output with an attacker-selected valid `ConfigDatum`,
then use that output as the coverage reference input. Old coverage with the prior
`config_digest` cannot settle against it.

**Test that fails before a fix:**
`rotating_config_datum_invalidates_existing_coverage`. Create coverage pinned to
config A, replace the NFT datum with config B while preserving the NFT, and assert
that the protocol either rejects the rotation or preserves a settlement path for
config A. The fix is an immutable/versioned config authority or a spend validator
that authenticates datum transitions and keeps old config UTxOs available.

### Medium: `report_context` is length-checked but not pinned to the coverage config

**Location:** `onchain/lib/cot/cover.ak:49-56`; `onchain/lib/cot/cre.ak:104-117`

**Pattern:** signed domain separator is not checked on chain.

The implementation comments define the first 32 bytes of the 64-byte context as
the config digest, but `verify_report` checks only that the context is 64 bytes.
`CoverageDatum.config_digest` is compared to the referenced config, while the
context signed by the DON is never compared to that digest. A report signed by an
allowlisted signer set for a different config or sequence can therefore be
accepted for this coverage whenever the body and header fields match.

**Attack transaction shape:** provide a valid f+1-signed report with the correct
coverage ref, terms hash, and workflow header, but with a 64-byte context whose
config-digest portion is not `config_digest` of the referenced config. The current
validator accepts it.

**Test that fails before a fix:**
`report_context_config_digest_mismatch_rejected`. Sign otherwise valid report data
with a context beginning with a different config digest and assert rejection.

### Low: payout checks are lower bounds, not exact payments, permitting tagged dust and avoidable min-ADA griefing

**Location:** `onchain/lib/cot/model.ak:89-95`; `onchain/lib/cot/cover.ak:63-75`

**Pattern:** value-preservation checks accept excess assets.

`covers` requires at least each requested quantity. It does not require the buyer
to receive exactly `payout`, or the underwriter to receive exactly the remainder.
A settler can attach arbitrary native-asset dust and extra lovelace to tagged
outputs. Conversely, a payout below the ledger's minimum ADA for its output shape
cannot be emitted as a bare exact output and requires an external top-up. This is
not a direct theft path, but it permits recipient griefing and makes the documented
exact-payment behavior depend on transaction construction.

**Attack transaction shape:** on FAILURE, pay the buyer `payout` plus an unwanted
native asset in the coverage-tagged output, and pay the underwriter more than the
required remainder in its tagged output. The validator accepts both.

**Test that fails before a fix:**
`failure_settlement_rejects_excess_payout_assets_or_explicitly_allows_them`.
Add a native asset to the buyer output and assert the chosen policy: reject it for
exact payments, or document and test that recipients intentionally accept excess
assets. Also test a payout below min-ADA with and without an explicit top-up.

## Requested checks with no additional finding

- Signer deduplication is present in `cre.ak:86-97`; it derives the address from
  `keccak256(pubkey)[12..32]`, rejects duplicate derived addresses, checks
  allowlist membership, and verifies the signature against the compressed key.
- The workflow owner, name, and CID are compared to the referenced config in
  `cover.ak:57-59`. The missing domain binding is the separate context finding
  above. Header fields not used by the protocol, such as timestamp and DON ID,
  should not be treated as security pins unless they are part of the intended
  authorization domain.
- Replay of one signed report across two coverage UTxOs is blocked by the body
  coverage transaction hash and index checks at `cover.ak:61-62`, assuming the
  report is re-signed when its body changes.
- Missing datums fail via `expect Some` in both spending validators. Beneficiary
  and buyer full-address comparisons include staking credentials, while the
  underwriter and sponsor checks intentionally match payment credentials only.
- `Claim` is strictly before expiry and `Forfeit` is at or after expiry, so the
  expiry boundary itself is not overlapping. Anyone-can-claim is safe for the
  beneficiary's fixed address and full-value check, but it remains subject to the
  critical cross-validator issue above.
- Config NFT minting consumes the parameter UTxO and mints exactly one token under
  the supplied policy. The material gap is post-mint datum mutability, not a
  second mint through the same one-shot policy.

## Summary

| Severity | Count | Finding |
|---|---:|---|
| Critical | 1 | Cross-validator double satisfaction can redirect vault value |
| High | 2 | Late settlement; task reference not authenticated |
| Medium | 2 | Mutable config NFT; context not bound to config |
| Low | 1 | Excess assets and min-ADA griefing |

The Critical and High findings should be fixed before value-bearing deployment.

