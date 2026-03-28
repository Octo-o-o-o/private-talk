use crate::acp::client::AcpState;
use crate::db::DbState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub assistant_id: Option<String>,
    pub scenario_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub openclaw_instance_id: Option<String>,
    pub openclaw_agent_id: Option<String>,
    pub openclaw_session_key: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub is_pinned: bool,
    pub created_at: String,
    pub attachments: Vec<crate::attachments::Attachment>,
}

fn query_conversations(
    conn: &rusqlite::Connection,
    sql: &str,
    params: &[&dyn rusqlite::types::ToSql],
) -> Result<Vec<Conversation>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, |row| {
            let assistant_id: Option<String> = row.get(2)?;
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                assistant_id: assistant_id.clone(),
                scenario_id: assistant_id,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                openclaw_instance_id: row.get(5)?,
                openclaw_agent_id: row.get(6)?,
                openclaw_session_key: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn replace_system_prompt_snapshot(
    conn: &rusqlite::Connection,
    conversation_id: &str,
    assistant_id: Option<&str>,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1 AND role = 'system'",
        rusqlite::params![conversation_id],
    )
    .map_err(|e| e.to_string())?;

    if let Some(assistant_id) = assistant_id {
        let system_prompt: String = conn
            .query_row(
                "SELECT system_prompt FROM scenarios WHERE id = ?1",
                rusqlite::params![assistant_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Assistant not found: {}", e))?;

        if !system_prompt.is_empty() {
            let msg_id = crate::db::new_id();
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, 'system', ?3, ?4)",
                rusqlite::params![msg_id, conversation_id, system_prompt, now],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn list_conversations(
    db: State<DbState>,
    assistant_id: Option<String>,
) -> Result<Vec<Conversation>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    match assistant_id {
        Some(assistant_id) => query_conversations(
            &conn,
            "SELECT id, title, scenario_id, created_at, updated_at, openclaw_instance_id, openclaw_agent_id, openclaw_session_key
             FROM conversations
             WHERE scenario_id = ?1 AND deleted_at IS NULL
             ORDER BY updated_at_order DESC",
            &[&assistant_id as &dyn rusqlite::types::ToSql],
        ),
        None => query_conversations(
            &conn,
            "SELECT id, title, scenario_id, created_at, updated_at, openclaw_instance_id, openclaw_agent_id, openclaw_session_key
             FROM conversations
             WHERE deleted_at IS NULL
             ORDER BY updated_at_order DESC",
            &[],
        ),
    }
}

/// List conversations with no assistant preset (free chat)
#[tauri::command]
pub fn list_free_conversations(db: State<DbState>) -> Result<Vec<Conversation>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    query_conversations(
        &conn,
        "SELECT id, title, scenario_id, created_at, updated_at, openclaw_instance_id, openclaw_agent_id, openclaw_session_key
         FROM conversations
         WHERE scenario_id IS NULL AND deleted_at IS NULL
         ORDER BY updated_at_order DESC",
        &[],
    )
}

#[tauri::command]
pub fn create_conversation(
    db: State<DbState>,
    title: Option<String>,
    assistant_id: Option<String>,
    openclaw_instance_id: Option<String>,
    openclaw_agent_id: Option<String>,
) -> Result<Conversation, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = crate::db::new_id();
    let title = title.unwrap_or_else(|| "New Chat".to_string());
    let now = crate::db::utc_now_str();

    let openclaw_session_key = if openclaw_instance_id.is_some() {
        Some(crate::db::new_id())
    } else {
        None
    };

    conn.execute(
        "INSERT INTO conversations (id, title, scenario_id, openclaw_instance_id, openclaw_agent_id, openclaw_session_key, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, title, assistant_id, openclaw_instance_id, openclaw_agent_id, openclaw_session_key, now, now],
    )
    .map_err(|e| e.to_string())?;

    replace_system_prompt_snapshot(&conn, &id, assistant_id.as_deref(), &now)?;

    Ok(Conversation {
        id,
        title,
        assistant_id: assistant_id.clone(),
        scenario_id: assistant_id,
        created_at: now.clone(),
        updated_at: now,
        openclaw_instance_id,
        openclaw_agent_id,
        openclaw_session_key,
    })
}

#[tauri::command]
pub fn update_conversation_assistant(
    db: State<DbState>,
    id: String,
    assistant_id: Option<String>,
) -> Result<Conversation, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let (title, created_at, oc_instance_id, oc_agent_id, oc_session_key): (String, String, Option<String>, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT title, created_at, openclaw_instance_id, openclaw_agent_id, openclaw_session_key FROM conversations WHERE id = ?1 AND deleted_at IS NULL",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .map_err(|e| format!("Conversation not found: {}", e))?;

    let sent_message_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1 AND role != 'system'",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if sent_message_count > 0 {
        return Err("Cannot change assistant after messages have been sent".to_string());
    }

    let now = crate::db::utc_now_str();

    conn.execute(
        "UPDATE conversations SET scenario_id = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
        rusqlite::params![assistant_id, now, id],
    )
    .map_err(|e| e.to_string())?;

    replace_system_prompt_snapshot(&conn, &id, assistant_id.as_deref(), &now)?;

    Ok(Conversation {
        id,
        title,
        assistant_id: assistant_id.clone(),
        scenario_id: assistant_id,
        created_at,
        updated_at: now,
        openclaw_instance_id: oc_instance_id,
        openclaw_agent_id: oc_agent_id,
        openclaw_session_key: oc_session_key,
    })
}

#[tauri::command]
pub fn update_conversation_scenario(
    db: State<DbState>,
    id: String,
    scenario_id: Option<String>,
) -> Result<Conversation, String> {
    update_conversation_assistant(db, id, scenario_id)
}

#[tauri::command]
pub async fn delete_conversation(
    db: State<'_, DbState>,
    acp_state: State<'_, AcpState>,
    id: String,
) -> Result<(), String> {
    crate::commands::openclaw::kill_acp_for_conversation(&acp_state, &id).await;

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = crate::db::utc_now_str();

    let msg_ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM messages WHERE conversation_id = ?1")
            .map_err(|e| e.to_string())?;
        let ids = stmt
            .query_map(rusqlite::params![id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        ids
    };
    if !msg_ids.is_empty() {
        let attachments = crate::attachments::get_attachments_for_messages(&conn, &msg_ids)?;
        crate::attachments::delete_attachment_files(&attachments);
    }

    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE conversations
         SET deleted_at = COALESCE(deleted_at, ?1)
         WHERE id = ?2",
        rusqlite::params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn rename_conversation(db: State<DbState>, id: String, title: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = crate::db::utc_now_str();
    conn.execute(
        "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
        rusqlite::params![title, now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_messages(db: State<DbState>, conversation_id: String) -> Result<Vec<Message>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, role, content, is_pinned, created_at FROM messages WHERE conversation_id = ?1 ORDER BY message_order ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![conversation_id], |row| {
            let pinned: i32 = row.get(4)?;
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                is_pinned: pinned != 0,
                created_at: row.get(5)?,
                attachments: vec![],
            })
        })
        .map_err(|e| e.to_string())?;
    let mut msgs: Vec<Message> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Batch-load attachments for all messages
    let msg_ids: Vec<String> = msgs.iter().map(|m| m.id.clone()).collect();
    let all_attachments = crate::attachments::get_attachments_for_messages(&conn, &msg_ids)?;
    for att in all_attachments {
        if let Some(msg) = msgs.iter_mut().find(|m| m.id == att.message_id) {
            msg.attachments.push(att);
        }
    }

    Ok(msgs)
}
