use crate::db::{query_optional, DbState};
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

#[tauri::command]
pub fn is_pin_enabled(db: State<DbState>) -> Result<bool, String> {
    let conn = db.lock()?;
    Ok(get_setting_value(&conn, "pin_enabled")?.as_deref() == Some("true"))
}

#[tauri::command]
pub fn get_pin_length(db: State<DbState>) -> Result<Option<usize>, String> {
    let conn = db.lock()?;
    get_setting_value(&conn, "pin_length")?
        .map(|raw| raw.parse::<usize>().map_err(|e| e.to_string()))
        .transpose()
}

#[tauri::command]
pub fn verify_pin_cmd(db: State<DbState>, input_pin: String) -> Result<bool, String> {
    let conn = db.lock()?;
    match get_setting_value(&conn, "pin_hash")? {
        Some(hash) => Ok(pin::verify_pin(&input_pin, &hash)),
        None => Ok(false),
    }
}

#[tauri::command]
pub fn enable_pin(db: State<DbState>, new_pin: String) -> Result<(), String> {
    let conn = db.lock()?;
    upsert_setting(&conn, "pin_hash", &pin::hash_pin(&new_pin))?;
    upsert_setting(&conn, "pin_enabled", "true")?;
    upsert_setting(&conn, "pin_length", &new_pin.len().to_string())?;
    Ok(())
}

#[tauri::command]
pub fn disable_pin(db: State<DbState>, current_pin: String) -> Result<bool, String> {
    let conn = db.lock()?;
    let Some(hash) = get_setting_value(&conn, "pin_hash")? else {
        // No PIN stored — treat as already disabled.
        return Ok(true);
    };
    if !pin::verify_pin(&current_pin, &hash) {
        return Ok(false);
    }
    delete_setting(&conn, "pin_hash")?;
    delete_setting(&conn, "pin_enabled")?;
    delete_setting(&conn, "pin_length")?;
    Ok(true)
}

#[tauri::command]
pub fn reset_all_data(app: tauri::AppHandle, db: State<DbState>) -> Result<(), String> {
    let conn = db.lock()?;
    let message_ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM messages")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    if !message_ids.is_empty() {
        let attachments = crate::attachments::get_attachments_for_messages(&conn, &message_ids)?;
        crate::attachments::delete_attachment_files(&attachments);
    }
    conn.execute_batch(
        "DELETE FROM messages;
         DELETE FROM attachments;
         DELETE FROM usage_records;
         DELETE FROM conversations;
         DELETE FROM providers;
         DELETE FROM settings;",
    )
    .map_err(|e| e.to_string())?;
    if let Ok(app_dir) = app.path().app_data_dir() {
        let _ = std::fs::remove_dir_all(app_dir.join("attachments"));
        let _ = std::fs::remove_dir_all(app_dir.join("generated-images"));
    }
    Ok(())
}
