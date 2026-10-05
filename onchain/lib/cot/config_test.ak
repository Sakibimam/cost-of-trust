use aiken/interval
use cardano/address.{Address, VerificationKey}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use cot/config
use cot/model.{ConfigDatum, config_nft_name}
use cot/vectors

const policy: ByteArray =
  #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

fn seed_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"5555555555555555555555555555555555555555555555555555555555555555",
    output_index: 1,
  }
}

fn good() -> ConfigDatum {
  ConfigDatum {
    signers: vectors.signers,
    f: vectors.f,
    workflow_owner: vectors.owner,
    workflow_name: vectors.name,
    workflow_cid: vectors.cid,
  }
}

fn wallet() -> Address {
  Address {
    payment_credential: VerificationKey(
      #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ),
    stake_credential: None,
  }
}

fn nft_output(datum: transaction.Datum) -> Output {
  Output {
    address: wallet(),
    value: assets.add(
      assets.from_lovelace(2_000_000),
      policy,
      config_nft_name,
      1,
    ),
    datum,
    reference_script: None,
  }
}

fn seed_input(ref: OutputReference) -> Input {
  Input {
    output_reference: ref,
    output: Output {
      address: wallet(),
      value: assets.from_lovelace(5_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

fn mint_tx(
  spent: OutputReference,
  qty: Int,
  datum: transaction.Datum,
) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs: [seed_input(spent)],
    outputs: [nft_output(datum)],
    mint: assets.add(assets.zero, policy, config_nft_name, qty),
    validity_range: interval.everything,
  }
}

test mint_consuming_the_seed_with_a_valid_config_ok() {
  config.validate(seed_ref(), policy, mint_tx(seed_ref(), 1, InlineDatum(good())))
}

test mint_without_consuming_the_seed_rejected() {
  let other = OutputReference { ..seed_ref(), output_index: 2 }
  !config.validate(seed_ref(), policy, mint_tx(other, 1, InlineDatum(good())))
}

test minting_two_nfts_rejected() {
  !config.validate(seed_ref(), policy, mint_tx(seed_ref(), 2, InlineDatum(good())))
}

test mint_with_threshold_above_signer_count_rejected() {
  let bad = ConfigDatum { ..good(), f: 4 }
  !config.validate(seed_ref(), policy, mint_tx(seed_ref(), 1, InlineDatum(bad)))
}

test mint_with_a_short_workflow_name_rejected() {
  let bad = ConfigDatum { ..good(), workflow_name: "short" }
  !config.validate(seed_ref(), policy, mint_tx(seed_ref(), 1, InlineDatum(bad)))
}

test mint_without_an_inline_config_datum_rejected() {
  !config.validate(seed_ref(), policy, mint_tx(seed_ref(), 1, NoDatum))
}
