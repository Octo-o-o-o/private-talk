use crate::db::DbState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Voice {
    pub id: String,
    pub display_name: String,
    pub engine: String,
    pub engine_config: serde_json::Value,
    pub role_type: String,
    pub tags: Vec<String>,
    pub is_preset: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn list_voices(db: State<DbState>) -> Result<Vec<Voice>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, display_name, engine, engine_config, role_type, tags, is_preset, created_at, updated_at
             FROM voices ORDER BY is_preset DESC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let config_str: String = row.get(3)?;
            let tags_str: String = row.get(5)?;
            let is_preset: i32 = row.get(6)?;
            Ok(Voice {
                id: row.get(0)?,
                display_name: row.get(1)?,
                engine: row.get(2)?,
                engine_config: serde_json::from_str(&config_str)
                    .unwrap_or(serde_json::Value::Object(serde_json::Map::new())),
                role_type: row.get(4)?,
                tags: serde_json::from_str(&tags_str).unwrap_or_default(),
                is_preset: is_preset != 0,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut voices = Vec::new();
    for row in rows {
        voices.push(row.map_err(|e| e.to_string())?);
    }
    Ok(voices)
}

#[tauri::command]
pub fn get_voice(db: State<DbState>, id: String) -> Result<Voice, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, display_name, engine, engine_config, role_type, tags, is_preset, created_at, updated_at
         FROM voices WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            let config_str: String = row.get(3)?;
            let tags_str: String = row.get(5)?;
            let is_preset: i32 = row.get(6)?;
            Ok(Voice {
                id: row.get(0)?,
                display_name: row.get(1)?,
                engine: row.get(2)?,
                engine_config: serde_json::from_str(&config_str).unwrap_or(serde_json::Value::Object(serde_json::Map::new())),
                role_type: row.get(4)?,
                tags: serde_json::from_str(&tags_str).unwrap_or_default(),
                is_preset: is_preset != 0,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .map_err(|e| format!("Voice not found: {}", e))
}

#[tauri::command]
pub fn create_voice(
    db: State<DbState>,
    display_name: String,
    engine: String,
    engine_config: serde_json::Value,
    role_type: String,
    tags: Vec<String>,
) -> Result<Voice, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let config_str = serde_json::to_string(&engine_config).map_err(|e| e.to_string())?;
    let tags_str = serde_json::to_string(&tags).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO voices (id, display_name, engine, engine_config, role_type, tags, is_preset, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8)",
        rusqlite::params![id, display_name, engine, config_str, role_type, tags_str, now, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(Voice {
        id,
        display_name,
        engine,
        engine_config,
        role_type,
        tags,
        is_preset: false,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_voice(
    db: State<DbState>,
    id: String,
    display_name: Option<String>,
    engine: Option<String>,
    engine_config: Option<serde_json::Value>,
    role_type: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // Build dynamic UPDATE with transaction protection
    let mut sets: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(v) = display_name {
        sets.push(format!("display_name = ?{}", params.len() + 1));
        params.push(Box::new(v));
    }
    if let Some(v) = engine {
        sets.push(format!("engine = ?{}", params.len() + 1));
        params.push(Box::new(v));
    }
    if let Some(v) = engine_config {
        let s = serde_json::to_string(&v).map_err(|e| e.to_string())?;
        sets.push(format!("engine_config = ?{}", params.len() + 1));
        params.push(Box::new(s));
    }
    if let Some(v) = role_type {
        sets.push(format!("role_type = ?{}", params.len() + 1));
        params.push(Box::new(v));
    }
    if let Some(v) = tags {
        let s = serde_json::to_string(&v).map_err(|e| e.to_string())?;
        sets.push(format!("tags = ?{}", params.len() + 1));
        params.push(Box::new(s));
    }

    if sets.is_empty() {
        return Ok(());
    }

    sets.push(format!("updated_at = ?{}", params.len() + 1));
    params.push(Box::new(now));

    let id_param_idx = params.len() + 1;
    params.push(Box::new(id));

    let sql = format!(
        "UPDATE voices SET {} WHERE id = ?{}",
        sets.join(", "),
        id_param_idx
    );

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, param_refs.as_slice())
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_voice(db: State<DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let is_preset: i32 = conn
        .query_row(
            "SELECT is_preset FROM voices WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Voice not found: {}", e))?;

    if is_preset != 0 {
        return Err("Cannot delete preset voices".to_string());
    }

    conn.execute("DELETE FROM voices WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
