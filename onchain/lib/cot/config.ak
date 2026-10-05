//// config_nft logic: a one-shot minting policy. The mint must consume the parameterised out-ref, mint exactly
//// one config NFT, and pay it to an output whose inline datum is a well-formed ConfigDatum.

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use cot/model.{ConfigDatum, config_nft_name, config_ok}

pub fn validate(
  utxo_ref: OutputReference,
  policy_id: PolicyId,
  tx: Transaction,
) -> Bool {
  and {
    list.any(tx.inputs, fn(i) { i.output_reference == utxo_ref }),
    dict.to_pairs(assets.tokens(tx.mint, policy_id)) == [
      Pair(config_nft_name, 1),
    ],
    list.any(
      tx.outputs,
      fn(o) {
        and {
          assets.quantity_of(o.value, policy_id, config_nft_name) == 1,
          datum_is_valid_config(o.datum),
        }
      },
    ),
  }
}

fn datum_is_valid_config(datum: transaction.Datum) -> Bool {
  when datum is {
    InlineDatum(raw) -> {
      expect cfg: ConfigDatum = raw
      config_ok(cfg)
    }
    _ -> False
  }
}
