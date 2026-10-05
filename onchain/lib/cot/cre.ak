//// Chainlink CRE report verification for Plutus V3, written for the 210-byte Cost-of-Trust report.
////
//// Header (109 bytes, KeystoneForwarder metadata): version(1) | execution_id(32) | timestamp(4) | don_id(4)
//// | don_config_version(4) | workflow_cid(32) @45 | workflow_name(10) @77 | workflow_owner(20) @87 | report_id(2).
//// Body (101 bytes @109): terms_hash(32) | decision(1) | coverage_tx_hash(32) | coverage_index(2, big endian)
//// | task_tx_hash(32) @176 | task_index(2, big endian) @208.
//// Signed digest: keccak256(keccak256(raw_report) ++ report_context) where report_context is the 64-byte
//// config_digest ++ BE32(seq_nr) the DON signs. Signers are 20-byte EVM addresses; each signature carries the
//// 64-byte uncompressed public key, bound to the address by keccak256(pubkey)[12..32], and the 64-byte r || s
//// prefix of the 65-byte signature is verified against the compressed key.

use aiken/builtin.{
  append_bytearray, index_bytearray, length_of_bytearray, slice_bytearray,
}
use aiken/collection/list
use aiken/crypto.{keccak_256, verify_ecdsa_signature}

pub const header_len = 109

pub const body_len = 101

pub const report_len = 210

pub const context_len = 64

pub const decision_success = 0

pub const decision_failure = 1

pub const decision_inconclusive = 2

/// The pinned DON config digest: the first 32 bytes of the 64-byte report context.
pub fn context_config_digest(context: ByteArray) -> ByteArray {
  slice_bytearray(0, 32, context)
}

pub fn report_digest(raw_report: ByteArray, context: ByteArray) -> ByteArray {
  keccak_256(append_bytearray(keccak_256(raw_report), context))
}

pub fn workflow_cid(raw_report: ByteArray) -> ByteArray {
  slice_bytearray(45, 32, raw_report)
}

pub fn workflow_name(raw_report: ByteArray) -> ByteArray {
  slice_bytearray(77, 10, raw_report)
}

pub fn workflow_owner(raw_report: ByteArray) -> ByteArray {
  slice_bytearray(87, 20, raw_report)
}

pub fn body_terms_hash(raw_report: ByteArray) -> ByteArray {
  slice_bytearray(109, 32, raw_report)
}

pub fn body_decision(raw_report: ByteArray) -> Int {
  index_bytearray(raw_report, 141)
}

pub fn body_coverage_tx_hash(raw_report: ByteArray) -> ByteArray {
  slice_bytearray(142, 32, raw_report)
}

pub fn body_coverage_index(raw_report: ByteArray) -> Int {
  index_bytearray(raw_report, 174) * 256 + index_bytearray(raw_report, 175)
}

pub fn body_task_tx_hash(raw_report: ByteArray) -> ByteArray {
  slice_bytearray(176, 32, raw_report)
}

pub fn body_task_index(raw_report: ByteArray) -> Int {
  index_bytearray(raw_report, 208) * 256 + index_bytearray(raw_report, 209)
}

/// SEC1 compressed form of a 64-byte x || y key: the parity of y picks the prefix.
fn compress(xy: ByteArray) -> ByteArray {
  let x = slice_bytearray(0, 32, xy)
  let prefix =
    if index_bytearray(xy, 63) % 2 == 0 {
      #"02"
    } else {
      #"03"
    }
  append_bytearray(prefix, x)
}

/// Every pair must be well formed, name a distinct allowlisted signer and verify over `digest`.
fn check_proofs(
  sigs: List<ByteArray>,
  pubkeys: List<ByteArray>,
  signers: List<ByteArray>,
  digest: ByteArray,
  seen: List<ByteArray>,
) -> Bool {
  when (sigs, pubkeys) is {
    ([], []) -> True
    ([sig, ..rest_sigs], [pk, ..rest_pks]) -> {
      let addr = slice_bytearray(12, 20, keccak_256(pk))
      and {
        length_of_bytearray(pk) == 64,
        length_of_bytearray(sig) == 65,
        list.has(signers, addr),
        !list.has(seen, addr),
        verify_ecdsa_signature(
          compress(pk),
          digest,
          slice_bytearray(0, 64, sig),
        ),
        check_proofs(rest_sigs, rest_pks, signers, digest, [addr, ..seen]),
      }
    }
    _ -> False
  }
}

/// At least f+1 distinct allowlisted signers signed this exact report and context.
pub fn verify_report(
  raw_report: ByteArray,
  context: ByteArray,
  sigs: List<ByteArray>,
  pubkeys: List<ByteArray>,
  signers: List<ByteArray>,
  f: Int,
) -> Bool {
  and {
    length_of_bytearray(raw_report) == report_len,
    length_of_bytearray(context) == context_len,
    list.length(sigs) >= f + 1,
    check_proofs(sigs, pubkeys, signers, report_digest(raw_report, context), []),
  }
}
