//! Provider-secret storage with platform-aware backing.
//!
//! On iOS we delegate to the Keychain via the ObjC bridge in
//! `gen/apple/Sources/private-talk/keychain.m`. On every other target
//! the DB column stays the source of truth, so desktop builds preserve
//! their existing behaviour without any new dependencies.
//!
//! All five callers (`provider`, `chat`, `stt`, `tts`, `image_gen`,
//! `config_io`, `pin::reset_all_data`) go through this module rather
//! than reading the DB column directly, so the secret lives in exactly
//! one place on each platform.

use rusqlite::{params, Connection};

#[cfg(target_os = "ios")]
mod ios {
    use std::ffi::{CStr, CString};
    use std::os::raw::{c_char, c_int};

    extern "C" {
        fn pt_keychain_set(
            account: *const c_char,
            value: *const c_char,
            out_error: *mut *mut c_char,
        ) -> c_int;
        fn pt_keychain_get(
            account: *const c_char,
            out_value: *mut *mut c_char,
            out_error: *mut *mut c_char,
        ) -> c_int;
        fn pt_keychain_delete(account: *const c_char, out_error: *mut *mut c_char) -> c_int;
        fn pt_keychain_string_free(ptr: *mut c_char);
    }

    unsafe fn take_string(ptr: *mut c_char) -> Option<String> {
        if ptr.is_null() {
            return None;
        }
        let value = CStr::from_ptr(ptr).to_string_lossy().into_owned();
        pt_keychain_string_free(ptr);
        Some(value)
    }

    pub fn set(account: &str, value: &str) -> Result<(), String> {
        let acct = CString::new(account).map_err(|_| "invalid account string".to_string())?;
        let val = CString::new(value).map_err(|_| "invalid value string".to_string())?;
        let mut err: *mut c_char = std::ptr::null_mut();
        let ok = unsafe { pt_keychain_set(acct.as_ptr(), val.as_ptr(), &mut err) };
        if ok != 1 {
            let msg =
                unsafe { take_string(err) }.unwrap_or_else(|| "keychain set failed".to_string());
            return Err(msg);
        }
        Ok(())
    }

    pub fn get(account: &str) -> Result<Option<String>, String> {
        let acct = CString::new(account).map_err(|_| "invalid account string".to_string())?;
        let mut value: *mut c_char = std::ptr::null_mut();
        let mut err: *mut c_char = std::ptr::null_mut();
        let result = unsafe { pt_keychain_get(acct.as_ptr(), &mut value, &mut err) };
        match result {
            1 => {
                let v = unsafe { take_string(value) };
                let _ = unsafe { take_string(err) };
                Ok(v)
            }
            0 => {
                let _ = unsafe { take_string(value) };
                let _ = unsafe { take_string(err) };
                Ok(None)
            }
            _ => {
                let _ = unsafe { take_string(value) };
                let msg = unsafe { take_string(err) }
                    .unwrap_or_else(|| "keychain get failed".to_string());
                Err(msg)
            }
        }
    }

    pub fn delete(account: &str) -> Result<(), String> {
        let acct = CString::new(account).map_err(|_| "invalid account string".to_string())?;
        let mut err: *mut c_char = std::ptr::null_mut();
        let ok = unsafe { pt_keychain_delete(acct.as_ptr(), &mut err) };
        if ok != 1 {
            let msg =
                unsafe { take_string(err) }.unwrap_or_else(|| "keychain delete failed".to_string());
            return Err(msg);
        }
        Ok(())
    }
}

/// Read the API key for a provider. On iOS this prefers the keychain;
/// if the keychain has nothing yet but the DB still holds the legacy
/// plaintext value, the secret is transparently migrated and the DB
/// column is cleared. On every other target we just read the DB column.
pub fn load_provider_api_key(conn: &Connection, provider_id: &str) -> Result<String, String> {
    let db_value: String = conn
        .query_row(
            "SELECT api_key FROM providers WHERE id = ?1",
            params![provider_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| format!("Provider not found: {e}"))?;

    #[cfg(target_os = "ios")]
    {
        if let Some(value) = ios::get(provider_id)? {
            return Ok(value);
        }
        if !db_value.is_empty() {
            // Legacy: secret still sitting in the DB. Move it to the keychain
            // best-effort so the next call hits the iOS path.
            if let Err(err) = ios::set(provider_id, &db_value) {
                eprintln!(
                    "Failed to migrate provider {provider_id} api_key to keychain: {err}"
                );
            } else if let Err(err) = clear_db_column(conn, provider_id) {
                eprintln!(
                    "Migrated provider {provider_id} api_key to keychain but failed to clear DB column: {err}"
                );
            }
        }
    }
    Ok(db_value)
}

/// Read both base_url and api_key in one go — the most common shape for
/// outbound LLM / STT / TTS / image-gen calls. Behaves identically to
/// `load_provider_api_key` for the secret half.
pub fn load_provider_endpoint(
    conn: &Connection,
    provider_id: &str,
) -> Result<(String, String), String> {
    let (base_url, db_api_key): (String, String) = conn
        .query_row(
            "SELECT base_url, api_key FROM providers WHERE id = ?1",
            params![provider_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|e| format!("Provider not found: {e}"))?;

    #[cfg(target_os = "ios")]
    {
        if let Some(value) = ios::get(provider_id)? {
            return Ok((base_url, value));
        }
        if !db_api_key.is_empty() {
            if let Err(err) = ios::set(provider_id, &db_api_key) {
                eprintln!(
                    "Failed to migrate provider {provider_id} api_key to keychain: {err}"
                );
            } else if let Err(err) = clear_db_column(conn, provider_id) {
                eprintln!(
                    "Migrated provider {provider_id} api_key to keychain but failed to clear DB column: {err}"
                );
            }
        }
    }
    Ok((base_url, db_api_key))
}

/// Store the secret for a provider. On iOS we write the keychain *and*
/// blank the DB column so legacy snapshots can't resurface the secret.
/// On other platforms we just write the DB column — they don't have a
/// keychain we control.
pub fn store_provider_api_key(
    conn: &Connection,
    provider_id: &str,
    api_key: &str,
) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        ios::set(provider_id, api_key)?;
        clear_db_column(conn, provider_id)?;
        return Ok(());
    }
    #[cfg(not(target_os = "ios"))]
    {
        conn.execute(
            "UPDATE providers SET api_key = ?2 WHERE id = ?1",
            params![provider_id, api_key],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Remove the secret for a provider. Idempotent — never errors if there's
/// nothing to delete. DB-row deletion stays with the caller.
pub fn delete_provider_api_key(_conn: &Connection, provider_id: &str) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let _ = ios::delete(provider_id);
    }
    let _ = provider_id;
    Ok(())
}

#[cfg(target_os = "ios")]
fn clear_db_column(conn: &Connection, provider_id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE providers SET api_key = '' WHERE id = ?1",
        params![provider_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
#[cfg(not(target_os = "ios"))]
mod tests {
    use super::*;
    use crate::db::schema::init_db;
    use rusqlite::params;

    fn fresh() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init_db(&c).unwrap();
        c
    }

    fn seed_provider(conn: &Connection, id: &str, api_key: &str) {
        conn.execute(
            "INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_default, created_at)
             VALUES (?1, 'X', 'openai-compatible', 'https://x', ?2, '[]', 0, datetime('now'))",
            params![id, api_key],
        )
        .unwrap();
    }

    #[test]
    fn desktop_load_returns_db_value() {
        let conn = fresh();
        seed_provider(&conn, "p1", "sk-original");
        assert_eq!(load_provider_api_key(&conn, "p1").unwrap(), "sk-original");

        let (base, key) = load_provider_endpoint(&conn, "p1").unwrap();
        assert_eq!(base, "https://x");
        assert_eq!(key, "sk-original");
    }

    #[test]
    fn desktop_store_writes_db_column() {
        let conn = fresh();
        seed_provider(&conn, "p1", "sk-original");
        store_provider_api_key(&conn, "p1", "sk-rotated").unwrap();
        assert_eq!(load_provider_api_key(&conn, "p1").unwrap(), "sk-rotated");
    }

    #[test]
    fn desktop_delete_is_a_noop_on_non_keychain_targets() {
        let conn = fresh();
        seed_provider(&conn, "p1", "sk-original");
        // Delete leaves the DB row alone (the caller does that).
        delete_provider_api_key(&conn, "p1").unwrap();
        assert_eq!(load_provider_api_key(&conn, "p1").unwrap(), "sk-original");
    }

    #[test]
    fn load_missing_provider_surfaces_error() {
        let conn = fresh();
        assert!(load_provider_api_key(&conn, "missing").is_err());
    }
}
