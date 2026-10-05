# On-chain security review (opus)

Scope: `onchain/validators/{claim_vault,config_nft,coverage}.ak`, `onchain/lib/cot/{model,cre,vault,cover,config}.ak`, read against `docs/SPEC.md` section 6 and the workflow rules in section 7 (line 98). Aiken v1.1.19, stdlib v3.0.0, Plutus V3. Commit reviewed: `67fd621`.

Method: line-by-line read of every validator path, then each exploitable finding was reproduced as an Aiken test in a scratch copy (`/tmp/cot-poc/lib/cot/poc_test.ak`, not committed) against the unmodified validators. All 5 proof-of-concept tests pass today (the attack is accepted, or the protective path is impossible), and the full suite stays at 49/49 green alongside them. Two PoCs were mutation-checked: pinning `b = a` in the vault PoC and requiring `stake_credential == None` in `paid_to_key` each turn the corresponding PoC red; restored, green again.

Summary

| ID | Severity | Location | Title |
|---|---|---|---|
| H-1 | High | `lib/cot/cover.ak:43-79`, `:74-75` | INCONCLUSIVE is terminal and Settle has no time bound: a premature INCONCLUSIVE report releases the collateral before the task is decided |
| M-1 | Medium | `lib/cot/model.ak:148-160`, `lib/cot/vault.ak:21,26` | claim_vault double satisfaction across stake-variant script addresses (and any untagged co-spent payout) |
| M-2 | Medium | `lib/cot/cover.ak:37-42,63-73`, `lib/cot/model.ak:28-39` | Underwriter-controlled datum is never validated at lock time: payout above collateral, decide_by before the claim expiry, or a dead config_digest yields cover that can never pay |
| M-3 | Medium | `lib/cot/model.ak:35`, `lib/cot/cre.ak:5`, `lib/cot/cover.ak:60-62` | `task_ref` is dead on chain and the report body does not commit to which task was adjudicated |
| L-1 | Low | `lib/cot/model.ak:100-119`, `lib/cot/cover.ak:46,70,75` | Permissionless Settle lets the submitter choose the stake credential of the underwriter's output |
| L-2 | Low | `lib/cot/config.ak:20-28` | config_nft mint does not constrain where the NFT goes; a spendable holder can rewrite the config and brick every live Settle |
| L-3 | Low | `lib/cot/model.ak:163-173` | config_ok accepts duplicate signers (threshold unreachable) and f = 0 (single-signer trust) |
| L-4 | Low | `lib/cot/vault.ak:26`, `lib/cot/cover.ak:68` | Beneficiary and buyer outputs have uncontrolled (vault) or forced (coverage) datums; script-address payees can be stranded |
| I-1..I-6 | Info | see below | Checks that hold: signer dedup, pubkey binding, replay, header pinning, expiry boundary, anyone-can-claim |

No Critical: no path found where an outsider moves value to themselves from a correctly locked coverage UTxO without a DON-signed report, and the CRE verification itself holds.

---

## H-1. INCONCLUSIVE is terminal and Settle has no time bound

Location: `lib/cot/cover.ak:43-79` (no validity-range check anywhere in `Settle`), `lib/cot/cover.ak:74-75` (INCONCLUSIVE pays all to the underwriter).

The SPEC section 7 workflow (SPEC.md:98) classifies SUCCESS as "claimed before expiry", FAILURE as "forfeited or unspent after expiry", and everything else as INCONCLUSIVE. A claim_vault that is unspent and not yet expired is neither SUCCESS nor FAILURE, so a run triggered early classifies INCONCLUSIVE. The trigger is an HTTP call carrying `{coverageRef, taskRef, termsHash}`; the report body binds only this coverage out-ref and terms_hash, so the DON-signed INCONCLUSIVE is a perfectly valid report for this coverage. On chain, Settle accepts it at any time, with no signer, and pays the full collateral to the underwriter.

Attack (underwriter, or anyone who sees the published report):
1. Coverage C locked at T0, claim_vault V expires at E, decide_by = D > E.
2. At T1 < E, with V unspent, trigger the workflow for C. DON signs INCONCLUSIVE (decision byte 2) bound to C's out-ref.
3. Submit: inputs `[C (Settle{report_inconclusive, ctx, sigs, pubkeys})]`, reference inputs `[config NFT UTxO]`, outputs `[underwriter key address, value = C.value, inline datum = C out-ref]`, validity range unbounded, no extra signatories.
4. C is gone. If the keeper then misses E, the FAILURE report that follows has no UTxO to settle against. The buyer paid for cover that existed only until the first early trigger.

A second, weaker form of the same root cause: several reports for one coverage can coexist (each execution has its own execution_id and timestamp, which are unpinned), and the first to land wins, so any non-final classification becomes a race.

Reproduced: `poc_inconclusive_settles_with_no_time_bound` (Settle INCONCLUSIVE with `interval.everything`) is accepted.

Fix (pick one):
- Drop the INCONCLUSIVE branch: an inconclusive outcome leaves the UTxO in place and the underwriter recovers it through Expire after `decide_by`. Smallest diff, and Expire already returns the full value.
- Or gate it: `decision == decision_inconclusive` additionally requires `lower_bound_from(tx, d.decide_by)`.
- Defence in depth for SUCCESS/FAILURE: add `claim_expiry` to `CoverageDatum` and require the header timestamp (bytes 33..37, big-endian seconds) to be `>= claim_expiry / 1000` for FAILURE and INCONCLUSIVE, so no pre-expiry run can produce a usable non-SUCCESS report.

Test that fails before the fix (add to `cover_test.ak`, uses its helpers):

```aiken
test inconclusive_before_decide_by_rejected() {
  !run(
    config(),
    settle(vectors.report_inconclusive, pick(vectors.sigs_inconclusive, [0, 1]), pick(vectors.pubkeys, [0, 1])),
    success_outputs(),
    interval.before(decide_by - 1),
    [],
  )
}
```

Note: the existing `inconclusive_settle_pays_underwriter` test asserts exactly the unsafe behaviour with `interval.before(2_000)` (before `decide_by`) and must be inverted with the fix.

---

## M-1. claim_vault double satisfaction across stake-variant addresses

Location: `lib/cot/model.ak:148-160` (`script_inputs_value` sums inputs whose full `Address` equals `own.address`), `lib/cot/vault.ak:21,26` (Claim pays the beneficiary with an untagged `paid_to_address(..., None)`).

The anti-double-satisfaction rule groups vault inputs by full address. The vault script hash with a different (or no) stake credential is a different address, so two vaults for the same beneficiary held at `Script(h)` and `Script(h) + stake X` are each checked against their own value only, and one output satisfies both. Claim is permissionless, so any keeper can do it.

Attack:
- Two sponsors lock 9 ADA each for beneficiary P, one at the enterprise vault address, one at a stake-variant (any wallet that delegates script UTxOs, or any third-party integrator, produces this).
- Attacker submits: inputs `[vault A (Claim), vault B (Claim)]`, outputs `[P: 9 ADA, attacker: 9 ADA]`, validity upper bound < expiry. Both validator runs see `locked = 9 ADA` and `paid_to_address(P) = 9 ADA`. Attacker keeps 9 ADA.

Same root cause, second shape: vault payouts are untagged, so any co-spent validator that also pays the beneficiary's exact address (a coverage FAILURE output to `buyer == beneficiary`, a SUCCESS output if `beneficiary` is the underwriter's address) is counted toward the vault as well. Under an honest DON the timing makes the coverage shapes infeasible today (Claim needs pre-expiry, FAILURE needs post-expiry evidence), but the vault's safety then rests on another validator's semantics.

The shipped off-chain (`offchain/src/index.ts:26`) locks every vault at the enterprise address, so the off-chain path alone does not produce the stake-variant pair; anyone can still lock at the staked variant.

Reproduced: `poc_vault_double_satisfaction_across_stake_variants` passes (both validations return True for one 9 ADA payment). Mutation: forcing both inputs to the same address turns it red.

Fix: group by payment credential instead of full address (`i.output.address.payment_credential == own.address.payment_credential` in `script_inputs_value`), or, better, tag each vault payout with the vault's own out-ref as inline datum exactly as coverage does and drop the summing scheme. Tagging also removes the cross-validator sharing.

Test that fails before the fix (add to `vault_test.ak`):

```aiken
test claim_two_vaults_at_stake_variant_addresses_with_one_payment_rejected() {
  let staked = Address { payment_credential: Script(vault_script), stake_credential: Some(Inline(VerificationKey(stranger_key))) }
  let b = Input { ..vault_input(1, 9_000_000), output: Output { ..vault_input(1, 9_000_000).output, address: staked } }
  !vault.validate(
    Some(datum()), Claim, ref(0),
    tx([vault_input(0, 9_000_000), b], [pay(wallet(beneficiary_key), 9_000_000), pay(wallet(stranger_key), 9_000_000)], interval.between(100, 999), []),
  )
}
```

---

## M-2. Underwriter-controlled datum is never validated at lock time

Location: `lib/cot/model.ak:28-39` (datum fields), `lib/cot/cover.ak:63-73` (FAILURE requires `lovelace_of(own.value) >= d.payout`), `lib/cot/cover.ak:37-42` (Expire), `lib/cot/cover.ak:48` (digest equality).

Coverage UTxOs are created by a plain payment to the script address: no minting policy or state token checks the datum. The underwriter writes `payout`, `decide_by`, `config_digest` and `buyer`, and each one can silently void the cover while it looks live:
- `payout > locked lovelace`: every FAILURE Settle is unsatisfiable, so the only exit is Expire to the underwriter. Reproduced: `poc_payout_above_collateral_makes_failure_unsettleable` (FAILURE with payout 50 ADA against 10 ADA locked is rejected for any outputs).
- `decide_by <= claim expiry` (or a few minutes after it): Expire opens before or immediately when the FAILURE becomes observable, and the underwriter front-runs the buyer's Settle at `decide_by`. Settle and Expire are both valid after `decide_by`; nothing on chain relates `decide_by` to the claim expiry, which is not even in the datum.
- `config_digest` not equal to the live config: Settle fails at `cover.ak:48` forever; Expire succeeds.
- `buyer` set to an address the buyer does not control.

Attack shape: underwriter submits a payment to the coverage address with value 10 ADA and datum `{ payout: 50 ADA, ... }` (or `decide_by = expiry`), collects the premium off chain, then after `decide_by` submits inputs `[C (Expire)]`, outputs `[underwriter tagged, C.value]`, `validFrom(decide_by)`, signed by the underwriter.

`offchain/src/index.ts:47` (`lockCoverage`) passes `payout`, `decideBy` and `value` through unchecked.

Fix: on chain, cap the FAILURE payout at the collateral (`let pay = min(d.payout, lovelace_of(own.value))`) so a FAILURE always pays out what exists; add `claim_expiry` to the datum and require `d.decide_by >= d.claim_expiry + grace` in both Settle and Expire, so a malformed datum cannot Expire early. For full assurance, mint a coverage state token at lock whose policy validates `payout <= lovelace`, `decide_by` against the vault datum (available as a reference input at lock), and `config_digest` against the config reference input; Settle and Expire then require the token. Off chain and in the workflow, reject any coverage whose datum fails these checks before the buyer pays.

Test that fails before the fix (with the capping fix):

```aiken
test failure_with_payout_above_collateral_pays_all_collateral_to_buyer() {
  // datum with payout 50 ADA over 10 ADA locked; buyer receives the full 10 ADA
  cover.validate(config_policy, Some(CoverageDatum { ..datum(), payout: 50_000_000 }), settle(...failure...), own_ref(),
    Transaction { ..placeholder, inputs: [cover_input_with(CoverageDatum { ..datum(), payout: 50_000_000 })],
      reference_inputs: [config_input(config())], outputs: [tagged(wallet(buyer_key), locked, own_ref())] })
}
```

---

## M-3. `task_ref` is dead on chain and the report does not name the task

Location: `lib/cot/model.ak:35` (`task_ref` field), never read in `lib/cot/cover.ak`; body layout `lib/cot/cre.ak:5` binds `terms_hash`, decision and the coverage out-ref only; checks at `lib/cot/cover.ak:60-62`.

`terms_hash` is an opaque 32 bytes: nothing on chain recomputes it from `task_ref`, `buyer`, `payout` or `decide_by`. The HTTP trigger carries `taskRef` as a separate argument from `coverageRef` (SPEC.md:98). If the workflow ever reads the task from the trigger instead of from the coverage datum, an underwriter triggers with `{coverageRef: C, taskRef: some other vault that was claimed in time}` and gets a SUCCESS report bound to C, which settles at `cover.ak:74-75`. Whether the workflow asserts `taskRef == datum.task_ref` is outside the reviewed files (UNVERIFIED); the on-chain contract cannot detect the substitution either way.

Attack shape: inputs `[C (Settle{report_success_for_other_task})]`, reference `[config]`, outputs `[underwriter tagged, C.value]`.

Fix: extend the body with `task_tx_hash(32) | task_index(2)` (report length 210) and require them to equal `d.task_ref` on chain, or require `d.terms_hash == blake2b_256(cbor.serialise((d.buyer, d.payout, d.task_ref, d.decide_by, d.underwriter)))` so the DON-signed terms_hash pins the datum.

Test that fails before the fix: generate a vector whose body names a task different from `datum().task_ref` (via `scripts/generate_vectors.mjs`) and assert `!settle_with(report_other_task, sigs_other_task, success_outputs())`. Today no such check exists, so the equivalent assertion on any current vector with `task_ref` mutated (`CoverageDatum { ..datum(), task_ref: own_ref() }`) still settles.

---

## L-1. Submitter chooses the stake credential of the underwriter's output

Location: `lib/cot/model.ak:100-119` (`paid_to_key` matches the payment credential only, "any stake part"), used by Settle at `lib/cot/cover.ak:46,70,75`.

Settle needs no signature, so whoever submits it (the buyer, a relayer, any observer of the report) builds the underwriter's output and may attach their own stake credential. The principal stays spendable only by the underwriter, but staking rewards and governance voting weight on the collateral go to the submitter until the underwriter moves it. Expire and Forfeit are signed by the recipient, so only Settle is affected.

Attack shape: inputs `[C (Settle{valid report})]`, outputs `[Address{VerificationKey(underwriter), Inline(VerificationKey(attacker))}: C.value, inline datum C out-ref]`.

Reproduced: `poc_settle_underwriter_output_with_attacker_stake_accepted` passes; requiring `stake_credential == None` in `paid_to_key` turns it red.

Fix: store the underwriter's full `Address` in the datum and use `paid_to_address` for the underwriter outputs in Settle.

Test that fails before the fix: the PoC above, negated, added to `cover_test.ak`.

---

## L-2. config_nft does not constrain the NFT's destination

Location: `lib/cot/config.ak:20-28` (any output holding the NFT with a valid datum passes). The suite's own valid-mint test pays it to a key wallet (`config_test.ak`, `nft_output` uses `wallet()`).

If the NFT lands at a spendable address, its holder can re-output it with a different datum. `config_from` (`cover.ak:16-25`) reads whichever reference input holds it, so every live coverage either fails the digest equality at `cover.ak:48` or fails decoding at `cover.ak:22-23`. No live Settle can pass, and every coverage drains through Expire to its underwriter. The holder can also restore the old datum later, so the bricking can be timed around a specific FAILURE.

The shipped off-chain (`offchain/src/index.ts:43`, `:26`) pays the NFT to the policy's own script address, whose spend handler is `else(_) { fail }` (`validators/config_nft.ak`), so the shipped deployment is immutable. The policy does not enforce it.

Fix: require the NFT output's `address.payment_credential == Script(policy_id)` in `config.validate`.

Test that fails before the fix: `!config.validate(seed_ref(), policy, mint_tx(seed_ref(), 1, InlineDatum(good())))` with `nft_output` paying `wallet()`, plus a positive test paying `Address { payment_credential: Script(policy), stake_credential: None }`.

---

## L-3. config_ok accepts duplicate signers and f = 0

Location: `lib/cot/model.ak:163-173`.

`list.length(c.signers) >= c.f + 1` counts duplicates, while `check_proofs` (`cre.ak:90-91`) correctly dedups. A config of `[s0, s0]` with `f = 1` mints, and no report can ever reach 2 distinct signers, so the whole deployment can only Expire. `f >= 0` also admits a single-signature DON. Reproduced: `poc_duplicate_signer_config_accepted` passes.

Fix: add `list.unique(c.signers) == c.signers` (or a sorted strictly-increasing check), and require `f >= 1` if the deployment assumes a Byzantine DON (`n >= 3f + 1`).

Test that fails before the fix: `!config.validate(seed_ref(), policy, mint_tx(seed_ref(), 1, InlineDatum(ConfigDatum { ..good(), signers: [s0, s0], f: 1 })))`.

---

## L-4. Payee datums: uncontrolled on the vault, forced on coverage

Location: `lib/cot/vault.ak:26` (Claim checks address and value only), `lib/cot/cover.ak:68` (buyer output must carry `InlineDatum(own_ref)`).

Claim is permissionless and the output datum is unconstrained. If `beneficiary` is a Plutus script address that expects a specific datum, any keeper can Claim with `NoDatum` or a garbage datum and strand the funds there. Conversely, coverage forces the buyer's payout to carry the coverage out-ref as datum, which a script buyer will not accept. Key-hash payees are unaffected; the shipped off-chain encodes key addresses only (`offchain/src/index.ts:19-21`).

Fix: restrict `beneficiary` and `buyer` payment credentials to `VerificationKey` at Settle/Claim time (fail closed), or carry an expected payee datum in the claim datum and require it.

Test that fails before the fix: `!vault.validate(Some(ClaimDatum { ..datum(), beneficiary: Address { payment_credential: Script(vault_script), stake_credential: None } }), Claim, ref(0), tx([vault_input(0, 9_000_000)], [pay(<that script address>, 9_000_000)], interval.between(100, 999), []))`.

---

## Info: properties that hold

- I-1 Signer dedup and binding (`cre.ak:76-102`): every supplied pair must verify, the address is `keccak256(pk)[12..32]`, `seen` blocks reuse of one address, and `sigs`/`pubkeys` length mismatch fails (`_ -> False`). An off-curve `y` sharing `x` and parity compresses to the real key but hashes to an unrelated address, so aliasing an allowlisted address needs a keccak preimage.
- I-2 Replay: the body binds the coverage tx hash and index (`cover.ak:61-62`), which are consumed once, so a report cannot settle a second coverage. Config rotation cannot reach live UTxOs because `config_digest` covers every config field with fixed widths and a length prefix (`model.ak:176-184`).
- I-3 Header pinning: owner, name and cid are checked (`cover.ak:57-59`); version, don_id, don_config_version, report_id and the 64-byte context are not, which is acceptable because the signer allowlist itself is pinned by the digest.
- I-4 Two coverage UTxOs in one transaction: every coverage output is tagged with the coverage out-ref (`model.ak:140-145`), so one output cannot count twice.
- I-5 Claim/Forfeit boundary: Claim needs a finite upper bound `< expiry`, Forfeit a finite lower bound `>= expiry`; the windows are disjoint and the ignored inclusivity flags only make the checks stricter (`model.ak:63-76`).
- I-6 Anyone-can-claim front-running is safe: `covers` with `>=` forces the full locked value to the beneficiary's exact address whoever submits; a losing keeper's transaction fails phase 1 on the spent input and loses no collateral. Only L-4 (datum) and M-1 (multi-vault) let the submitter do anything other than pay the fee.
- Min-ADA: on chain, FAILURE is never blocked by min-UTxO because `covers` uses `>=` (the submitter may top up) and a zero remainder needs no output. The shipped `settle` (`offchain/src/index.ts:49`) builds the underwriter output with exactly `lovelace - payout`, which is zero or sub-minimum when payout equals or nearly equals the collateral; whether Lucid raises it automatically is UNVERIFIED.

## Blind spot

The CRE workflow source was out of scope, so H-1 and M-3 are graded on SPEC section 7's stated classification and trigger shape rather than the deployed workflow; ECDSA verification was exercised only against the repo's own `generate_vectors.mjs` vectors, not a live DON report.
