use crate::db::{collect_rows, now_timestamp, DbState};
use rusqlite::{params, types::Value};
use serde::{Deserialize, Serialize};
use tauri::State;

const API_TYPE_OPENAI_COMPATIBLE: &str = "openai-compatible";

#[derive(Debug, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub api_type: String,
    pub base_url: String,
    pub api_key: String,
    pub models: Vec<String>,
    pub is_default: bool,
    pub created_at: String,
}

#[tauri::command]
pub fn list_providers(db: State<DbState>) -> Result<Vec<Provider>, String> {
    let conn = db.lock()?;
    collect_rows(
        &conn,
        "SELECT id, name, api_type, base_url, api_key, models, is_default, created_at \
         FROM providers ORDER BY created_at ASC",
        [],
        |row| {
            let models_json: String = row.get(5)?;
            let is_default: i32 = row.get(6)?;
            Ok(Provider {
                id: row.get(0)?,
                name: row.get(1)?,
                api_type: row.get(2)?,
                base_url: row.get(3)?,
                api_key: row.get(4)?,
                models: serde_json::from_str(&models_json).unwrap_or_default(),
                is_default: is_default != 0,
                created_at: row.get(7)?,
            })
        },
    )
}

#[tauri::command]
pub fn create_provider(
    db: State<DbState>,
    name: String,
    base_url: String,
    api_key: String,
    models: Vec<String>,
) -> Result<Provider, String> {
    let conn = db.lock()?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_timestamp();
    let models_json = serde_json::to_string(&models).map_err(|e| e.to_string())?;

    // First provider becomes the default automatically.
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM providers", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let is_default = count == 0;

    conn.execute(
        "INSERT INTO providers \
           (id, name, api_type, base_url, api_key, models, is_default, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            name,
            API_TYPE_OPENAI_COMPATIBLE,
            base_url,
            api_key,
            models_json,
            is_default as i32,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(Provider {
        id,
        name,
        api_type: API_TYPE_OPENAI_COMPATIBLE.to_string(),
        base_url,
        api_key,
        models,
        is_default,
        created_at: now,
    })
}

#[tauri::command]
pub fn update_provider(
    db: State<DbState>,
    id: String,
    name: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    models: Option<Vec<String>>,
) -> Result<(), String> {
    let mut assignments: Vec<&str> = Vec::new();
    let mut values: Vec<Value> = Vec::new();

    if let Some(name) = name {
        assignments.push("name = ?");
        values.push(Value::Text(name));
    }
    if let Some(base_url) = base_url {
        assignments.push("base_url = ?");
        values.push(Value::Text(base_url));
    }
    if let Some(api_key) = api_key {
        assignments.push("api_key = ?");
        values.push(Value::Text(api_key));
    }
    if let Some(models) = models {
        let models_json = serde_json::to_string(&models).map_err(|e| e.to_string())?;
        assignments.push("models = ?");
        values.push(Value::Text(models_json));
    }

    if assignments.is_empty() {
        return Ok(());
    }

    let sql = format!(
        "UPDATE providers SET {} WHERE id = ?",
        assignments.join(", ")
    );
    values.push(Value::Text(id));

    let conn = db.lock()?;
    conn.execute(&sql, rusqlite::params_from_iter(values))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_provider(db: State<DbState>, id: String) -> Result<(), String> {
    let conn = db.lock()?;
    conn.execute("DELETE FROM providers WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_default_provider(db: State<DbState>, id: String) -> Result<(), String> {
    let conn = db.lock()?;
    conn.execute("UPDATE providers SET is_default = 0", [])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE providers SET is_default = 1 WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
