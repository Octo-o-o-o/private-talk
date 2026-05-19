//! PIN code derivation and verification.
//!
//! Historical scheme: bare `sha256(pin)` stored as lowercase hex. Numeric PINs
//! are short, so a single SHA-256 round is GPU-trivially broken via rainbow
//! table — switching to PBKDF2-HMAC-SHA256 with a random per-user salt raises
//! the brute-force cost by ~five orders of magnitude.
//!
//! The legacy scheme is kept around exclusively so the `verify_pin_cmd` path
//! can detect and transparently migrate existing PINs the first time the user
//! authenticates after upgrading.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::{Digest, Sha256};

pub const PIN_SALT_LEN: usize = 16;
pub const PIN_HASH_LEN: usize = 32;
pub const PBKDF2_ITERATIONS: u32 = 200_000;
pub const KDF_PBKDF2_SHA256: &str = "pbkdf2-sha256-200000";
pub const KDF_LEGACY_SHA256: &str = "sha256-legacy";

pub fn generate_salt() -> [u8; PIN_SALT_LEN] {
    let mut salt = [0u8; PIN_SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    salt
}

pub fn derive_pin(pin: &str, salt: &[u8]) -> [u8; PIN_HASH_LEN] {
    let mut out = [0u8; PIN_HASH_LEN];
    pbkdf2_hmac::<Sha256>(pin.as_bytes(), salt, PBKDF2_ITERATIONS, &mut out);
    out
}

pub fn verify_pbkdf2(pin: &str, salt: &[u8], expected_hash: &[u8]) -> bool {
    if expected_hash.len() != PIN_HASH_LEN {
        return false;
    }
    let computed = derive_pin(pin, salt);
    // Constant-time comparison so timing doesn't leak the first wrong byte.
    let mut diff: u8 = 0;
    for (a, b) in computed.iter().zip(expected_hash.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}

pub fn encode_b64(bytes: &[u8]) -> String {
    BASE64.encode(bytes)
}

pub fn decode_b64(value: &str) -> Option<Vec<u8>> {
    BASE64.decode(value.trim()).ok()
}

/// Legacy: returns the lowercase-hex SHA-256 digest of the PIN. Used only to
/// recognize and migrate hashes stored before the PBKDF2 switch.
pub fn legacy_sha256_hex(pin: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(pin.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Legacy verifier — refuses anything that isn't a 64-char lowercase hex
/// SHA-256 digest so a corrupted DB row can't be matched by accident.
pub fn verify_legacy(pin: &str, expected_hex: &str) -> bool {
    if expected_hex.len() != 64 {
        return false;
    }
    legacy_sha256_hex(pin) == expected_hex
}

#[cfg(test)]
mod tests {
    use super::{
        decode_b64, derive_pin, encode_b64, generate_salt, legacy_sha256_hex, verify_legacy,
        verify_pbkdf2, PIN_HASH_LEN, PIN_SALT_LEN,
    };

    #[test]
    fn generated_salt_is_correct_length_and_non_deterministic() {
        let a = generate_salt();
        let b = generate_salt();
        assert_eq!(a.len(), PIN_SALT_LEN);
        assert_ne!(a, b, "two independent salts must differ in practice");
    }

    #[test]
    fn derive_pin_is_deterministic_for_same_inputs() {
        let salt = [0u8; PIN_SALT_LEN];
        let first = derive_pin("123456", &salt);
        let second = derive_pin("123456", &salt);
        assert_eq!(first.len(), PIN_HASH_LEN);
        assert_eq!(first, second);
    }

    #[test]
    fn derive_pin_changes_with_salt_and_with_pin() {
        let salt_a = [1u8; PIN_SALT_LEN];
        let salt_b = [2u8; PIN_SALT_LEN];
        assert_ne!(
            derive_pin("1234", &salt_a),
            derive_pin("1234", &salt_b),
            "different salts must produce different hashes",
        );
        assert_ne!(
            derive_pin("1234", &salt_a),
            derive_pin("1235", &salt_a),
            "different PINs must produce different hashes",
        );
    }

    #[test]
    fn verify_pbkdf2_accepts_correct_and_rejects_typos() {
        let salt = generate_salt();
        let hash = derive_pin("248163", &salt);
        assert!(verify_pbkdf2("248163", &salt, &hash));
        assert!(!verify_pbkdf2("248164", &salt, &hash));
        assert!(!verify_pbkdf2("", &salt, &hash));
        assert!(!verify_pbkdf2("2481630", &salt, &hash));
    }

    #[test]
    fn verify_pbkdf2_rejects_wrong_length_expected_hash() {
        let salt = generate_salt();
        assert!(!verify_pbkdf2("1234", &salt, b"too-short"));
        assert!(!verify_pbkdf2("1234", &salt, &[0u8; 31]));
        assert!(!verify_pbkdf2("1234", &salt, &[0u8; 33]));
    }

    #[test]
    fn base64_round_trip() {
        let salt = generate_salt();
        let encoded = encode_b64(&salt);
        let decoded = decode_b64(&encoded).expect("round-trip decodes");
        assert_eq!(&decoded[..], &salt[..]);
    }

    #[test]
    fn decode_b64_rejects_garbage() {
        assert!(decode_b64("not base64!!!").is_none());
    }

    #[test]
    fn legacy_hash_is_deterministic_lowercase_hex_of_length_64() {
        let first = legacy_sha256_hex("123456");
        let second = legacy_sha256_hex("123456");
        assert_eq!(first, second);
        assert_eq!(first.len(), 64);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn legacy_hash_matches_known_sha256_for_fixed_input() {
        // Regression anchor: if anything in the legacy path drifts, existing
        // users get locked out before the lazy migration can run.
        assert_eq!(
            legacy_sha256_hex("1234"),
            "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4",
        );
    }

    #[test]
    fn verify_legacy_accepts_correct_and_rejects_typos() {
        let stored = legacy_sha256_hex("248163");
        assert!(verify_legacy("248163", &stored));
        assert!(!verify_legacy("248164", &stored));
        assert!(!verify_legacy("", &stored));
        assert!(!verify_legacy("2481630", &stored));
    }

    #[test]
    fn verify_legacy_rejects_garbage_hash_without_panicking() {
        assert!(!verify_legacy("1234", ""));
        assert!(!verify_legacy("1234", "not-a-hash"));
        assert!(!verify_legacy("1234", &"a".repeat(64)));
    }

    #[test]
    fn legacy_handles_unicode_and_long_input() {
        let unicode = legacy_sha256_hex("密码🔒");
        assert_eq!(unicode.len(), 64);
        assert!(verify_legacy("密码🔒", &unicode));
        assert!(!verify_legacy("密码", &unicode));

        let long = "0123456789".repeat(200);
        let long_hash = legacy_sha256_hex(&long);
        assert_eq!(long_hash.len(), 64);
        assert!(verify_legacy(&long, &long_hash));
    }
}
