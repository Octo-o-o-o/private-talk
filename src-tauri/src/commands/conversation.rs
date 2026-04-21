use crate::db::{collect_rows, now_timestamp, DbState};
use rusqlite::params;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
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
                    ORDER BY created_at DESC
                    LIMIT 1
                ),
                ''
            ) AS preview,
            conversations.created_at,
            conversations.updated_at
         FROM conversations
         ORDER BY conversations.updated_at DESC",
        [],
        |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                preview: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
}

#[tauri::command]
pub fn create_conversation(
    db: State<DbState>,
    title: Option<String>,
) -> Result<Conversation, String> {
    let conn = db.lock()?;
    let id = uuid::Uuid::new_v4().to_string();
    let title = title.unwrap_or_else(|| "New Chat".to_string());
    let now = now_timestamp();
    conn.execute(
        "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, title, now, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(Conversation {
        id,
        title,
        preview: String::new(),
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn delete_conversation(db: State<DbState>, id: String) -> Result<(), String> {
    let conn = db.lock()?;
    // Messages are deleted explicitly because `PRAGMA foreign_keys` may not cascade
    // on every connection.
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn rename_conversation(db: State<DbState>, id: String, title: String) -> Result<(), String> {
    let conn = db.lock()?;
    conn.execute(
        "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
        params![title, now_timestamp(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_messages(db: State<DbState>, conversation_id: String) -> Result<Vec<Message>, String> {
    let conn = db.lock()?;
    collect_rows(
        &conn,
        "SELECT id, conversation_id, role, content, created_at FROM messages \
         WHERE conversation_id = ?1 ORDER BY created_at ASC",
        params![conversation_id],
        |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        },
    )
}
