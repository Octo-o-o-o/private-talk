use crate::db::{query_optional, DbState};
use rusqlite::{params, Connection};
use tauri::State;

fn get_setting_db(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    query_optional(
        conn,
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
}

fn set_setting_db(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_setting(db: State<DbState>, key: String) -> Result<Option<String>, String> {
    let conn = db.lock()?;
    get_setting_db(&conn, &key)
}

#[tauri::command]
pub fn set_setting(db: State<DbState>, key: String, value: String) -> Result<(), String> {
    let conn = db.lock()?;
    set_setting_db(&conn, &key, &value)
}

#[cfg(test)]
mod tests {
    use super::{get_setting_db, set_setting_db};
    use crate::db::schema::init_db;
    use rusqlite::Connection;

    fn fresh() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init_db(&c).unwrap();
        c
    }

    #[test]
    fn get_setting_returns_none_for_missing_key() {
        let conn = fresh();
        assert_eq!(get_setting_db(&conn, "no_such_key").unwrap(), None);
    }

    #[test]
    fn set_then_get_round_trips_value() {
        let conn = fresh();
        set_setting_db(&conn, "ui_language", "zh-CN").unwrap();
        assert_eq!(
            get_setting_db(&conn, "ui_language").unwrap().as_deref(),
            Some("zh-CN"),
        );
    }

    #[test]
    fn set_setting_overwrites_existing_value() {
        let conn = fresh();
        set_setting_db(&conn, "ui_language", "zh-CN").unwrap();
        set_setting_db(&conn, "ui_language", "en").unwrap();
        assert_eq!(
            get_setting_db(&conn, "ui_language").unwrap().as_deref(),
            Some("en"),
        );
    }

    #[test]
    fn set_setting_accepts_empty_string_value() {
        // The frontend stores "" to mean "no provider selected"; that empty
        // string must round-trip exactly — not become NULL or get rejected.
        let conn = fresh();
        set_setting_db(&conn, "chat_provider_id", "").unwrap();
        assert_eq!(
            get_setting_db(&conn, "chat_provider_id").unwrap().as_deref(),
            Some(""),
        );
    }

    #[test]
    fn settings_keys_are_independent() {
        let conn = fresh();
        set_setting_db(&conn, "a", "1").unwrap();
        set_setting_db(&conn, "b", "2").unwrap();
        assert_eq!(get_setting_db(&conn, "a").unwrap().as_deref(), Some("1"));
        assert_eq!(get_setting_db(&conn, "b").unwrap().as_deref(), Some("2"));
    }
}
