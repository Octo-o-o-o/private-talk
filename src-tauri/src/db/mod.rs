pub mod schema;

use rusqlite::{Connection, Row};
use std::sync::{Mutex, MutexGuard};

pub struct DbState(pub Mutex<Connection>);

impl DbState {
    // Acquire the connection lock, turning poison errors into command-friendly strings.
    pub fn lock(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.0.lock().map_err(|e| e.to_string())
    }
}

// Timestamp formatted to match SQLite's `datetime('now')` defaults.
pub fn now_timestamp() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn collect_rows<T, P, F>(
    conn: &Connection,
    sql: &str,
    params: P,
    mut map: F,
) -> Result<Vec<T>, String>
where
    P: rusqlite::Params,
    F: FnMut(&Row<'_>) -> rusqlite::Result<T>,
{
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |row| map(row))
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())
}

pub fn query_optional<T, P, F>(
    conn: &Connection,
    sql: &str,
    params: P,
    map: F,
) -> Result<Option<T>, String>
where
    P: rusqlite::Params,
    F: FnOnce(&Row<'_>) -> rusqlite::Result<T>,
{
    match conn.query_row(sql, params, map) {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
