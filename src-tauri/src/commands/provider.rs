use crate::db::DbState;
use serde::{Deserialize, Serialize};
use tauri::State;

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
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, api_type, base_url, api_key, models, is_default, created_at FROM providers ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let models_json: String = row.get(5)?;
            let models: Vec<String> = serde_json::from_str(&models_json).unwrap_or_default();
            let is_default: i32 = row.get(6)?;
            Ok(Provider {
                id: row.get(0)?,
                name: row.get(1)?,
                api_type: row.get(2)?,
                base_url: row.get(3)?,
                api_key: row.get(4)?,
                models,
                is_default: is_default != 0,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut providers = Vec::new();
    for row in rows {
        providers.push(row.map_err(|e| e.to_string())?);
    }
    Ok(providers)
}

#[tauri::command]
pub fn create_provider(
    db: State<DbState>,
    name: String,
    base_url: String,
    api_key: String,
    models: Vec<String>,
) -> Result<Provider, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let models_json = serde_json::to_string(&models).map_err(|e| e.to_string())?;

    // Check if this is the first provider — make it default
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM providers", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let is_default = count == 0;

    conn.execute(
        "INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_default, created_at) VALUES (?1, ?2, 'openai-compatible', ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, name, base_url, api_key, models_json, is_default as i32, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(Provider {
        id,
        name,
        api_type: "openai-compatible".to_string(),
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
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if let Some(name) = name {
        conn.execute(
            "UPDATE providers SET name = ?1 WHERE id = ?2",
            rusqlite::params![name, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(base_url) = base_url {
        conn.execute(
            "UPDATE providers SET base_url = ?1 WHERE id = ?2",
            rusqlite::params![base_url, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(api_key) = api_key {
        conn.execute(
            "UPDATE providers SET api_key = ?1 WHERE id = ?2",
            rusqlite::params![api_key, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(models) = models {
        let models_json = serde_json::to_string(&models).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE providers SET models = ?1 WHERE id = ?2",
            rusqlite::params![models_json, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_provider(db: State<DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM providers WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_default_provider(db: State<DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE providers SET is_default = 0", [])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE providers SET is_default = 1 WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
