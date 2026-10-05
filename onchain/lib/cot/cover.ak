//// coverage logic: underwriter collateral released by a CRE report (Settle) or reclaimed (Expire).
//// Every payout output carries the coverage out-ref as an inline datum so one output cannot satisfy two
//// coverage UTxOs settled in the same transaction. Exactly one coverage input is spent per transaction.
//// Settle is open from task_expiry to decide_by and only SUCCESS or FAILURE settle; Expire opens at decide_by.

use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use cot/cre
use cot/model.{
  ConfigDatum, CoverageDatum, CoverageRedeemer, Expire, Settle, config_digest,
  config_nft_name, covers, key_hash_of, lower_bound_from, own_input,
  paid_to_address, signed, sole_script_input, upper_bound_at_most,
}

/// The one reference input carrying the config NFT of `policy`, decoded.
fn config_from(tx: Transaction, policy: PolicyId) -> ConfigDatum {
  expect Some(input) =
    list.find(
      tx.reference_inputs,
      fn(i) { assets.quantity_of(i.output.value, policy, config_nft_name) == 1 },
    )
  expect InlineDatum(raw) = input.output.datum
  expect cfg: ConfigDatum = raw
  cfg
}

/// Lovelace of collateral a FAILURE payout must leave behind.
pub const min_ada_headroom = 2_000_000

pub fn validate(
  config_policy: PolicyId,
  datum: Option<CoverageDatum>,
  redeemer: CoverageRedeemer,
  own_ref: OutputReference,
  tx: Transaction,
) -> Bool {
  expect Some(d) = datum
  expect Some(own) = own_input(tx, own_ref)
  when redeemer is {
    Expire -> {
      expect Some(underwriter_key) = key_hash_of(d.underwriter)
      and {
        sole_script_input(tx, own),
        lower_bound_from(tx, d.decide_by),
        signed(tx, underwriter_key),
        covers(paid_to_address(tx, d.underwriter, Some(own_ref)), own.value),
      }
    }
    Settle { raw_report, report_context, sigs, pubkeys } -> {
      let cfg = config_from(tx, config_policy)
      let decision = cre.body_decision(raw_report)
      let underwriter_gets = paid_to_address(tx, d.underwriter, Some(own_ref))
      and {
        sole_script_input(tx, own),
        lower_bound_from(tx, d.task_expiry),
        upper_bound_at_most(tx, d.decide_by),
        d.config_digest == config_digest(cfg),
        cre.context_config_digest(report_context) == cfg.don_config_digest,
        cre.verify_report(
          raw_report,
          report_context,
          sigs,
          pubkeys,
          cfg.signers,
          cfg.f,
        ),
        cre.workflow_owner(raw_report) == cfg.workflow_owner,
        cre.workflow_name(raw_report) == cfg.workflow_name,
        cre.workflow_cid(raw_report) == cfg.workflow_cid,
        cre.body_terms_hash(raw_report) == d.terms_hash,
        cre.body_coverage_tx_hash(raw_report) == own_ref.transaction_id,
        cre.body_coverage_index(raw_report) == own_ref.output_index,
        cre.body_task_tx_hash(raw_report) == d.task_ref.transaction_id,
        cre.body_task_index(raw_report) == d.task_ref.output_index,
        if decision == cre.decision_failure {
          let payout = assets.from_lovelace(d.payout)
          and {
            d.payout >= 0,
            assets.lovelace_of(own.value) - min_ada_headroom >= d.payout,
            covers(paid_to_address(tx, d.buyer, Some(own_ref)), payout),
            covers(
              underwriter_gets,
              assets.merge(own.value, assets.negate(payout)),
            ),
          }
        } else if decision == cre.decision_success {
          covers(underwriter_gets, own.value)
        } else {
          False
        },
      }
    }
  }
}
