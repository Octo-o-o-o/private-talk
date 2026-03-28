use crate::db::DbState;
use crate::pin;
use tauri::State;

#[tauri::command]
pub fn is_pin_enabled(db: State<DbState>) -> Result<bool, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT value FROM settings WHERE key = 'pin_enabled'",
        [],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(val) => Ok(val == "true"),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn verify_pin_cmd(db: State<DbState>, input_pin: String) -> Result<bool, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT value FROM settings WHERE key = 'pin_hash'",
        [],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(hash) => {
            let verified = pin::verify_pin(&input_pin, &hash);
            if verified && pin::needs_rehash(&hash) {
                match pin::hash_pin(&input_pin) {
                    Ok(upgraded_hash) => {
                        if let Err(error) = conn.execute(
                            "INSERT OR REPLACE INTO settings (key, value) VALUES ('pin_hash', ?1)",
                            rusqlite::params![upgraded_hash],
                        ) {
                            eprintln!("Failed to upgrade legacy PIN hash: {}", error);
                        }
                    }
                    Err(error) => eprintln!("Failed to rehash legacy PIN: {}", error),
                }
            }
            Ok(verified)
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn enable_pin(db: State<DbState>, new_pin: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let hash = pin::hash_pin(&new_pin)?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('pin_hash', ?1)",
        rusqlite::params![hash],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('pin_enabled', 'true')",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn disable_pin(db: State<DbState>, current_pin: String) -> Result<bool, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT value FROM settings WHERE key = 'pin_hash'",
        [],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(hash) => {
            if !pin::verify_pin(&current_pin, &hash) {
                return Ok(false);
            }
            conn.execute("DELETE FROM settings WHERE key = 'pin_hash'", [])
                .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM settings WHERE key = 'pin_enabled'", [])
                .map_err(|e| e.to_string())?;
            Ok(true)
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn reset_all_data(db: State<DbState>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute_batch(
        "
        DELETE FROM messages;
        DELETE FROM conversations;
        DELETE FROM voices;
        DELETE FROM scenarios;
        DELETE FROM providers;
        DELETE FROM settings;
        ",
    )
    .map_err(|e| e.to_string())?;

    // Re-seed presets
    crate::db::schema::seed_presets(&conn).map_err(|e| e.to_string())?;
    crate::db::schema::seed_preset_voices(&conn).map_err(|e| e.to_string())?;
    crate::db::schema::apply_preset_scenario_voice_defaults(&conn).map_err(|e| e.to_string())?;
    Ok(())
}
