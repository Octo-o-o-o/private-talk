use crate::db::{now_timestamp, DbState};
use rusqlite::params;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct Assistant {
    pub id: String,
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    pub icon: String,
    pub is_preset: bool,
    pub created_at: String,
    pub updated_at: String,
}

fn assistant_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Assistant> {
    Ok(Assistant {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        system_prompt: row.get(3)?,
        icon: row.get(4)?,
        is_preset: row.get::<_, i64>(5)? != 0,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

#[tauri::command]
pub fn list_assistants(db: State<'_, DbState>) -> Result<Vec<Assistant>, String> {
    let conn = db.lock()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, system_prompt, icon, is_preset, created_at, updated_at
             FROM assistants
             ORDER BY is_preset DESC, created_at ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], assistant_from_row)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_assistant(
    db: State<'_, DbState>,
    name: String,
    description: String,
    system_prompt: String,
    icon: Option<String>,
) -> Result<Assistant, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Assistant name cannot be empty.".to_string());
    }

    let conn = db.lock()?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_timestamp();
    let icon = icon.unwrap_or_default();

    conn.execute(
        "INSERT INTO assistants (id, name, description, system_prompt, icon, is_preset, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
        params![
            id,
            trimmed_name,
            description.trim(),
            system_prompt.trim(),
            icon,
            now,
            now,
        ],
    )
    .map_err(|error| error.to_string())?;

    Ok(Assistant {
        id,
        name: trimmed_name.to_string(),
        description: description.trim().to_string(),
        system_prompt: system_prompt.trim().to_string(),
        icon,
        is_preset: false,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_assistant(
    db: State<'_, DbState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    system_prompt: Option<String>,
    icon: Option<String>,
) -> Result<(), String> {
    let conn = db.lock()?;
    let is_preset: i64 = conn
        .query_row(
            "SELECT is_preset FROM assistants WHERE id = ?1",
            params![id.clone()],
            |row| row.get(0),
        )
        .map_err(|error| format!("Assistant not found: {error}"))?;

    if is_preset != 0 {
        return Err("Cannot edit preset assistants.".to_string());
    }

    let now = now_timestamp();
    if let Some(value) = name {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err("Assistant name cannot be empty.".to_string());
        }
        conn.execute(
            "UPDATE assistants SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![trimmed, now, id.clone()],
        )
        .map_err(|error| error.to_string())?;
    }
    if let Some(value) = description {
        conn.execute(
            "UPDATE assistants SET description = ?1, updated_at = ?2 WHERE id = ?3",
            params![value.trim(), now, id.clone()],
        )
        .map_err(|error| error.to_string())?;
    }
    if let Some(value) = system_prompt {
        conn.execute(
            "UPDATE assistants SET system_prompt = ?1, updated_at = ?2 WHERE id = ?3",
            params![value.trim(), now, id.clone()],
        )
        .map_err(|error| error.to_string())?;
    }
    if let Some(value) = icon {
        conn.execute(
            "UPDATE assistants SET icon = ?1, updated_at = ?2 WHERE id = ?3",
            params![value.trim(), now, id],
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn delete_assistant(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.lock()?;
    let is_preset: i64 = conn
        .query_row(
            "SELECT is_preset FROM assistants WHERE id = ?1",
            params![id.clone()],
            |row| row.get(0),
        )
        .map_err(|error| format!("Assistant not found: {error}"))?;

    if is_preset != 0 {
        return Err("Cannot delete preset assistants.".to_string());
    }

    conn.execute(
        "UPDATE conversations SET assistant_id = NULL WHERE assistant_id = ?1",
        params![id.clone()],
    )
    .map_err(|error| error.to_string())?;
    conn.execute("DELETE FROM assistants WHERE id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn duplicate_assistant(db: State<'_, DbState>, id: String) -> Result<Assistant, String> {
    let conn = db.lock()?;
    let source = conn
        .query_row(
            "SELECT name, description, system_prompt, icon FROM assistants WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(|error| format!("Assistant not found: {error}"))?;

    let copy_name = format!("{} Copy", source.0.trim());
    let new_id = uuid::Uuid::new_v4().to_string();
    let now = now_timestamp();
    conn.execute(
        "INSERT INTO assistants (id, name, description, system_prompt, icon, is_preset, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
        params![new_id, copy_name, source.1, source.2, source.3, now, now],
    )
    .map_err(|error| error.to_string())?;

    Ok(Assistant {
        id: new_id,
        name: copy_name,
        description: source.1,
        system_prompt: source.2,
        icon: source.3,
        is_preset: false,
        created_at: now.clone(),
        updated_at: now,
    })
}
