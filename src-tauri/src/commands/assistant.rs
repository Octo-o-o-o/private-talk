use crate::db::{now_timestamp, DbState};
use rusqlite::{params, Connection};
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

// ---------- DB helpers (testable without Tauri State) ----------

fn list_assistants_db(conn: &Connection) -> Result<Vec<Assistant>, String> {
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

fn create_assistant_db(
    conn: &Connection,
    name: String,
    description: String,
    system_prompt: String,
    icon: Option<String>,
) -> Result<Assistant, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Assistant name cannot be empty.".to_string());
    }

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

fn update_assistant_db(
    conn: &Connection,
    id: String,
    name: Option<String>,
    description: Option<String>,
    system_prompt: Option<String>,
    icon: Option<String>,
) -> Result<(), String> {
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

fn delete_assistant_db(conn: &Connection, id: String) -> Result<(), String> {
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

fn duplicate_assistant_db(conn: &Connection, id: String) -> Result<Assistant, String> {
    let (name, description, system_prompt, icon) = conn
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

    let copy_name = format!("{} Copy", name.trim());
    let new_id = uuid::Uuid::new_v4().to_string();
    let now = now_timestamp();
    conn.execute(
        "INSERT INTO assistants (id, name, description, system_prompt, icon, is_preset, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
        params![new_id, copy_name, description, system_prompt, icon, now, now],
    )
    .map_err(|error| error.to_string())?;

    Ok(Assistant {
        id: new_id,
        name: copy_name,
        description,
        system_prompt,
        icon,
        is_preset: false,
        created_at: now.clone(),
        updated_at: now,
    })
}

// ---------- Tauri command shims ----------

#[tauri::command]
pub fn list_assistants(db: State<'_, DbState>) -> Result<Vec<Assistant>, String> {
    let conn = db.lock()?;
    list_assistants_db(&conn)
}

#[tauri::command]
pub fn create_assistant(
    db: State<'_, DbState>,
    name: String,
    description: String,
    system_prompt: String,
    icon: Option<String>,
) -> Result<Assistant, String> {
    let conn = db.lock()?;
    create_assistant_db(&conn, name, description, system_prompt, icon)
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
    update_assistant_db(&conn, id, name, description, system_prompt, icon)
}

#[tauri::command]
pub fn delete_assistant(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.lock()?;
    delete_assistant_db(&conn, id)
}

#[tauri::command]
pub fn duplicate_assistant(db: State<'_, DbState>, id: String) -> Result<Assistant, String> {
    let conn = db.lock()?;
    duplicate_assistant_db(&conn, id)
}

#[cfg(test)]
mod tests {
    use super::{
        create_assistant_db, delete_assistant_db, duplicate_assistant_db, list_assistants_db,
        update_assistant_db,
    };
    use crate::db::schema::init_db;
    use rusqlite::{params, Connection};

    fn fresh() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init_db(&c).unwrap();
        c
    }

    fn preset_id(conn: &Connection) -> String {
        conn.query_row(
            "SELECT id FROM assistants WHERE is_preset = 1 LIMIT 1",
            [],
            |row| row.get(0),
        )
        .expect("at least one preset assistant after init_db")
    }

    #[test]
    fn list_assistants_orders_presets_first_then_creation_time() {
        let conn = fresh();
        let custom = create_assistant_db(
            &conn,
            "Custom".into(),
            "desc".into(),
            "be helpful".into(),
            None,
        )
        .unwrap();

        let list = list_assistants_db(&conn).unwrap();
        // First N entries must all be presets.
        let first_non_preset_index = list.iter().position(|a| !a.is_preset).unwrap();
        for a in &list[..first_non_preset_index] {
            assert!(a.is_preset, "presets must come first");
        }
        // Custom assistant appears at the tail.
        assert_eq!(list.last().unwrap().id, custom.id);
    }

    #[test]
    fn create_assistant_rejects_empty_name() {
        let conn = fresh();
        let err = create_assistant_db(
            &conn,
            "   ".into(),
            "desc".into(),
            "prompt".into(),
            None,
        )
        .expect_err("must reject empty name");
        assert!(err.contains("name cannot be empty"));
    }

    #[test]
    fn create_assistant_trims_whitespace_around_fields() {
        let conn = fresh();
        let a = create_assistant_db(
            &conn,
            "  Pirate  ".into(),
            "  desc  ".into(),
            "  prompt  ".into(),
            None,
        )
        .unwrap();
        assert_eq!(a.name, "Pirate");
        assert_eq!(a.description, "desc");
        assert_eq!(a.system_prompt, "prompt");
        assert!(!a.is_preset);
    }

    #[test]
    fn update_assistant_rejects_preset_edits() {
        let conn = fresh();
        let preset = preset_id(&conn);
        let err = update_assistant_db(
            &conn,
            preset,
            Some("Hijacked".into()),
            None,
            None,
            None,
        )
        .expect_err("preset assistants must be read-only");
        assert!(err.contains("Cannot edit preset"));
    }

    #[test]
    fn update_assistant_rejects_empty_name_for_custom_assistant() {
        let conn = fresh();
        let a = create_assistant_db(
            &conn,
            "Custom".into(),
            "".into(),
            "".into(),
            None,
        )
        .unwrap();
        let err = update_assistant_db(&conn, a.id, Some(" ".into()), None, None, None)
            .expect_err("must reject blank name");
        assert!(err.contains("name cannot be empty"));
    }

    #[test]
    fn update_assistant_only_touches_provided_fields() {
        let conn = fresh();
        let a = create_assistant_db(
            &conn,
            "Custom".into(),
            "orig desc".into(),
            "orig prompt".into(),
            Some("sparkles".into()),
        )
        .unwrap();

        update_assistant_db(
            &conn,
            a.id.clone(),
            None,
            Some("new desc".into()),
            None,
            None,
        )
        .unwrap();

        let after = list_assistants_db(&conn)
            .unwrap()
            .into_iter()
            .find(|x| x.id == a.id)
            .unwrap();
        assert_eq!(after.name, "Custom");
        assert_eq!(after.description, "new desc");
        assert_eq!(after.system_prompt, "orig prompt");
        assert_eq!(after.icon, "sparkles");
    }

    #[test]
    fn delete_assistant_rejects_preset_deletion() {
        let conn = fresh();
        let preset = preset_id(&conn);
        let err = delete_assistant_db(&conn, preset.clone())
            .expect_err("preset assistants must be undeletable");
        assert!(err.contains("Cannot delete preset"));

        // Sanity: preset still exists.
        let still_there: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM assistants WHERE id = ?1",
                params![preset],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(still_there, 1);
    }

    #[test]
    fn delete_assistant_nulls_conversations_assistant_id() {
        let conn = fresh();
        let a = create_assistant_db(
            &conn,
            "Custom".into(),
            "".into(),
            "".into(),
            None,
        )
        .unwrap();
        conn.execute(
            "INSERT INTO conversations (id, title, assistant_id, created_at, updated_at)
             VALUES ('c1', 'T', ?1, datetime('now'), datetime('now'))",
            params![a.id],
        )
        .unwrap();

        delete_assistant_db(&conn, a.id.clone()).unwrap();

        let linked: Option<String> = conn
            .query_row(
                "SELECT assistant_id FROM conversations WHERE id = 'c1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(linked.is_none(), "conversation.assistant_id must be NULL after delete");
    }

    #[test]
    fn duplicate_assistant_creates_copy_with_suffix_and_new_id() {
        let conn = fresh();
        let original = create_assistant_db(
            &conn,
            "Pirate".into(),
            "rude tone".into(),
            "talk like a pirate".into(),
            Some("anchor".into()),
        )
        .unwrap();

        let copy = duplicate_assistant_db(&conn, original.id.clone()).unwrap();

        assert_ne!(copy.id, original.id);
        assert_eq!(copy.name, "Pirate Copy");
        assert_eq!(copy.description, "rude tone");
        assert_eq!(copy.system_prompt, "talk like a pirate");
        assert_eq!(copy.icon, "anchor");
        assert!(!copy.is_preset);
    }
}
