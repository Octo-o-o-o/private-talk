use crate::db::DbState;
use crate::llm::provider::stream_chat;
use crate::llm::types::ChatMessage;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, State};

// Global stop flag
static STOP_FLAG: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
struct StreamChunkPayload {
    conversation_id: String,
    content: String,
}

#[derive(Clone, Serialize)]
struct StreamDonePayload {
    conversation_id: String,
    message_id: String,
    full_content: String,
}

#[derive(Clone, Serialize)]
struct StreamErrorPayload {
    conversation_id: String,
    error: String,
}

#[tauri::command]
pub async fn send_message(
    app: tauri::AppHandle,
    db: State<'_, DbState>,
    conversation_id: String,
    content: String,
    provider_id: String,
    model: String,
) -> Result<(), String> {
    STOP_FLAG.store(false, Ordering::SeqCst);

    // Save user message
    let user_msg_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, 'user', ?3, ?4)",
            rusqlite::params![user_msg_id, conversation_id, content, now],
        )
        .map_err(|e| e.to_string())?;

        // Update conversation timestamp
        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, conversation_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // Load provider info
    let (base_url, api_key) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let row = conn.query_row(
            "SELECT base_url, api_key FROM providers WHERE id = ?1",
            rusqlite::params![provider_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|e| format!("Provider not found: {}", e))?;
        row
    };

    // Load conversation history
    let messages = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT role, content FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![conversation_id], |row| {
                Ok(ChatMessage {
                    role: row.get(0)?,
                    content: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut msgs = Vec::new();
        for row in rows {
            msgs.push(row.map_err(|e| e.to_string())?);
        }
        msgs
    };

    // Start streaming
    let conv_id = conversation_id.clone();
    let app_handle = app.clone();

    let mut rx = stream_chat(&base_url, &api_key, &model, messages, None)
        .await
        .map_err(|e| {
            let _ = app_handle.emit(
                "chat-stream-error",
                StreamErrorPayload {
                    conversation_id: conv_id.clone(),
                    error: e.clone(),
                },
            );
            e
        })?;

    // Collect full response
    let conv_id = conversation_id.clone();
    let app_handle = app.clone();
    let mut full_content = String::new();

    while let Some(chunk) = rx.recv().await {
        if STOP_FLAG.load(Ordering::SeqCst) {
            break;
        }
        match chunk {
            Ok(text) => {
                full_content.push_str(&text);
                let _ = app_handle.emit(
                    "chat-stream-chunk",
                    StreamChunkPayload {
                        conversation_id: conv_id.clone(),
                        content: text,
                    },
                );
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "chat-stream-error",
                    StreamErrorPayload {
                        conversation_id: conv_id.clone(),
                        error: e,
                    },
                );
                break;
            }
        }
    }

    // Save assistant message
    let assistant_msg_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, 'assistant', ?3, ?4)",
            rusqlite::params![assistant_msg_id, conversation_id, full_content, now],
        )
        .map_err(|e| e.to_string())?;
    }

    let _ = app.emit(
        "chat-stream-done",
        StreamDonePayload {
            conversation_id,
            message_id: assistant_msg_id,
            full_content,
        },
    );

    Ok(())
}

#[tauri::command]
pub fn stop_generation() -> Result<(), String> {
    STOP_FLAG.store(true, Ordering::SeqCst);
    Ok(())
}
