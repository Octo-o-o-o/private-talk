use sha2::{Digest, Sha256};

pub fn hash_pin(pin: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(pin.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn verify_pin(pin: &str, hash: &str) -> bool {
    hash_pin(pin) == hash
}
