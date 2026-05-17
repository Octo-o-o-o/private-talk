use sha2::{Digest, Sha256};

pub fn hash_pin(pin: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(pin.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn verify_pin(pin: &str, hash: &str) -> bool {
    hash_pin(pin) == hash
}

#[cfg(test)]
mod tests {
    use super::{hash_pin, verify_pin};

    #[test]
    fn hash_pin_is_deterministic_lowercase_hex_of_length_64() {
        let first = hash_pin("123456");
        let second = hash_pin("123456");

        assert_eq!(first, second, "hash must be deterministic");
        assert_eq!(first.len(), 64, "SHA-256 hex digest is 64 chars");
        assert!(
            first.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
            "hex digest must be lowercase: got {first}",
        );
    }

    #[test]
    fn hash_pin_matches_known_sha256_for_fixed_input() {
        // Regression anchor: if the algorithm ever changes (salt added, length
        // changed, encoding swapped) this assert will catch it before users get
        // locked out of their data.
        assert_eq!(
            hash_pin("1234"),
            "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4",
        );
    }

    #[test]
    fn verify_pin_accepts_correct_and_rejects_typo() {
        let stored = hash_pin("248163");
        assert!(verify_pin("248163", &stored));
        assert!(!verify_pin("248164", &stored));
        assert!(!verify_pin("", &stored));
        assert!(!verify_pin("2481630", &stored));
    }

    #[test]
    fn verify_pin_rejects_garbage_hash_without_panicking() {
        assert!(!verify_pin("1234", ""));
        assert!(!verify_pin("1234", "not-a-hash"));
        assert!(!verify_pin("1234", &"a".repeat(64)));
    }

    #[test]
    fn hash_pin_handles_unicode_and_long_input() {
        let unicode = hash_pin("密码🔒");
        assert_eq!(unicode.len(), 64);
        assert!(verify_pin("密码🔒", &unicode));
        assert!(!verify_pin("密码", &unicode));

        let long = "0123456789".repeat(200);
        let long_hash = hash_pin(&long);
        assert_eq!(long_hash.len(), 64);
        assert!(verify_pin(&long, &long_hash));
    }
}
