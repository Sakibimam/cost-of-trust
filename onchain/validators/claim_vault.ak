use cardano/transaction.{OutputReference, Transaction}
use cot/model.{ClaimDatum, ClaimRedeemer}
use cot/vault

validator claim_vault {
  spend(
    datum: Option<ClaimDatum>,
    redeemer: ClaimRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    vault.validate(datum, redeemer, own_ref, tx)
  }

  else(_) {
    fail
  }
}
