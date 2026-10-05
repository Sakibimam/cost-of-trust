//// claim_vault logic: the deadline task. Claim before `expiry` pays the beneficiary, Forfeit after it returns
//// the value to the sponsor. Exactly one vault input is spent per transaction and every payout carries the
//// vault's own out-ref as an inline datum, so no payment can satisfy a second vault or a coverage UTxO.

use cardano/transaction.{OutputReference, Transaction}
use cot/model.{
  Claim, ClaimDatum, ClaimRedeemer, Forfeit, covers, lower_bound_from, own_input,
  paid_to_address, paid_to_key, signed, sole_script_input, upper_bound_before,
}

pub fn validate(
  datum: Option<ClaimDatum>,
  redeemer: ClaimRedeemer,
  own_ref: OutputReference,
  tx: Transaction,
) -> Bool {
  expect Some(d) = datum
  expect Some(own) = own_input(tx, own_ref)
  when redeemer is {
    Claim -> and {
        sole_script_input(tx, own),
        upper_bound_before(tx, d.expiry),
        covers(paid_to_address(tx, d.beneficiary, Some(own_ref)), own.value),
      }
    Forfeit -> and {
        sole_script_input(tx, own),
        lower_bound_from(tx, d.expiry),
        signed(tx, d.sponsor),
        covers(paid_to_key(tx, d.sponsor, Some(own_ref)), own.value),
      }
  }
}
