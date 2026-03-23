use crate::db::DbState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Scenario {
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

fn parse_voice_mapping(json_str: &str) -> serde_json::Value {
    serde_json::from_str(json_str).unwrap_or(serde_json::json!({}))
}

#[tauri::command]
pub fn list_scenarios(db: State<DbState>) -> Result<Vec<Scenario>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, name_en, description, description_en, system_prompt, icon, is_preset, voice_mapping, tts_enabled, auto_play, created_at, updated_at
             FROM scenarios ORDER BY is_preset DESC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let is_preset: i32 = row.get(7)?;
            let vm_str: String = row.get(8)?;
            let tts: i32 = row.get(9)?;
            let ap: i32 = row.get(10)?;
            Ok(Scenario {
                id: row.get(0)?,
                name: row.get(1)?,
                name_en: row.get(2)?,
                description: row.get(3)?,
                description_en: row.get(4)?,
                system_prompt: row.get(5)?,
                icon: row.get(6)?,
                is_preset: is_preset != 0,
                voice_mapping: parse_voice_mapping(&vm_str),
                tts_enabled: tts != 0,
                auto_play: ap != 0,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_scenario(db: State<DbState>, id: String) -> Result<Scenario, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, name, name_en, description, description_en, system_prompt, icon, is_preset, voice_mapping, tts_enabled, auto_play, created_at, updated_at
         FROM scenarios WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            let is_preset: i32 = row.get(7)?;
            let vm_str: String = row.get(8)?;
            let tts: i32 = row.get(9)?;
            let ap: i32 = row.get(10)?;
            Ok(Scenario {
                id: row.get(0)?,
                name: row.get(1)?,
                name_en: row.get(2)?,
                description: row.get(3)?,
                description_en: row.get(4)?,
                system_prompt: row.get(5)?,
                icon: row.get(6)?,
                is_preset: is_preset != 0,
                voice_mapping: parse_voice_mapping(&vm_str),
                tts_enabled: tts != 0,
                auto_play: ap != 0,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        },
    )
    .map_err(|e| format!("Scenario not found: {}", e))
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
) -> Result<Scenario, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let icon = icon.unwrap_or_default();
    let vm = voice_mapping.clone().unwrap_or(serde_json::json!({}));
    let vm_str = serde_json::to_string(&vm).map_err(|e| e.to_string())?;
    let te = tts_enabled.unwrap_or(false);
    let ap = auto_play.unwrap_or(false);

    conn.execute(
        "INSERT INTO scenarios (id, name, description, system_prompt, icon, is_preset, voice_mapping, tts_enabled, auto_play, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![id, name, description, system_prompt, icon, vm_str, te as i32, ap as i32, now, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(Scenario {
        id,
        name,
        name_en: String::new(),
        description,
        description_en: String::new(),
        system_prompt,
        icon,
        is_preset: false,
        voice_mapping: vm,
        tts_enabled: te,
        auto_play: ap,
        created_at: now.clone(),
        updated_at: now,
    })
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
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let is_preset: i32 = conn
        .query_row(
            "SELECT is_preset FROM scenarios WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Scenario not found: {}", e))?;

    if is_preset != 0 {
        return Err("Cannot edit preset scenarios".to_string());
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    if let Some(name) = name {
        conn.execute(
            "UPDATE scenarios SET name = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![name, now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(description) = description {
        conn.execute(
            "UPDATE scenarios SET description = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![description, now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(system_prompt) = system_prompt {
        conn.execute(
            "UPDATE scenarios SET system_prompt = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![system_prompt, now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(icon) = icon {
        conn.execute(
            "UPDATE scenarios SET icon = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![icon, now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(vm) = voice_mapping {
        let vm_str = serde_json::to_string(&vm).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE scenarios SET voice_mapping = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![vm_str, now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(tts) = tts_enabled {
        conn.execute(
            "UPDATE scenarios SET tts_enabled = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![tts as i32, now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(ap) = auto_play {
        conn.execute(
            "UPDATE scenarios SET auto_play = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![ap as i32, now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_scenario(db: State<DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let is_preset: i32 = conn
        .query_row(
            "SELECT is_preset FROM scenarios WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Scenario not found: {}", e))?;

    if is_preset != 0 {
        return Err("Cannot delete preset scenarios".to_string());
    }

    conn.execute("DELETE FROM scenarios WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn duplicate_scenario(db: State<DbState>, id: String) -> Result<Scenario, String> {
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
        .map_err(|e| format!("Scenario not found: {}", e))?;

    let new_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let new_name = format!("{} (Copy)", source.0);

    conn.execute(
        "INSERT INTO scenarios (id, name, name_en, description, description_en, system_prompt, icon, is_preset, voice_mapping, tts_enabled, auto_play, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![new_id, new_name, source.1, source.2, source.3, source.4, source.5, source.6, source.7, source.8, now, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(Scenario {
        id: new_id,
        name: new_name,
        name_en: String::new(),
        description: source.2,
        description_en: source.3,
        system_prompt: source.4,
        icon: source.5,
        is_preset: false,
        voice_mapping: parse_voice_mapping(&source.6),
        tts_enabled: source.7 != 0,
        auto_play: source.8 != 0,
        created_at: now.clone(),
        updated_at: now,
    })
}
