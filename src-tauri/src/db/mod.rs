pub mod schema;

use rusqlite::Connection;
use std::sync::Mutex;

pub struct DbState(pub Mutex<Connection>);

pub fn utc_now_str() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn parse_json_or_empty(json_str: &str) -> serde_json::Value {
    serde_json::from_str(json_str).unwrap_or(serde_json::json!({}))
}

pub fn load_provider_credentials(
    conn: &Connection,
    provider_id: &str,
) -> Result<(String, String), String> {
    conn.query_row(
        "SELECT base_url, api_key FROM providers WHERE id = ?1",
        rusqlite::params![provider_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )
    .map_err(|e| format!("Provider not found: {}", e))
}
