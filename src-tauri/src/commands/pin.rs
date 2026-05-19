use crate::db::{collect_rows, query_optional, DbState};
use crate::pin;
use rusqlite::{params, Connection};
use tauri::{Manager, State};

fn get_setting_value(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    query_optional(
        conn,
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
}

fn upsert_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn delete_setting(conn: &Connection, key: &str) -> Result<(), String> {
    conn.execute("DELETE FROM settings WHERE key = ?1", params![key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- DB helpers (testable without Tauri State) ----------

fn is_pin_enabled_db(conn: &Connection) -> Result<bool, String> {
    Ok(get_setting_value(conn, "pin_enabled")?.as_deref() == Some("true"))
}

fn get_pin_length_db(conn: &Connection) -> Result<Option<usize>, String> {
    get_setting_value(conn, "pin_length")?
        .map(|raw| raw.parse::<usize>().map_err(|e| e.to_string()))
        .transpose()
}

fn verify_pin_db(conn: &Connection, input_pin: &str) -> Result<bool, String> {
    let Some(stored_hash) = get_setting_value(conn, "pin_hash")? else {
        return Ok(false);
    };
    let kdf = get_setting_value(conn, "pin_kdf")?
        .unwrap_or_else(|| pin::KDF_LEGACY_SHA256.to_string());

    if kdf == pin::KDF_PBKDF2_SHA256 {
        let Some(salt_b64) = get_setting_value(conn, "pin_salt")? else {
            // Bookkeeping is corrupted — refuse rather than fall back silently.
            return Ok(false);
        };
        let Some(salt) = pin::decode_b64(&salt_b64) else {
            return Ok(false);
        };
        let Some(expected) = pin::decode_b64(&stored_hash) else {
            return Ok(false);
        };
        return Ok(pin::verify_pbkdf2(input_pin, &salt, &expected));
    }

    // Legacy SHA-256 path. Verify, then opportunistically migrate to PBKDF2
    // so the next login uses the strong KDF. A failed migration write must
    // not block the user — we'll retry on the next verify.
    if !pin::verify_legacy(input_pin, &stored_hash) {
        return Ok(false);
    }
    if let Err(err) = enable_pin_db(conn, input_pin) {
        eprintln!("PIN auto-migration to PBKDF2 failed (will retry next login): {err}");
    }
    Ok(true)
}

fn enable_pin_db(conn: &Connection, new_pin: &str) -> Result<(), String> {
    let salt = pin::generate_salt();
    let hash = pin::derive_pin(new_pin, &salt);
    upsert_setting(conn, "pin_kdf", pin::KDF_PBKDF2_SHA256)?;
    upsert_setting(conn, "pin_salt", &pin::encode_b64(&salt))?;
    upsert_setting(conn, "pin_hash", &pin::encode_b64(&hash))?;
    upsert_setting(conn, "pin_enabled", "true")?;
    upsert_setting(conn, "pin_length", &new_pin.len().to_string())?;
    Ok(())
}

fn disable_pin_db(conn: &Connection, current_pin: &str) -> Result<bool, String> {
    if get_setting_value(conn, "pin_hash")?.is_none() {
        // No PIN stored — treat as already disabled.
        return Ok(true);
    }
    if !verify_pin_db(conn, current_pin)? {
        return Ok(false);
    }
    delete_setting(conn, "pin_hash")?;
    delete_setting(conn, "pin_salt")?;
    delete_setting(conn, "pin_kdf")?;
    delete_setting(conn, "pin_enabled")?;
    delete_setting(conn, "pin_length")?;
    Ok(true)
}

/// DB-only portion of `reset_all_data`. Returns the attachments whose backing
/// files the caller still needs to delete from disk. The DB is wiped and
/// re-initialized so the app can keep running.
pub(crate) fn reset_all_data_db(
    conn: &Connection,
) -> Result<Vec<crate::attachments::Attachment>, String> {
    let message_ids = collect_rows(conn, "SELECT id FROM messages", [], |row| {
        row.get::<_, String>(0)
    })?;

    let attachments = if message_ids.is_empty() {
        vec![]
    } else {
        crate::attachments::get_attachments_for_messages(conn, &message_ids)?
    };

    conn.execute_batch(
        "DELETE FROM messages;
         DELETE FROM attachments;
         DELETE FROM usage_records;
         DELETE FROM conversations;
         DELETE FROM assistants;
         DELETE FROM providers;
         DELETE FROM settings;",
    )
    .map_err(|e| e.to_string())?;
    crate::db::schema::init_db(conn).map_err(|e| e.to_string())?;

    Ok(attachments)
}

// ---------- Tauri command shims ----------

#[tauri::command]
pub fn is_pin_enabled(db: State<DbState>) -> Result<bool, String> {
    let conn = db.lock()?;
    is_pin_enabled_db(&conn)
}

#[tauri::command]
pub fn get_pin_length(db: State<DbState>) -> Result<Option<usize>, String> {
    let conn = db.lock()?;
    get_pin_length_db(&conn)
}

#[tauri::command]
pub fn verify_pin_cmd(db: State<DbState>, input_pin: String) -> Result<bool, String> {
    let conn = db.lock()?;
    verify_pin_db(&conn, &input_pin)
}

#[tauri::command]
pub fn enable_pin(db: State<DbState>, new_pin: String) -> Result<(), String> {
    let conn = db.lock()?;
    enable_pin_db(&conn, &new_pin)
}

#[tauri::command]
pub fn disable_pin(db: State<DbState>, current_pin: String) -> Result<bool, String> {
    let conn = db.lock()?;
    disable_pin_db(&conn, &current_pin)
}

#[tauri::command]
pub fn reset_all_data(app: tauri::AppHandle, db: State<DbState>) -> Result<(), String> {
    let conn = db.lock()?;
    let attachments = reset_all_data_db(&conn)?;
    crate::attachments::delete_attachment_files(&attachments);
    if let Ok(app_dir) = app.path().app_data_dir() {
        let _ = std::fs::remove_dir_all(app_dir.join("attachments"));
        let _ = std::fs::remove_dir_all(app_dir.join("generated-images"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        disable_pin_db, enable_pin_db, get_pin_length_db, is_pin_enabled_db, reset_all_data_db,
        verify_pin_db,
    };
    use crate::db::schema::init_db;
    use rusqlite::{params, Connection};

    fn fresh() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init_db(&c).unwrap();
        c
    }

    // ---------- pin enable / verify / disable lifecycle ----------

    #[test]
    fn enable_then_verify_then_disable_pin_full_cycle() {
        let conn = fresh();
        assert!(!is_pin_enabled_db(&conn).unwrap());
        assert!(get_pin_length_db(&conn).unwrap().is_none());

        enable_pin_db(&conn, "1234").unwrap();
        assert!(is_pin_enabled_db(&conn).unwrap());
        assert_eq!(get_pin_length_db(&conn).unwrap(), Some(4));

        assert!(verify_pin_db(&conn, "1234").unwrap());
        assert!(!verify_pin_db(&conn, "9999").unwrap());

        assert!(disable_pin_db(&conn, "1234").unwrap());
        assert!(!is_pin_enabled_db(&conn).unwrap());
        assert!(get_pin_length_db(&conn).unwrap().is_none());
    }

    #[test]
    fn disable_pin_rejects_wrong_current_pin_and_leaves_state_intact() {
        let conn = fresh();
        enable_pin_db(&conn, "248163").unwrap();

        assert!(!disable_pin_db(&conn, "000000").unwrap());

        // Setting state must still be intact.
        assert!(is_pin_enabled_db(&conn).unwrap());
        assert_eq!(get_pin_length_db(&conn).unwrap(), Some(6));
        assert!(verify_pin_db(&conn, "248163").unwrap());
    }

    #[test]
    fn disable_pin_returns_true_when_no_pin_was_set() {
        let conn = fresh();
        assert!(disable_pin_db(&conn, "anything").unwrap());
        assert!(!is_pin_enabled_db(&conn).unwrap());
    }

    #[test]
    fn verify_pin_returns_false_when_no_pin_was_set() {
        let conn = fresh();
        assert!(!verify_pin_db(&conn, "1234").unwrap());
    }

    #[test]
    fn enable_pin_overwrites_previous_pin() {
        let conn = fresh();
        enable_pin_db(&conn, "1111").unwrap();
        enable_pin_db(&conn, "22222").unwrap();

        assert!(!verify_pin_db(&conn, "1111").unwrap());
        assert!(verify_pin_db(&conn, "22222").unwrap());
        assert_eq!(get_pin_length_db(&conn).unwrap(), Some(5));
    }

    // ---------- KDF: new PINs use PBKDF2 + salt ----------

    #[test]
    fn newly_enabled_pin_stores_pbkdf2_kdf_label_and_random_salt() {
        let conn = fresh();
        enable_pin_db(&conn, "248163").unwrap();

        let kdf: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'pin_kdf'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(kdf, crate::pin::KDF_PBKDF2_SHA256);

        let salt_b64: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'pin_salt'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let salt = crate::pin::decode_b64(&salt_b64).expect("salt is base64");
        assert_eq!(salt.len(), crate::pin::PIN_SALT_LEN);
    }

    #[test]
    fn two_pin_enables_produce_distinct_salts_and_hashes() {
        let conn_a = fresh();
        enable_pin_db(&conn_a, "1234").unwrap();
        let salt_a: String = conn_a
            .query_row(
                "SELECT value FROM settings WHERE key = 'pin_salt'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let hash_a: String = conn_a
            .query_row(
                "SELECT value FROM settings WHERE key = 'pin_hash'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        let conn_b = fresh();
        enable_pin_db(&conn_b, "1234").unwrap();
        let salt_b: String = conn_b
            .query_row(
                "SELECT value FROM settings WHERE key = 'pin_salt'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let hash_b: String = conn_b
            .query_row(
                "SELECT value FROM settings WHERE key = 'pin_hash'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        // Same PIN — distinct salts means distinct hashes, defeating rainbow
        // tables across devices.
        assert_ne!(salt_a, salt_b);
        assert_ne!(hash_a, hash_b);
    }

    // ---------- Legacy SHA-256 PINs: verify + lazy migrate ----------

    /// Simulate a DB rows from before the PBKDF2 switch: no pin_kdf / pin_salt,
    /// pin_hash is bare lowercase-hex SHA-256.
    fn seed_legacy_pin(conn: &Connection, pin_str: &str) {
        let legacy_hex = crate::pin::legacy_sha256_hex(pin_str);
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('pin_hash', ?1)",
            params![legacy_hex],
        )
        .unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('pin_enabled', 'true')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('pin_length', ?1)",
            params![pin_str.len().to_string()],
        )
        .unwrap();
    }

    #[test]
    fn legacy_sha256_pin_can_still_be_verified() {
        let conn = fresh();
        seed_legacy_pin(&conn, "248163");

        assert!(verify_pin_db(&conn, "248163").unwrap());
        assert!(!verify_pin_db(&conn, "248164").unwrap());
    }

    #[test]
    fn legacy_sha256_pin_is_migrated_to_pbkdf2_on_first_successful_verify() {
        let conn = fresh();
        seed_legacy_pin(&conn, "248163");

        // Sanity: pre-migration state.
        let kdf_before: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'pin_kdf'",
                [],
                |row| row.get(0),
            )
            .ok();
        assert!(kdf_before.is_none());

        // Successful verify triggers the migration.
        assert!(verify_pin_db(&conn, "248163").unwrap());

        let kdf_after: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'pin_kdf'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(kdf_after, crate::pin::KDF_PBKDF2_SHA256);

        // The legacy hex hash has been replaced with a base64 PBKDF2 digest.
        let stored_hash: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'pin_hash'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let decoded = crate::pin::decode_b64(&stored_hash).expect("base64 hash");
        assert_eq!(decoded.len(), crate::pin::PIN_HASH_LEN);

        // And subsequent verifies use the new path.
        assert!(verify_pin_db(&conn, "248163").unwrap());
        assert!(!verify_pin_db(&conn, "999999").unwrap());
    }

    #[test]
    fn legacy_pin_with_wrong_input_does_not_migrate() {
        let conn = fresh();
        seed_legacy_pin(&conn, "248163");

        assert!(!verify_pin_db(&conn, "wrong").unwrap());

        let kdf_after: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'pin_kdf'",
                [],
                |row| row.get(0),
            )
            .ok();
        assert!(
            kdf_after.is_none(),
            "failed verify must not silently upgrade KDF",
        );
    }

    #[test]
    fn disable_pin_works_for_legacy_records_too() {
        let conn = fresh();
        seed_legacy_pin(&conn, "1234");

        assert!(disable_pin_db(&conn, "1234").unwrap());
        assert!(!is_pin_enabled_db(&conn).unwrap());
        assert!(get_pin_length_db(&conn).unwrap().is_none());
    }

    #[test]
    fn corrupted_pbkdf2_record_without_salt_refuses_to_authenticate() {
        let conn = fresh();
        enable_pin_db(&conn, "1234").unwrap();
        // Wipe the salt to simulate partial-write corruption.
        conn.execute("DELETE FROM settings WHERE key = 'pin_salt'", [])
            .unwrap();

        assert!(!verify_pin_db(&conn, "1234").unwrap());
    }

    // ---------- reset_all_data ----------

    #[test]
    fn reset_all_data_wipes_every_user_table_and_reinitializes_schema() {
        let conn = fresh();
        // Seed a bit of everything.
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('c1', 't', datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, raw_content, created_at)
             VALUES ('m1', 'c1', 'user', 'hi', 'hi', datetime('now'))",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_default, created_at)
             VALUES ('p1', 'X', 'openai-compatible', 'u', 'k', '[]', 1, datetime('now'))",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('chat_provider_id', 'p1')",
            [],
        )
        .unwrap();
        // Add a custom assistant on top of the seeded presets.
        conn.execute(
            "INSERT INTO assistants (id, name, description, system_prompt, icon, is_preset, created_at, updated_at)
             VALUES ('a1', 'Custom', '', '', '', 0, datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();
        enable_pin_db(&conn, "1234").unwrap();
        assert!(is_pin_enabled_db(&conn).unwrap());

        let _attachments = reset_all_data_db(&conn).unwrap();

        // All user tables empty …
        for (table, expected_count) in [
            ("conversations", 0_i64),
            ("messages", 0),
            ("attachments", 0),
            ("usage_records", 0),
            ("providers", 0),
            ("settings", 0),
        ] {
            let count: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
                .unwrap();
            assert_eq!(count, expected_count, "expected {table} to be empty");
        }

        // … but assistants got re-seeded with the 5 presets (init_db re-runs).
        let preset_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM assistants WHERE is_preset = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(preset_count, 5);
        let custom_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM assistants WHERE is_preset = 0",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(custom_count, 0, "custom assistants must also be wiped");

        // PIN cleared along with everything else.
        assert!(!is_pin_enabled_db(&conn).unwrap());
    }

    #[test]
    fn reset_all_data_returns_attachments_to_delete_from_disk() {
        let conn = fresh();
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('c1', 't', datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, raw_content, created_at)
             VALUES ('m1', 'c1', 'user', 'hi', 'hi', datetime('now'))",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO attachments (id, message_id, file_type, file_name, file_path, mime_type, file_size, created_at)
             VALUES ('att-1', 'm1', 'image', 'photo.png', '/tmp/something.png', 'image/png', 42, datetime('now'))",
            [],
        )
        .unwrap();

        let attachments = reset_all_data_db(&conn).unwrap();
        assert_eq!(attachments.len(), 1);
        assert_eq!(attachments[0].file_path, "/tmp/something.png");
        assert_eq!(attachments[0].file_type, "image");
    }

    #[test]
    fn reset_all_data_on_already_empty_db_is_a_noop_then_reseeds_presets() {
        let conn = fresh();
        let attachments = reset_all_data_db(&conn).unwrap();
        assert!(attachments.is_empty());

        let preset_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM assistants WHERE is_preset = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(preset_count, 5);
    }

    // Sanity: silence the unused `params` import lint when no test below uses it.
    #[allow(dead_code)]
    fn _params_kept_alive(conn: &Connection) {
        let _ = conn.execute("SELECT 1", params![]);
    }
}
