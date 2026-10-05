use aiken/collection/list
use aiken/interval
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use cot/config
use cot/cover
use cot/model.{
  Claim, ClaimDatum, ConfigDatum, CoverageDatum, CoverageRedeemer, Settle,
  config_nft_name,
}
use cot/vault
use cot/vectors

// Attack tests for the two independent security reviews (onchain/SECURITY-codex.md, SECURITY-opus.md).
// Each was written first against the unfixed validators, where it failed (the attack was accepted), and
// passes once the fix landed. onchain/SECURITY-FIXED.md maps every finding to its test.

const underwriter: ByteArray =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const buyer_key: ByteArray =
  #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

const stranger_key: ByteArray =
  #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

const script_hash: ByteArray =
  #"dddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

const cover_hash: ByteArray =
  #"dededededededededededededededededededededededededededede"

const config_policy: ByteArray =
  #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

fn wallet(key: ByteArray) -> Address {
  Address { payment_credential: VerificationKey(key), stake_credential: None }
}

fn vault_ref(n: Int) -> OutputReference {
  OutputReference {
    transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
    output_index: n,
  }
}

fn cover_ref() -> OutputReference {
  OutputReference {
    transaction_id: vectors.coverage_tx,
    output_index: vectors.coverage_index,
  }
}

fn claim_datum() -> ClaimDatum {
  ClaimDatum {
    beneficiary: wallet(buyer_key),
    expiry: 1_000_000,
    sponsor: underwriter,
  }
}

fn vault_input(n: Int, lovelace: Int, address: Address) -> Input {
  Input {
    output_reference: vault_ref(n),
    output: Output {
      address,
      value: assets.from_lovelace(lovelace),
      datum: InlineDatum(claim_datum()),
      reference_script: None,
    },
  }
}

fn plain_vault_address() -> Address {
  Address { payment_credential: Script(script_hash), stake_credential: None }
}

fn staked_vault_address() -> Address {
  Address {
    payment_credential: Script(script_hash),
    stake_credential: Some(Inline(VerificationKey(stranger_key))),
  }
}

fn pay(address: Address, lovelace: Int) -> Output {
  Output {
    address,
    value: assets.from_lovelace(lovelace),
    datum: NoDatum,
    reference_script: None,
  }
}

fn tagged(address: Address, lovelace: Int, tag: OutputReference) -> Output {
  Output {
    address,
    value: assets.from_lovelace(lovelace),
    datum: InlineDatum(tag),
    reference_script: None,
  }
}

const task_expiry = 1_000

const decide_by = 2_000

fn task_ref() -> OutputReference {
  OutputReference {
    transaction_id: vectors.task_tx,
    output_index: vectors.task_index,
  }
}

fn cover_datum(payout: Int) -> CoverageDatum {
  CoverageDatum {
    terms_hash: vectors.terms_hash,
    buyer: wallet(buyer_key),
    underwriter: wallet(underwriter),
    payout,
    task_ref: task_ref(),
    task_expiry,
    decide_by,
    config_digest: vectors.config_digest,
  }
}

fn window() -> interval.Interval {
  interval.between(task_expiry, decide_by)
}

fn cover_input(datum: CoverageDatum, lovelace: Int) -> Input {
  Input {
    output_reference: cover_ref(),
    output: Output {
      address: Address {
        payment_credential: Script(cover_hash),
        stake_credential: None,
      },
      value: assets.from_lovelace(lovelace),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  }
}

fn config() -> ConfigDatum {
  ConfigDatum {
    signers: vectors.signers,
    f: vectors.f,
    workflow_owner: vectors.owner,
    workflow_name: vectors.name,
    workflow_cid: vectors.cid,
    don_config_digest: vectors.don_config_digest,
  }
}

fn config_input() -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"2222222222222222222222222222222222222222222222222222222222222222",
      output_index: 0,
    },
    output: Output {
      address: wallet(stranger_key),
      value: assets.add(
        assets.from_lovelace(2_000_000),
        config_policy,
        config_nft_name,
        1,
      ),
      datum: InlineDatum(config()),
      reference_script: None,
    },
  }
}

fn pick(xs: List<a>, idx: List<Int>) -> List<a> {
  list.map(
    idx,
    fn(i) {
      expect Some(x) = list.at(xs, i)
      x
    },
  )
}

fn settle(
  raw: ByteArray,
  sigs: List<ByteArray>,
  context: ByteArray,
) -> CoverageRedeemer {
  Settle {
    raw_report: raw,
    report_context: context,
    sigs: pick(sigs, [0, 1]),
    pubkeys: pick(vectors.pubkeys, [0, 1]),
  }
}

fn cover_tx(
  inputs: List<Input>,
  outputs: List<Output>,
  validity: interval.Interval,
) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs,
    reference_inputs: [config_input()],
    outputs,
    validity_range: validity,
  }
}

fn settle_failure(
  datum: CoverageDatum,
  lovelace: Int,
  outputs: List<Output>,
  validity: interval.Interval,
) -> Bool {
  cover.validate(
    config_policy,
    Some(datum),
    settle(vectors.report_failure, vectors.sigs_failure, vectors.context),
    cover_ref(),
    cover_tx([cover_input(datum, lovelace)], outputs, validity),
  )
}

fn failure_outputs(payout: Int, lovelace: Int) -> List<Output> {
  [
    tagged(wallet(buyer_key), payout, cover_ref()),
    tagged(wallet(underwriter), lovelace - payout, cover_ref()),
  ]
}

// Opus M-1: the same vault script at two stake variants is two addresses.
test claim_two_vaults_at_stake_variant_addresses_with_one_payment_rejected() {
  let tx =
    cover_tx(
      [
        vault_input(0, 9_000_000, plain_vault_address()),
        vault_input(1, 9_000_000, staked_vault_address()),
      ],
      [
        tagged(wallet(buyer_key), 9_000_000, vault_ref(0)),
        tagged(wallet(stranger_key), 9_000_000, vault_ref(1)),
      ],
      interval.between(100, 999),
    )
  !vault.validate(Some(claim_datum()), Claim, vault_ref(0), tx)
}

// Non-vacuity guard for the test above: one staked-variant vault, one tagged payment, accepted.
test claim_single_vault_at_a_stake_variant_address_with_tagged_payment_ok() {
  let tx =
    cover_tx(
      [vault_input(0, 9_000_000, staked_vault_address())],
      [tagged(wallet(buyer_key), 9_000_000, vault_ref(0))],
      interval.between(100, 999),
    )
  vault.validate(Some(claim_datum()), Claim, vault_ref(0), tx)
}

// Vault batches are unsupported: exactly one vault input per transaction.
test claim_two_vaults_in_one_tx_rejected() {
  let tx =
    cover_tx(
      [
        vault_input(0, 9_000_000, plain_vault_address()),
        vault_input(1, 9_000_000, plain_vault_address()),
      ],
      [tagged(wallet(buyer_key), 18_000_000, vault_ref(0))],
      interval.between(100, 999),
    )
  !vault.validate(Some(claim_datum()), Claim, vault_ref(0), tx)
}

// Vault payouts carry the vault out-ref as their tag.
test claim_untagged_payment_rejected() {
  let tx =
    cover_tx(
      [vault_input(0, 9_000_000, plain_vault_address())],
      [pay(wallet(buyer_key), 9_000_000)],
      interval.between(100, 999),
    )
  !vault.validate(Some(claim_datum()), Claim, vault_ref(0), tx)
}

// Codex Critical: one coverage-tagged payment to the beneficiary must not also release the vault.
test vault_and_coverage_cannot_share_one_tagged_beneficiary_payment() {
  let datum = cover_datum(9_000_000)
  let tx =
    cover_tx(
      [
        vault_input(0, 9_000_000, plain_vault_address()),
        cover_input(datum, 12_000_000),
      ],
      [
        tagged(wallet(buyer_key), 9_000_000, cover_ref()),
        tagged(wallet(underwriter), 12_000_000, cover_ref()),
      ],
      interval.between(task_expiry, 1_500),
    )
  let coverage_accepts =
    cover.validate(
      config_policy,
      Some(datum),
      settle(vectors.report_failure, vectors.sigs_failure, vectors.context),
      cover_ref(),
      tx,
    )
  let vault_accepts =
    vault.validate(Some(claim_datum()), Claim, vault_ref(0), tx)
  and {
    coverage_accepts,
    !vault_accepts,
  }
}

// Coverage batches are unsupported: exactly one coverage input per transaction.
test settle_two_coverage_inputs_in_one_tx_rejected() {
  let datum = cover_datum(4_000_000)
  let second =
    Input {
      output_reference: OutputReference {
        transaction_id: #"4444444444444444444444444444444444444444444444444444444444444444",
        output_index: 0,
      },
      output: Output {
        address: Address {
          payment_credential: Script(cover_hash),
          stake_credential: None,
        },
        value: assets.from_lovelace(10_000_000),
        datum: InlineDatum(datum),
        reference_script: None,
      },
    }
  let tx =
    cover_tx(
      [cover_input(datum, 10_000_000), second],
      failure_outputs(4_000_000, 10_000_000),
      window(),
    )
  !cover.validate(
    config_policy,
    Some(datum),
    settle(vectors.report_failure, vectors.sigs_failure, vectors.context),
    cover_ref(),
    tx,
  )
}

// Codex High: Settle needs a finite upper bound at or before decide_by.
test settle_after_decide_by_rejected() {
  !settle_failure(
    cover_datum(4_000_000),
    10_000_000,
    failure_outputs(4_000_000, 10_000_000),
    interval.after(2_000),
  )
}

// Opus H-1: INCONCLUSIVE is never settleable.
test inconclusive_settle_rejected() {
  !cover.validate(
    config_policy,
    Some(cover_datum(4_000_000)),
    settle(
      vectors.report_inconclusive,
      vectors.sigs_inconclusive,
      vectors.context,
    ),
    cover_ref(),
    cover_tx(
      [cover_input(cover_datum(4_000_000), 10_000_000)],
      [tagged(wallet(underwriter), 10_000_000, cover_ref())],
      window(),
    ),
  )
}

// Opus M-3 / Codex High: the datum task_ref must be the task the DON adjudicated.
test settle_requires_the_datum_task_ref() {
  let other_task =
    OutputReference {
      transaction_id: #"6666666666666666666666666666666666666666666666666666666666666666",
      output_index: 9,
    }
  !settle_failure(
    CoverageDatum { ..cover_datum(4_000_000), task_ref: other_task },
    10_000_000,
    failure_outputs(4_000_000, 10_000_000),
    window(),
  )
}

// Codex Medium: the DON-signed context must open with the pinned DON config digest.
test report_context_config_digest_mismatch_rejected() {
  !cover.validate(
    config_policy,
    Some(cover_datum(4_000_000)),
    settle(
      vectors.report_failure,
      vectors.sigs_failure_other_context,
      vectors.context_other,
    ),
    cover_ref(),
    cover_tx(
      [cover_input(cover_datum(4_000_000), 10_000_000)],
      failure_outputs(4_000_000, 10_000_000),
      window(),
    ),
  )
}

// Opus L-1: the underwriter payout goes to the datum address, never a submitter-chosen stake part.
test settle_underwriter_output_with_attacker_stake_rejected() {
  let attacker_staked =
    Address {
      payment_credential: VerificationKey(underwriter),
      stake_credential: Some(Inline(VerificationKey(stranger_key))),
    }
  !settle_failure(
    cover_datum(4_000_000),
    10_000_000,
    [
      tagged(wallet(buyer_key), 4_000_000, cover_ref()),
      tagged(attacker_staked, 6_000_000, cover_ref()),
    ],
    window(),
  )
}

// Opus M-2 / SPEC: FAILURE fails closed when payout leaves under 2 ADA of headroom.
test failure_with_payout_above_collateral_headroom_rejected() {
  !settle_failure(
    cover_datum(8_000_001),
    10_000_000,
    failure_outputs(8_000_001, 10_000_000),
    window(),
  )
}

test failure_with_payout_at_the_headroom_limit_ok() {
  settle_failure(
    cover_datum(8_000_000),
    10_000_000,
    failure_outputs(8_000_000, 10_000_000),
    window(),
  )
}

// Opus L-2 / Codex Medium: the config NFT must land at the always-fail lock, not a spendable wallet.
const lock_hash: ByteArray =
  #"f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0"

fn nft_seed() -> OutputReference {
  OutputReference {
    transaction_id: #"5555555555555555555555555555555555555555555555555555555555555555",
    output_index: 1,
  }
}

fn nft_mint_tx(address: Address, cfg: ConfigDatum) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs: [
      Input {
        output_reference: nft_seed(),
        output: pay(wallet(stranger_key), 5_000_000),
      },
    ],
    outputs: [
      Output {
        address,
        value: assets.add(
          assets.from_lovelace(2_000_000),
          config_policy,
          config_nft_name,
          1,
        ),
        datum: InlineDatum(cfg),
        reference_script: None,
      },
    ],
    mint: assets.add(assets.zero, config_policy, config_nft_name, 1),
    validity_range: interval.everything,
  }
}

fn at_lock() -> Address {
  Address { payment_credential: Script(lock_hash), stake_credential: None }
}

fn mint_ok(cfg: ConfigDatum) -> Bool {
  config.validate(
    nft_seed(),
    lock_hash,
    config_policy,
    nft_mint_tx(at_lock(), cfg),
  )
}

test mint_paying_the_nft_to_the_lock_ok() {
  mint_ok(config())
}

test mint_paying_the_nft_to_a_spendable_wallet_rejected() {
  !config.validate(
    nft_seed(),
    lock_hash,
    config_policy,
    nft_mint_tx(wallet(stranger_key), config()),
  )
}

test mint_paying_the_nft_to_another_script_rejected() {
  !config.validate(
    nft_seed(),
    lock_hash,
    config_policy,
    nft_mint_tx(
      Address {
        payment_credential: Script(script_hash),
        stake_credential: None,
      },
      config(),
    ),
  )
}

// Opus L-3 and the DON sizing rule: unique signers, f >= 1, at least 2f + 1 signers.
test mint_with_duplicate_signers_rejected() {
  expect [s0, s1, s2, ..] = vectors.signers
  and {
    mint_ok(ConfigDatum { ..config(), signers: [s0, s1, s2] }),
    !mint_ok(ConfigDatum { ..config(), signers: [s0, s0, s1] }),
  }
}

test mint_with_f_zero_rejected() {
  !mint_ok(ConfigDatum { ..config(), f: 0 })
}

test mint_with_fewer_than_two_f_plus_one_signers_rejected() {
  !mint_ok(
    ConfigDatum { ..config(), signers: pick(vectors.signers, [0, 1]), f: 1 },
  )
}

test mint_with_a_short_don_config_digest_rejected() {
  !mint_ok(ConfigDatum { ..config(), don_config_digest: #"aabb" })
}

fn baseline_settle() -> Bool {
  settle_failure(
    cover_datum(4_000_000),
    10_000_000,
    failure_outputs(4_000_000, 10_000_000),
    window(),
  )
}

// Non-vacuity guard: the legitimate FAILURE settlement every rejection test above mutates.
test baseline_failure_settle_accepted() {
  baseline_settle()
}

test settle_before_task_expiry_rejected() {
  !settle_failure(
    cover_datum(4_000_000),
    10_000_000,
    failure_outputs(4_000_000, 10_000_000),
    interval.between(task_expiry - 1, decide_by),
  )
}

test settle_without_a_finite_upper_bound_rejected() {
  !settle_failure(
    cover_datum(4_000_000),
    10_000_000,
    failure_outputs(4_000_000, 10_000_000),
    interval.after(task_expiry),
  )
}

test settle_with_upper_bound_past_decide_by_rejected() {
  !settle_failure(
    cover_datum(4_000_000),
    10_000_000,
    failure_outputs(4_000_000, 10_000_000),
    interval.between(task_expiry, decide_by + 1),
  )
}

test report_naming_another_task_rejected() {
  and {
    baseline_settle(),
    !cover.validate(
      config_policy,
      Some(cover_datum(4_000_000)),
      settle(
        vectors.report_wrong_task,
        vectors.sigs_wrong_task,
        vectors.context,
      ),
      cover_ref(),
      cover_tx(
        [cover_input(cover_datum(4_000_000), 10_000_000)],
        failure_outputs(4_000_000, 10_000_000),
        window(),
      ),
    ),
  }
}

test report_naming_another_task_index_rejected() {
  and {
    baseline_settle(),
    !cover.validate(
      config_policy,
      Some(cover_datum(4_000_000)),
      settle(
        vectors.report_wrong_task_index,
        vectors.sigs_wrong_task_index,
        vectors.context,
      ),
      cover_ref(),
      cover_tx(
        [cover_input(cover_datum(4_000_000), 10_000_000)],
        failure_outputs(4_000_000, 10_000_000),
        window(),
      ),
    ),
  }
}

test success_settle_in_the_window_ok() {
  cover.validate(
    config_policy,
    Some(cover_datum(4_000_000)),
    settle(vectors.report_success, vectors.sigs_success, vectors.context),
    cover_ref(),
    cover_tx(
      [cover_input(cover_datum(4_000_000), 10_000_000)],
      [tagged(wallet(underwriter), 10_000_000, cover_ref())],
      window(),
    ),
  )
}

test expire_to_an_address_with_another_stake_part_rejected() {
  let attacker_staked =
    Address {
      payment_credential: VerificationKey(underwriter),
      stake_credential: Some(Inline(VerificationKey(stranger_key))),
    }
  let expire_tx =
    fn(to: Address) -> Bool {
      cover.validate(
        config_policy,
        Some(cover_datum(4_000_000)),
        model.Expire,
        cover_ref(),
        Transaction {
          ..cover_tx(
            [cover_input(cover_datum(4_000_000), 10_000_000)],
            [tagged(to, 10_000_000, cover_ref())],
            interval.after(decide_by),
          ),
          extra_signatories: [underwriter],
        },
      )
    }
  and {
    expire_tx(wallet(underwriter)),
    !expire_tx(attacker_staked),
  }
}

test expire_two_coverage_inputs_in_one_tx_rejected() {
  let datum = cover_datum(4_000_000)
  let second =
    Input {
      ..cover_input(datum, 10_000_000),
      output_reference: OutputReference {
        transaction_id: #"4444444444444444444444444444444444444444444444444444444444444444",
        output_index: 0,
      },
    }
  let expire =
    fn(inputs: List<Input>) -> Bool {
      cover.validate(
        config_policy,
        Some(datum),
        model.Expire,
        cover_ref(),
        Transaction {
          ..cover_tx(
            inputs,
            [tagged(wallet(underwriter), 10_000_000, cover_ref())],
            interval.after(decide_by),
          ),
          extra_signatories: [underwriter],
        },
      )
    }
  and {
    expire([cover_input(datum, 10_000_000)]),
    !expire([cover_input(datum, 10_000_000), second]),
  }
}
