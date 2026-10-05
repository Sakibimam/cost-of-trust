use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use cot/config

validator config_nft(utxo_ref: OutputReference, config_lock: ByteArray) {
  mint(_redeemer: Data, policy_id: PolicyId, tx: Transaction) {
    config.validate(utxo_ref, config_lock, policy_id, tx)
  }

  else(_) {
    fail
  }
}
