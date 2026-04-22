use crate::db::{collect_rows, now_timestamp, DbState};
use rusqlite::params;
use serde::Serialize;
use tauri::{Manager, State};

#[derive(Debug, Serialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub assistant_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub attachments: Vec<crate::attachments::Attachment>,
    pub created_at: String,
}

#[tauri::command]
pub fn list_conversations(db: State<DbState>) -> Result<Vec<Conversation>, String> {
    let conn = db.lock()?;
    collect_rows(
        &conn,
        "SELECT
            conversations.id,
            conversations.title,
            COALESCE(
                (
                    SELECT content
                    FROM messages
                    WHERE conversation_id = conversations.id
                      AND role != 'system'
                    ORDER BY created_at DESC
                    LIMIT 1
                ),
                ''
            ) AS preview,
            conversations.assistant_id,
            conversations.created_at,
            conversations.updated_at
         FROM conversations
         WHERE conversations.deleted_at IS NULL
         ORDER BY conversations.updated_at DESC",
        [],
        |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                preview: row.get(2)?,
                assistant_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
}

#[tauri::command]
pub fn create_conversation(
    db: State<DbState>,
    title: Option<String>,
    assistant_id: Option<String>,
) -> Result<Conversation, String> {
    let conn = db.lock()?;
    let id = uuid::Uuid::new_v4().to_string();
    let title = title.unwrap_or_else(|| "New Chat".to_string());
    let now = now_timestamp();
    conn.execute(
        "INSERT INTO conversations (id, title, assistant_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, title, assistant_id, now, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(Conversation {
        id,
        title,
        preview: String::new(),
        assistant_id,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_conversation_assistant(
    db: State<DbState>,
    id: String,
    assistant_id: Option<String>,
) -> Result<Conversation, String> {
    let conn = db.lock()?;
    let (title, preview, created_at): (String, String, String) = conn
        .query_row(
            "SELECT title,
                    COALESCE(
                        (
                            SELECT content
                            FROM messages
                            WHERE conversation_id = conversations.id
                            ORDER BY created_at DESC
                            LIMIT 1
                        ),
                        ''
                    ) AS preview,
                    created_at
             FROM conversations
             WHERE id = ?1
               AND deleted_at IS NULL",
            params![id.clone()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| format!("Conversation not found: {error}"))?;

    let sent_message_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1 AND role != 'system'",
            params![id.clone()],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    if sent_message_count > 0 {
        return Err("Cannot change assistant after messages have been sent.".to_string());
    }

    let now = now_timestamp();
    conn.execute(
        "UPDATE conversations
         SET assistant_id = ?1, updated_at = ?2
         WHERE id = ?3
           AND deleted_at IS NULL",
        params![assistant_id, now, id.clone()],
    )
    .map_err(|error| error.to_string())?;

    Ok(Conversation {
        id,
        title,
        preview,
        assistant_id,
        created_at,
        updated_at: now,
    })
}

#[tauri::command]
pub fn delete_conversation(
    app: tauri::AppHandle,
    db: State<DbState>,
    id: String,
) -> Result<(), String> {
    let conn = db.lock()?;
    let message_ids = collect_rows(
        &conn,
        "SELECT id FROM messages WHERE conversation_id = ?1",
        params![id.clone()],
        |row| row.get::<_, String>(0),
    )?;
    if !message_ids.is_empty() {
        let attachments = crate::attachments::get_attachments_for_messages(&conn, &message_ids)?;
        crate::attachments::delete_attachment_files(&attachments);
        conn.execute(
            "DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?1)",
            params![id.clone()],
        )
        .map_err(|e| e.to_string())?;
    }
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1",
        params![id.clone()],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE conversations
         SET deleted_at = COALESCE(deleted_at, ?1)
         WHERE id = ?2",
        params![now_timestamp(), id.clone()],
    )
    .map_err(|e| e.to_string())?;

    let generated_images_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("generated-images")
        .join(&id);
    if let Err(error) = std::fs::remove_dir_all(&generated_images_dir) {
        if error.kind() != std::io::ErrorKind::NotFound {
            return Err(error.to_string());
        }
    }

    Ok(())
}

#[tauri::command]
pub fn rename_conversation(db: State<DbState>, id: String, title: String) -> Result<(), String> {
    let conn = db.lock()?;
    let updated_rows = conn
        .execute(
            "UPDATE conversations
         SET title = ?1, updated_at = ?2
         WHERE id = ?3
           AND deleted_at IS NULL",
            params![title, now_timestamp(), id],
        )
        .map_err(|e| e.to_string())?;
    if updated_rows == 0 {
        return Ok(());
    }
    conn.execute(
        "UPDATE usage_records SET conversation_title = ?1 WHERE conversation_id = ?2",
        params![title, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_messages(db: State<DbState>, conversation_id: String) -> Result<Vec<Message>, String> {
    let conn = db.lock()?;
    let mut messages = collect_rows(
        &conn,
        "SELECT id, conversation_id, role, content, created_at FROM messages \
         WHERE conversation_id = ?1 AND role != 'system' ORDER BY created_at ASC",
        params![conversation_id],
        |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                attachments: vec![],
                created_at: row.get(4)?,
            })
        },
    )?;

    let message_ids = messages
        .iter()
        .map(|message| message.id.clone())
        .collect::<Vec<_>>();
    let attachments = crate::attachments::get_attachments_for_messages(&conn, &message_ids)?;
    for attachment in attachments {
        if let Some(message) = messages
            .iter_mut()
            .find(|message| message.id == attachment.message_id)
        {
            message.attachments.push(attachment);
        }
    }

    Ok(messages)
}
