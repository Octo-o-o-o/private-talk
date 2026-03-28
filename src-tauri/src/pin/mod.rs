use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use sha2::{Digest, Sha256};

fn hash_pin_legacy(pin: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(pin.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn hash_pin(pin: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| e.to_string())
}

pub fn verify_pin(pin: &str, hash: &str) -> bool {
    if hash.starts_with("$argon2") {
        return PasswordHash::new(hash)
            .ok()
            .and_then(|parsed| {
                Argon2::default()
                    .verify_password(pin.as_bytes(), &parsed)
                    .ok()
            })
            .is_some();
    }

    hash_pin_legacy(pin) == hash
}

pub fn needs_rehash(hash: &str) -> bool {
    !hash.starts_with("$argon2")
}

#[cfg(test)]
mod tests {
    use super::{hash_pin, needs_rehash, verify_pin};

    #[test]
    fn argon2_hash_verifies() {
        let hash = hash_pin("1234").unwrap();
        assert!(hash.starts_with("$argon2"));
        assert!(verify_pin("1234", &hash));
        assert!(!verify_pin("9999", &hash));
    }

    #[test]
    fn legacy_sha_hash_still_verifies_and_needs_rehash() {
        let legacy = "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4";
        assert!(verify_pin("1234", legacy));
        assert!(needs_rehash(legacy));
    }
}
