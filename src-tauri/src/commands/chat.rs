use crate::db::{collect_rows, now_timestamp, DbState};
use crate::llm::provider::stream_chat;
use crate::llm::types::ChatMessage;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, State};

// Cooperative stop flag toggled by `stop_generation` and checked in the streaming loop.
static STOP_FLAG: AtomicBool = AtomicBool::new(false);

const EVENT_CHUNK: &str = "chat-stream-chunk";
const EVENT_DONE: &str = "chat-stream-done";
const EVENT_ERROR: &str = "chat-stream-error";

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

fn insert_message(
    conn: &Connection,
    conversation_id: &str,
    role: &str,
    content: &str,
    now: &str,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, conversation_id, role, content, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

fn touch_conversation(conn: &Connection, conversation_id: &str, now: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![now, conversation_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn load_provider(conn: &Connection, provider_id: &str) -> Result<(String, String), String> {
    conn.query_row(
        "SELECT base_url, api_key FROM providers WHERE id = ?1",
        params![provider_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )
    .map_err(|e| format!("Provider not found: {}", e))
}

fn load_history(conn: &Connection, conversation_id: &str) -> Result<Vec<ChatMessage>, String> {
    collect_rows(
        conn,
        "SELECT role, content FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
        params![conversation_id],
        |row| {
            Ok(ChatMessage {
                role: row.get(0)?,
                content: row.get(1)?,
            })
        },
    )
}

fn emit_error(app: &tauri::AppHandle, conversation_id: &str, error: String) {
    let _ = app.emit(
        EVENT_ERROR,
        StreamErrorPayload {
            conversation_id: conversation_id.to_string(),
            error,
        },
    );
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

    let now = now_timestamp();

    // Persist the user turn, refresh the conversation timestamp, and grab everything
    // we need for the request inside a single lock scope.
    let (base_url, api_key, history) = {
        let conn = db.lock()?;
        insert_message(&conn, &conversation_id, "user", &content, &now)?;
        touch_conversation(&conn, &conversation_id, &now)?;
        let provider = load_provider(&conn, &provider_id)?;
        let history = load_history(&conn, &conversation_id)?;
        (provider.0, provider.1, history)
    };

    let mut rx = match stream_chat(&base_url, &api_key, &model, history, None).await {
        Ok(rx) => rx,
        Err(err) => {
            emit_error(&app, &conversation_id, err.clone());
            return Err(err);
        }
    };

    let mut full_content = String::new();
    while let Some(chunk) = rx.recv().await {
        if STOP_FLAG.load(Ordering::SeqCst) {
            break;
        }
        match chunk {
            Ok(text) => {
                full_content.push_str(&text);
                let _ = app.emit(
                    EVENT_CHUNK,
                    StreamChunkPayload {
                        conversation_id: conversation_id.clone(),
                        content: text,
                    },
                );
            }
            Err(err) => {
                emit_error(&app, &conversation_id, err);
                break;
            }
        }
    }

    // Persist the assistant turn and notify the frontend.
    let done_at = now_timestamp();
    let assistant_msg_id = {
        let conn = db.lock()?;
        insert_message(
            &conn,
            &conversation_id,
            "assistant",
            &full_content,
            &done_at,
        )?
    };

    let _ = app.emit(
        EVENT_DONE,
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
