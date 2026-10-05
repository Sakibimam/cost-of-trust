use aiken/interval
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use cot/vault
use cot/model.{Claim, ClaimDatum, Forfeit}

const sponsor: ByteArray = #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const beneficiary_key: ByteArray =
  #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

const stranger_key: ByteArray =
  #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

const vault_script: ByteArray =
  #"dddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

const expiry = 1_000

fn wallet(key: ByteArray) -> Address {
  Address { payment_credential: VerificationKey(key), stake_credential: None }
}

fn vault_address() -> Address {
  Address { payment_credential: Script(vault_script), stake_credential: None }
}

fn datum() -> ClaimDatum {
  ClaimDatum {
    beneficiary: wallet(beneficiary_key),
    expiry,
    sponsor,
  }
}

fn ref(n: Int) -> OutputReference {
  OutputReference {
    transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
    output_index: n,
  }
}

fn vault_input(n: Int, lovelace: Int) -> Input {
  Input {
    output_reference: ref(n),
    output: Output {
      address: vault_address(),
      value: assets.from_lovelace(lovelace),
      datum: InlineDatum(datum()),
      reference_script: None,
    },
  }
}

fn pay(address: Address, lovelace: Int) -> Output {
  Output {
    address,
    value: assets.from_lovelace(lovelace),
    datum: NoDatum,
    reference_script: None,
  }
}

fn tx(
  inputs: List<Input>,
  outputs: List<Output>,
  validity: interval.Interval,
  signatories: List<ByteArray>,
) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    inputs,
    outputs,
    validity_range: validity,
    extra_signatories: signatories,
  }
}

test claim_before_expiry_pays_beneficiary() {
  vault.validate(
    Some(datum()),
    Claim,
    ref(0),
    tx(
      [vault_input(0, 9_000_000)],
      [pay(wallet(beneficiary_key), 9_000_000)],
      interval.between(100, 999),
      [],
    ),
  )
}

test claim_after_expiry_rejected() {
  !vault.validate(
    Some(datum()),
    Claim,
    ref(0),
    tx(
      [vault_input(0, 9_000_000)],
      [pay(wallet(beneficiary_key), 9_000_000)],
      interval.after(1_000),
      [],
    ),
  )
}

test claim_at_the_expiry_instant_rejected() {
  !vault.validate(
    Some(datum()),
    Claim,
    ref(0),
    tx(
      [vault_input(0, 9_000_000)],
      [pay(wallet(beneficiary_key), 9_000_000)],
      interval.between(100, 1_000),
      [],
    ),
  )
}

test claim_without_upper_bound_rejected() {
  !vault.validate(
    Some(datum()),
    Claim,
    ref(0),
    tx(
      [vault_input(0, 9_000_000)],
      [pay(wallet(beneficiary_key), 9_000_000)],
      interval.everything,
      [],
    ),
  )
}

test claim_paying_someone_else_rejected() {
  !vault.validate(
    Some(datum()),
    Claim,
    ref(0),
    tx(
      [vault_input(0, 9_000_000)],
      [pay(wallet(stranger_key), 9_000_000)],
      interval.between(100, 999),
      [],
    ),
  )
}

test claim_underpaying_beneficiary_rejected() {
  !vault.validate(
    Some(datum()),
    Claim,
    ref(0),
    tx(
      [vault_input(0, 9_000_000)],
      [pay(wallet(beneficiary_key), 8_999_999), pay(wallet(stranger_key), 1)],
      interval.between(100, 999),
      [],
    ),
  )
}

test claim_two_vaults_with_one_payment_rejected() {
  // Both vaults pay the same beneficiary. One 9 ADA output must not satisfy two 9 ADA vault inputs.
  !vault.validate(
    Some(datum()),
    Claim,
    ref(0),
    tx(
      [vault_input(0, 9_000_000), vault_input(1, 9_000_000)],
      [pay(wallet(beneficiary_key), 9_000_000)],
      interval.between(100, 999),
      [],
    ),
  )
}

test claim_two_vaults_with_full_payment_ok() {
  vault.validate(
    Some(datum()),
    Claim,
    ref(0),
    tx(
      [vault_input(0, 9_000_000), vault_input(1, 9_000_000)],
      [pay(wallet(beneficiary_key), 18_000_000)],
      interval.between(100, 999),
      [],
    ),
  )
}

test forfeit_before_expiry_rejected() {
  !vault.validate(
    Some(datum()),
    Forfeit,
    ref(0),
    tx(
      [vault_input(0, 9_000_000)],
      [pay(wallet(sponsor), 9_000_000)],
      interval.between(100, 999),
      [sponsor],
    ),
  )
}

test forfeit_after_expiry_by_sponsor_ok() {
  vault.validate(
    Some(datum()),
    Forfeit,
    ref(0),
    tx(
      [vault_input(0, 9_000_000)],
      [pay(wallet(sponsor), 9_000_000)],
      interval.after(1_000),
      [sponsor],
    ),
  )
}

test forfeit_unsigned_rejected() {
  !vault.validate(
    Some(datum()),
    Forfeit,
    ref(0),
    tx(
      [vault_input(0, 9_000_000)],
      [pay(wallet(sponsor), 9_000_000)],
      interval.after(1_000),
      [stranger_key],
    ),
  )
}

test forfeit_not_returned_to_sponsor_rejected() {
  !vault.validate(
    Some(datum()),
    Forfeit,
    ref(0),
    tx(
      [vault_input(0, 9_000_000)],
      [pay(wallet(stranger_key), 9_000_000)],
      interval.after(1_000),
      [sponsor],
    ),
  )
}

test spending_without_a_datum_fails() fail {
  vault.validate(
    None,
    Claim,
    ref(0),
    tx(
      [vault_input(0, 9_000_000)],
      [pay(wallet(beneficiary_key), 9_000_000)],
      interval.between(100, 999),
      [],
    ),
  )
}
