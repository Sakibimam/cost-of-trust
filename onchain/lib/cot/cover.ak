//// coverage logic: underwriter collateral released by a CRE report (Settle) or reclaimed (Expire).
//// Every payout output carries the coverage out-ref as an inline datum so one output cannot satisfy two
//// coverage UTxOs settled in the same transaction.

use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use cot/cre
use cot/model.{
  ConfigDatum, CoverageDatum, CoverageRedeemer, Expire, Settle, config_digest,
  config_nft_name, covers, lower_bound_from, own_input, paid_to_address,
  paid_to_key, signed,
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
    Expire ->
      and {
        lower_bound_from(tx, d.decide_by),
        signed(tx, d.underwriter),
        covers(paid_to_key(tx, d.underwriter, Some(own_ref)), own.value),
      }
    Settle { raw_report, report_context, sigs, pubkeys } -> {
      let cfg = config_from(tx, config_policy)
      let decision = cre.body_decision(raw_report)
      let underwriter_gets = paid_to_key(tx, d.underwriter, Some(own_ref))
      and {
        d.config_digest == config_digest(cfg),
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
        if decision == cre.decision_failure {
          let payout = assets.from_lovelace(d.payout)
          and {
            d.payout >= 0,
            assets.lovelace_of(own.value) >= d.payout,
            covers(paid_to_address(tx, d.buyer, Some(own_ref)), payout),
            covers(
              underwriter_gets,
              assets.merge(own.value, assets.negate(payout)),
            ),
          }
        } else if decision == cre.decision_success || decision == cre.decision_inconclusive {
          covers(underwriter_gets, own.value)
        } else {
          False
        },
      }
    }
  }
}
