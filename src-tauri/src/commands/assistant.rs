use crate::db::DbState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Assistant {
    pub id: String,
    pub name: String,
    pub name_en: String,
    pub description: String,
    pub description_en: String,
    pub system_prompt: String,
    pub icon: String,
    pub is_preset: bool,
    pub voice_mapping: serde_json::Value,
    pub tts_enabled: bool,
    pub auto_play: bool,
    pub created_at: String,
    pub updated_at: String,
}

use crate::db::{new_id, utc_now_str, parse_json_or_empty};

fn assistant_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Assistant> {
    let is_preset: i32 = row.get(7)?;
    let voice_mapping_str: String = row.get(8)?;
    let tts_enabled: i32 = row.get(9)?;
    let auto_play: i32 = row.get(10)?;

    Ok(Assistant {
        id: row.get(0)?,
        name: row.get(1)?,
        name_en: row.get(2)?,
        description: row.get(3)?,
        description_en: row.get(4)?,
        system_prompt: row.get(5)?,
        icon: row.get(6)?,
        is_preset: is_preset != 0,
        voice_mapping: parse_json_or_empty(&voice_mapping_str),
        tts_enabled: tts_enabled != 0,
        auto_play: auto_play != 0,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

#[tauri::command]
pub fn list_assistants(db: State<DbState>) -> Result<Vec<Assistant>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, name_en, description, description_en, system_prompt, icon, is_preset, voice_mapping, tts_enabled, auto_play, created_at, updated_at
             FROM scenarios ORDER BY is_preset DESC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], assistant_from_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_assistant(db: State<DbState>, id: String) -> Result<Assistant, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, name, name_en, description, description_en, system_prompt, icon, is_preset, voice_mapping, tts_enabled, auto_play, created_at, updated_at
         FROM scenarios WHERE id = ?1",
        rusqlite::params![id],
        assistant_from_row,
    )
    .map_err(|e| format!("Assistant not found: {}", e))
}

#[tauri::command]
pub fn create_assistant(
    db: State<DbState>,
    name: String,
    description: String,
    system_prompt: String,
    icon: Option<String>,
    voice_mapping: Option<serde_json::Value>,
    tts_enabled: Option<bool>,
    auto_play: Option<bool>,
) -> Result<Assistant, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = new_id();
    let now = utc_now_str();
    let icon = icon.unwrap_or_default();
    let voice_mapping_value = voice_mapping.unwrap_or_else(|| serde_json::json!({}));
    let voice_mapping_str =
        serde_json::to_string(&voice_mapping_value).map_err(|e| e.to_string())?;
    let tts_enabled = tts_enabled.unwrap_or(false);
    let auto_play = auto_play.unwrap_or(false);

    conn.execute(
        "INSERT INTO scenarios (id, name, description, system_prompt, icon, is_preset, voice_mapping, tts_enabled, auto_play, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            id,
            name,
            description,
            system_prompt,
            icon,
            voice_mapping_str,
            tts_enabled as i32,
            auto_play as i32,
            now,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(Assistant {
        id,
        name,
        name_en: String::new(),
        description,
        description_en: String::new(),
        system_prompt,
        icon,
        is_preset: false,
        voice_mapping: voice_mapping_value,
        tts_enabled,
        auto_play,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_assistant(
    db: State<DbState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    system_prompt: Option<String>,
    icon: Option<String>,
    voice_mapping: Option<serde_json::Value>,
    tts_enabled: Option<bool>,
    auto_play: Option<bool>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let is_preset: i32 = conn
        .query_row(
            "SELECT is_preset FROM scenarios WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Assistant not found: {}", e))?;

    if is_preset != 0 {
        return Err("Cannot edit preset assistants".to_string());
    }

    let now = utc_now_str();

    let mut sets: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(v) = name {
        sets.push(format!("name = ?{}", params.len() + 1));
        params.push(Box::new(v));
    }
    if let Some(v) = description {
        sets.push(format!("description = ?{}", params.len() + 1));
        params.push(Box::new(v));
    }
    if let Some(v) = system_prompt {
        sets.push(format!("system_prompt = ?{}", params.len() + 1));
        params.push(Box::new(v));
    }
    if let Some(v) = icon {
        sets.push(format!("icon = ?{}", params.len() + 1));
        params.push(Box::new(v));
    }
    if let Some(v) = voice_mapping {
        let s = serde_json::to_string(&v).map_err(|e| e.to_string())?;
        sets.push(format!("voice_mapping = ?{}", params.len() + 1));
        params.push(Box::new(s));
    }
    if let Some(v) = tts_enabled {
        sets.push(format!("tts_enabled = ?{}", params.len() + 1));
        params.push(Box::new(v as i32));
    }
    if let Some(v) = auto_play {
        sets.push(format!("auto_play = ?{}", params.len() + 1));
        params.push(Box::new(v as i32));
    }

    if sets.is_empty() {
        return Ok(());
    }

    sets.push(format!("updated_at = ?{}", params.len() + 1));
    params.push(Box::new(now));

    let id_param_idx = params.len() + 1;
    params.push(Box::new(id));

    let sql = format!(
        "UPDATE scenarios SET {} WHERE id = ?{}",
        sets.join(", "),
        id_param_idx
    );

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, param_refs.as_slice())
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_assistant(db: State<DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let is_preset: i32 = conn
        .query_row(
            "SELECT is_preset FROM scenarios WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Assistant not found: {}", e))?;

    if is_preset != 0 {
        return Err("Cannot delete preset assistants".to_string());
    }

    conn.execute("DELETE FROM scenarios WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn duplicate_assistant(db: State<DbState>, id: String) -> Result<Assistant, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let source = conn
        .query_row(
            "SELECT name, name_en, description, description_en, system_prompt, icon, voice_mapping, tts_enabled, auto_play FROM scenarios WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, i32>(7)?,
                    row.get::<_, i32>(8)?,
                ))
            },
        )
        .map_err(|e| format!("Assistant not found: {}", e))?;

    let new_id = new_id();
    let now = utc_now_str();
    let new_name = format!("{} (Copy)", source.0);

    conn.execute(
        "INSERT INTO scenarios (id, name, name_en, description, description_en, system_prompt, icon, is_preset, voice_mapping, tts_enabled, auto_play, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![
            new_id, new_name, source.1, source.2, source.3, source.4, source.5, source.6,
            source.7, source.8, now, now
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(Assistant {
        id: new_id,
        name: new_name,
        name_en: String::new(),
        description: source.2,
        description_en: source.3,
        system_prompt: source.4,
        icon: source.5,
        is_preset: false,
        voice_mapping: parse_json_or_empty(&source.6),
        tts_enabled: source.7 != 0,
        auto_play: source.8 != 0,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn list_scenarios(db: State<DbState>) -> Result<Vec<Assistant>, String> {
    list_assistants(db)
}

#[tauri::command]
pub fn get_scenario(db: State<DbState>, id: String) -> Result<Assistant, String> {
    get_assistant(db, id)
}

#[tauri::command]
pub fn create_scenario(
    db: State<DbState>,
    name: String,
    description: String,
    system_prompt: String,
    icon: Option<String>,
    voice_mapping: Option<serde_json::Value>,
    tts_enabled: Option<bool>,
    auto_play: Option<bool>,
) -> Result<Assistant, String> {
    create_assistant(
        db,
        name,
        description,
        system_prompt,
        icon,
        voice_mapping,
        tts_enabled,
        auto_play,
    )
}

#[tauri::command]
pub fn update_scenario(
    db: State<DbState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    system_prompt: Option<String>,
    icon: Option<String>,
    voice_mapping: Option<serde_json::Value>,
    tts_enabled: Option<bool>,
    auto_play: Option<bool>,
) -> Result<(), String> {
    update_assistant(
        db,
        id,
        name,
        description,
        system_prompt,
        icon,
        voice_mapping,
        tts_enabled,
        auto_play,
    )
}

#[tauri::command]
pub fn delete_scenario(db: State<DbState>, id: String) -> Result<(), String> {
    delete_assistant(db, id)
}

#[tauri::command]
pub fn duplicate_scenario(db: State<DbState>, id: String) -> Result<Assistant, String> {
    duplicate_assistant(db, id)
}
