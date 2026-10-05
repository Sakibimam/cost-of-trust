//// Datum and redeemer types plus the transaction helpers shared by the three validators.

use aiken/builtin.{append_bytearray, integer_to_bytearray, length_of_bytearray}
use aiken/collection/list
use aiken/crypto.{blake2b_256}
use aiken/interval.{Finite}
use cardano/address.{Address, VerificationKey}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, find_input,
}

/// Asset name of the one config NFT minted under the config policy.
pub const config_nft_name: ByteArray = "COST_OF_TRUST_CONFIG"

pub type ClaimDatum {
  beneficiary: Address,
  /// POSIX milliseconds.
  expiry: Int,
  sponsor: ByteArray,
}

pub type ClaimRedeemer {
  Claim
  Forfeit
}

pub type CoverageDatum {
  terms_hash: ByteArray,
  buyer: Address,
  /// Full address the collateral returns to. Its payment credential must be a key: that key signs Expire.
  underwriter: Address,
  /// Lovelace owed to the buyer on a FAILURE decision.
  payout: Int,
  /// The claim_vault UTxO this coverage insures.
  task_ref: OutputReference,
  /// POSIX milliseconds. The claim_vault expiry: Settle opens here.
  task_expiry: Int,
  /// POSIX milliseconds. Settle closes and Expire opens here.
  decide_by: Int,
  config_digest: ByteArray,
}

pub type ConfigDatum {
  /// 20-byte EVM addresses of the DON signers.
  signers: List<ByteArray>,
  f: Int,
  workflow_owner: ByteArray,
  workflow_name: ByteArray,
  workflow_cid: ByteArray,
  /// 32-byte DON config digest: the first 32 bytes of every Settle report_context.
  don_config_digest: ByteArray,
}

pub type CoverageRedeemer {
  Settle {
    raw_report: ByteArray,
    report_context: ByteArray,
    /// 65-byte r || s || v signatures. The recovery byte is not used: the signer is named by `pubkeys`.
    sigs: List<ByteArray>,
    /// 64-byte uncompressed secp256k1 public keys (x || y), parallel to `sigs`.
    pubkeys: List<ByteArray>,
  }
  Expire
}

/// The transaction validity range ends strictly before `t`.
pub fn upper_bound_before(tx: Transaction, t: Int) -> Bool {
  when tx.validity_range.upper_bound.bound_type is {
    Finite(u) -> u < t
    _ -> False
  }
}

/// The transaction validity range ends at or before `t`, so it cannot overlap a window opening at `t`.
pub fn upper_bound_at_most(tx: Transaction, t: Int) -> Bool {
  when tx.validity_range.upper_bound.bound_type is {
    Finite(u) -> u <= t
    _ -> False
  }
}

/// The transaction validity range starts at or after `t`.
pub fn lower_bound_from(tx: Transaction, t: Int) -> Bool {
  when tx.validity_range.lower_bound.bound_type is {
    Finite(l) -> l >= t
    _ -> False
  }
}

pub fn signed(tx: Transaction, key_hash: ByteArray) -> Bool {
  list.has(tx.extra_signatories, key_hash)
}

pub fn own_input(tx: Transaction, own_ref: OutputReference) -> Option<Output> {
  when find_input(tx.inputs, own_ref) is {
    Some(Input { output, .. }) -> Some(output)
    None -> None
  }
}

/// True when `have` holds at least every asset quantity in `want`.
pub fn covers(have: Value, want: Value) -> Bool {
  list.all(
    assets.flatten(want),
    fn((policy, name, qty)) { assets.quantity_of(have, policy, name) >= qty },
  )
}

/// Everything the transaction pays to `key_hash` as a payment credential, any stake part.
/// When `tag` is given only outputs whose inline datum is exactly that out-ref count, so one
/// output cannot be counted toward two coverage UTxOs settled in the same transaction.
pub fn paid_to_key(
  tx: Transaction,
  key_hash: ByteArray,
  tag: Option<OutputReference>,
) -> Value {
  list.foldl(
    tx.outputs,
    assets.zero,
    fn(o, acc) {
      if o.address.payment_credential == VerificationKey(key_hash) && tag_matches(
        o,
        tag,
      ) {
        assets.merge(acc, o.value)
      } else {
        acc
      }
    },
  )
}

/// Everything the transaction pays to `address` (the full address, stake part included), with the same tag rule.
pub fn paid_to_address(
  tx: Transaction,
  address: Address,
  tag: Option<OutputReference>,
) -> Value {
  list.foldl(
    tx.outputs,
    assets.zero,
    fn(o, acc) {
      if o.address == address && tag_matches(o, tag) {
        assets.merge(acc, o.value)
      } else {
        acc
      }
    },
  )
}

fn tag_matches(o: Output, tag: Option<OutputReference>) -> Bool {
  when tag is {
    None -> True
    Some(ref) -> o.datum == InlineDatum(ref)
  }
}

/// True when exactly one input is locked under the payment credential of `own`, whatever its stake part.
/// Stake-variant addresses of one script therefore cannot be batched around a per-input check.
pub fn sole_script_input(tx: Transaction, own: Output) -> Bool {
  list.count(
    tx.inputs,
    fn(i) {
      i.output.address.payment_credential == own.address.payment_credential
    },
  ) == 1
}

/// The key hash behind a payment credential, or None for a script.
pub fn key_hash_of(address: Address) -> Option<ByteArray> {
  when address.payment_credential is {
    VerificationKey(h) -> Some(h)
    _ -> None
  }
}

/// Shape rules for a config datum. Enforced once, when the config NFT is minted.
pub fn config_ok(c: ConfigDatum) -> Bool {
  and {
    c.f >= 1,
    list.length(c.signers) >= 2 * c.f + 1,
    list.unique(c.signers) == c.signers,
    list.length(c.signers) < 256,
    list.all(c.signers, fn(a) { length_of_bytearray(a) == 20 }),
    length_of_bytearray(c.workflow_owner) == 20,
    length_of_bytearray(c.workflow_name) == 10,
    length_of_bytearray(c.workflow_cid) == 32,
    length_of_bytearray(c.don_config_digest) == 32,
  }
}

/// Digest the coverage datum pins: blake2b_256(f(1) | owner(20) | name(10) | cid(32) | don_config_digest(32) | n(1) | signers(20 each)).
pub fn config_digest(c: ConfigDatum) -> ByteArray {
  let head =
    integer_to_bytearray(True, 1, c.f)
      |> append_bytearray(c.workflow_owner)
      |> append_bytearray(c.workflow_name)
      |> append_bytearray(c.workflow_cid)
      |> append_bytearray(c.don_config_digest)
      |> append_bytearray(integer_to_bytearray(True, 1, list.length(c.signers)))
  blake2b_256(
    list.foldl(c.signers, head, fn(s, acc) { append_bytearray(acc, s) }),
  )
}

pub fn config_policy_holds(value: Value, policy: PolicyId) -> Bool {
  assets.quantity_of(value, policy, config_nft_name) == 1
}
