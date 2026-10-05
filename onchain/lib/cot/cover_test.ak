use aiken/builtin
use aiken/collection/list
use aiken/interval
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use cot/cover
use cot/model.{
  ConfigDatum, CoverageDatum, CoverageRedeemer, Expire, Settle, config_digest,
  config_nft_name,
}
use cot/vectors

const underwriter: ByteArray =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const buyer_key: ByteArray =
  #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

const stranger_key: ByteArray =
  #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

const cover_script: ByteArray =
  #"dddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

const config_policy: ByteArray =
  #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

const task_expiry = 1_000

const decide_by = 2_000

const locked = 10_000_000

const payout = 4_000_000

fn wallet(key: ByteArray) -> Address {
  Address { payment_credential: VerificationKey(key), stake_credential: None }
}

fn own_ref() -> OutputReference {
  OutputReference {
    transaction_id: vectors.coverage_tx,
    output_index: vectors.coverage_index,
  }
}

fn task() -> OutputReference {
  OutputReference {
    transaction_id: vectors.task_tx,
    output_index: vectors.task_index,
  }
}

fn window() -> interval.Interval {
  interval.between(task_expiry, decide_by)
}

fn other_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"4444444444444444444444444444444444444444444444444444444444444444",
    output_index: 0,
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

fn datum() -> CoverageDatum {
  CoverageDatum {
    terms_hash: vectors.terms_hash,
    buyer: wallet(buyer_key),
    underwriter: wallet(underwriter),
    payout,
    task_ref: task(),
    task_expiry,
    decide_by,
    config_digest: vectors.config_digest,
  }
}

fn cover_input() -> Input {
  Input {
    output_reference: own_ref(),
    output: Output {
      address: Address {
        payment_credential: Script(cover_script),
        stake_credential: None,
      },
      value: assets.from_lovelace(locked),
      datum: InlineDatum(datum()),
      reference_script: None,
    },
  }
}

fn config_input(cfg: ConfigDatum) -> Input {
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
      datum: InlineDatum(cfg),
      reference_script: None,
    },
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

fn failure_outputs() -> List<Output> {
  [
    tagged(wallet(buyer_key), payout, own_ref()),
    tagged(wallet(underwriter), locked - payout, own_ref()),
  ]
}

fn success_outputs() -> List<Output> {
  [tagged(wallet(underwriter), locked, own_ref())]
}

fn run(
  cfg: ConfigDatum,
  redeemer: CoverageRedeemer,
  outputs: List<Output>,
  validity: interval.Interval,
  signatories: List<ByteArray>,
) -> Bool {
  cover.validate(
    config_policy,
    Some(datum()),
    redeemer,
    own_ref(),
    Transaction {
      ..transaction.placeholder,
      inputs: [cover_input()],
      reference_inputs: [config_input(cfg)],
      outputs,
      validity_range: validity,
      extra_signatories: signatories,
    },
  )
}

fn settle(
  raw: ByteArray,
  sigs: List<ByteArray>,
  pubkeys: List<ByteArray>,
) -> CoverageRedeemer {
  Settle { raw_report: raw, report_context: vectors.context, sigs, pubkeys }
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

/// A settle of `raw` signed by DON signers 0 and 1 (f + 1 = 2) paying `outputs`.
fn settle_with(
  raw: ByteArray,
  sigs: List<ByteArray>,
  outputs: List<Output>,
) -> Bool {
  run(
    config(),
    settle(raw, pick(sigs, [0, 1]), pick(vectors.pubkeys, [0, 1])),
    outputs,
    window(),
    [],
  )
}

fn flip_byte(raw: ByteArray, at: Int) -> ByteArray {
  let n = builtin.length_of_bytearray(raw)
  let b = builtin.index_bytearray(raw, at)
  builtin.slice_bytearray(0, at, raw)
    |> builtin.append_bytearray(
        builtin.integer_to_bytearray(True, 1, ( b + 1 ) % 256),
      )
    |> builtin.append_bytearray(
        builtin.slice_bytearray(at + 1, n - at - 1, raw),
      )
}

test config_digest_matches_the_generator() {
  config_digest(config()) == vectors.config_digest
}

test failure_settle_pays_payout_to_buyer_and_rest_to_underwriter() {
  settle_with(vectors.report_failure, vectors.sigs_failure, failure_outputs())
}

test success_settle_pays_underwriter() {
  settle_with(vectors.report_success, vectors.sigs_success, success_outputs())
}

test inconclusive_settle_rejected() {
  !settle_with(
    vectors.report_inconclusive,
    vectors.sigs_inconclusive,
    success_outputs(),
  )
}

test success_settle_paying_buyer_instead_rejected() {
  !settle_with(
    vectors.report_success,
    vectors.sigs_success,
    [tagged(wallet(buyer_key), locked, own_ref())],
  )
}

test one_flipped_byte_in_raw_report_rejected() {
  // Byte 5 sits in the execution id: every field check still passes, only the signatures break.
  and {
    settle_with(vectors.report_failure, vectors.sigs_failure, failure_outputs()),
    !settle_with(
      flip_byte(vectors.report_failure, 5),
      vectors.sigs_failure,
      failure_outputs(),
    ),
  }
}

test f_signatures_not_f_plus_one_rejected() {
  !run(
    config(),
    settle(
      vectors.report_failure,
      pick(vectors.sigs_failure, [0]),
      pick(vectors.pubkeys, [0]),
    ),
    failure_outputs(),
    window(),
    [],
  )
}

test f_plus_one_signatures_accepted_from_any_two_signers() {
  run(
    config(),
    settle(
      vectors.report_failure,
      pick(vectors.sigs_failure, [3, 2]),
      pick(vectors.pubkeys, [3, 2]),
    ),
    failure_outputs(),
    window(),
    [],
  )
}

test duplicate_signer_counted_twice_rejected() {
  !run(
    config(),
    settle(
      vectors.report_failure,
      pick(vectors.sigs_failure, [0, 0]),
      pick(vectors.pubkeys, [0, 0]),
    ),
    failure_outputs(),
    window(),
    [],
  )
}

test non_allowlisted_signer_rejected() {
  !run(
    config(),
    settle(
      vectors.report_failure,
      [builtin.head_list(vectors.sigs_failure), vectors.outsider_sig_failure],
      [builtin.head_list(vectors.pubkeys), vectors.outsider_pubkey],
    ),
    failure_outputs(),
    window(),
    [],
  )
}

test signature_from_a_different_key_than_the_pubkey_rejected() {
  // Allowlisted pubkeys, but the second signature was made by signer 2 not signer 1.
  !run(
    config(),
    settle(
      vectors.report_failure,
      pick(vectors.sigs_failure, [0, 2]),
      pick(vectors.pubkeys, [0, 1]),
    ),
    failure_outputs(),
    window(),
    [],
  )
}

test body_for_a_different_coverage_out_ref_rejected() {
  !settle_with(
    vectors.report_wrong_ref,
    vectors.sigs_wrong_ref,
    failure_outputs(),
  )
}

test body_for_a_different_coverage_index_rejected() {
  !settle_with(
    vectors.report_wrong_index,
    vectors.sigs_wrong_index,
    failure_outputs(),
  )
}

test wrong_terms_hash_rejected() {
  !settle_with(
    vectors.report_wrong_terms,
    vectors.sigs_wrong_terms,
    failure_outputs(),
  )
}

test wrong_workflow_name_rejected() {
  !settle_with(
    vectors.report_wrong_name,
    vectors.sigs_wrong_name,
    failure_outputs(),
  )
}

test unknown_decision_byte_rejected() {
  !settle_with(
    vectors.report_bad_decision,
    vectors.sigs_bad_decision,
    success_outputs(),
  )
}

test failure_paying_buyer_less_than_payout_rejected() {
  !settle_with(
    vectors.report_failure,
    vectors.sigs_failure,
    [
      tagged(wallet(buyer_key), payout - 1, own_ref()),
      tagged(wallet(underwriter), locked - payout + 1, own_ref()),
    ],
  )
}

test failure_paying_underwriter_less_than_remainder_rejected() {
  !settle_with(
    vectors.report_failure,
    vectors.sigs_failure,
    [
      tagged(wallet(buyer_key), payout, own_ref()),
      tagged(wallet(underwriter), locked - payout - 1, own_ref()),
    ],
  )
}

test payout_tagged_for_another_coverage_rejected() {
  !settle_with(
    vectors.report_failure,
    vectors.sigs_failure,
    [
      tagged(wallet(buyer_key), payout, other_ref()),
      tagged(wallet(underwriter), locked - payout, own_ref()),
    ],
  )
}

test untagged_payout_rejected() {
  !settle_with(
    vectors.report_failure,
    vectors.sigs_failure,
    [
      Output {
        address: wallet(buyer_key),
        value: assets.from_lovelace(payout),
        datum: NoDatum,
        reference_script: None,
      },
      tagged(wallet(underwriter), locked - payout, own_ref()),
    ],
  )
}

test config_digest_not_matching_the_pinned_digest_rejected() {
  !run(
    ConfigDatum { ..config(), f: 0 },
    settle(
      vectors.report_failure,
      pick(vectors.sigs_failure, [0]),
      pick(vectors.pubkeys, [0]),
    ),
    failure_outputs(),
    window(),
    [],
  )
}

test expire_before_decide_by_rejected() {
  !run(
    config(),
    Expire,
    success_outputs(),
    interval.between(1_000, 1_999),
    [underwriter],
  )
}

test expire_after_decide_by_by_underwriter_ok() {
  run(config(), Expire, success_outputs(), interval.after(2_000), [underwriter])
}

test expire_unsigned_rejected() {
  !run(
    config(),
    Expire,
    success_outputs(),
    interval.after(2_000),
    [stranger_key],
  )
}

test expire_without_returning_collateral_rejected() {
  !run(
    config(),
    Expire,
    [tagged(wallet(stranger_key), locked, own_ref())],
    interval.after(2_000),
    [underwriter],
  )
}
