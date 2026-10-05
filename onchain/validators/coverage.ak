use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use cot/cover
use cot/model.{CoverageDatum, CoverageRedeemer}

validator coverage(config_policy: PolicyId) {
  spend(
    datum: Option<CoverageDatum>,
    redeemer: CoverageRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    cover.validate(config_policy, datum, redeemer, own_ref, tx)
  }

  else(_) {
    fail
  }
}
