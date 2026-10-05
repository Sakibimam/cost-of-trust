//// claim_vault logic: the deadline task. Claim before `expiry` pays the beneficiary, Forfeit after it returns
//// the value to the sponsor.

use cardano/transaction.{OutputReference, Transaction}
use cot/model.{
  Claim, ClaimDatum, ClaimRedeemer, Forfeit, covers, lower_bound_from,
  own_input, paid_to_address, paid_to_key, script_inputs_value, signed,
  upper_bound_before,
}

/// Payment is checked against the sum of every input at this script address, so one output cannot be counted
/// toward two vault UTxOs spent in the same transaction.
pub fn validate(
  datum: Option<ClaimDatum>,
  redeemer: ClaimRedeemer,
  own_ref: OutputReference,
  tx: Transaction,
) -> Bool {
  expect Some(d) = datum
  expect Some(own) = own_input(tx, own_ref)
  let locked = script_inputs_value(tx, own)
  when redeemer is {
    Claim ->
      and {
        upper_bound_before(tx, d.expiry),
        covers(paid_to_address(tx, d.beneficiary, None), locked),
      }
    Forfeit ->
      and {
        lower_bound_from(tx, d.expiry),
        signed(tx, d.sponsor),
        covers(paid_to_key(tx, d.sponsor, None), locked),
      }
  }
}
