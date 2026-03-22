use crate::context::compressor;
use crate::db::DbState;
use crate::llm::provider::{chat_complete, stream_chat, StreamItem};
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

/// Save a usage record to the database
fn save_usage_record(
    conn: &rusqlite::Connection,
    conversation_id: &str,
    message_id: &str,
    model: &str,
    prompt_tokens: i64,
    completion_tokens: i64,
    total_tokens: i64,
) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO usage_records (id, conversation_id, message_id, model, prompt_tokens, completion_tokens, total_tokens, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, conversation_id, message_id, model, prompt_tokens, completion_tokens, total_tokens, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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

        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, conversation_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // Load provider info
    let (base_url, api_key) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT base_url, api_key FROM providers WHERE id = ?1",
            rusqlite::params![provider_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|e| format!("Provider not found: {}", e))?
    };

    // Try to compress old messages if over threshold
    // Step 1: Check if compression needed (sync, holds lock briefly)
    let compression_input = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        compressor::prepare_compression(&conn, &conversation_id).unwrap_or(
            compressor::CompressionInput {
                needs_compression: false,
                conversation_text: String::new(),
                conversation_id: conversation_id.clone(),
            },
        )
    };

    // Step 2: If needed, call LLM for summary (async, no lock)
    if compression_input.needs_compression {
        match compressor::generate_summary(
            &compression_input.conversation_text,
            &base_url,
            &api_key,
            &model,
        )
        .await
        {
            Ok(summary) => {
                // Step 3: Save summary back to DB (sync, brief lock)
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                if let Err(e) = compressor::save_summary(&conn, &conversation_id, &summary) {
                    eprintln!("Failed to save summary: {}", e);
                }
            }
            Err(e) => eprintln!("Context compression failed (non-blocking): {}", e),
        }
    }

    // Build context using compressor (respects hot_size, pinned, summaries)
    let messages = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        compressor::build_context(&conn, &conversation_id)?
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
    let mut had_error = false;
    let mut stream_usage: Option<crate::llm::types::Usage> = None;

    while let Some(chunk) = rx.recv().await {
        if STOP_FLAG.load(Ordering::SeqCst) {
            break;
        }
        match chunk {
            Ok(item) => match item {
                StreamItem::Content(text) => {
                    full_content.push_str(&text);
                    let _ = app_handle.emit(
                        "chat-stream-chunk",
                        StreamChunkPayload {
                            conversation_id: conv_id.clone(),
                            content: text,
                        },
                    );
                }
                StreamItem::Usage(usage) => {
                    stream_usage = Some(usage);
                }
            },
            Err(e) => {
                had_error = true;
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

    // Only save assistant message if we got content or no error
    if !had_error || !full_content.is_empty() {
        let assistant_msg_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, 'assistant', ?3, ?4)",
                rusqlite::params![assistant_msg_id, conversation_id, full_content, now],
            )
            .map_err(|e| e.to_string())?;

            // Save usage record if the API returned usage info
            if let Some(ref usage) = stream_usage {
                if let Err(e) = save_usage_record(
                    &conn,
                    &conversation_id,
                    &assistant_msg_id,
                    &model,
                    usage.prompt_tokens,
                    usage.completion_tokens,
                    usage.total_tokens,
                ) {
                    eprintln!("Failed to save usage record: {}", e);
                }
            }
        }

        let _ = app.emit(
            "chat-stream-done",
            StreamDonePayload {
                conversation_id,
                message_id: assistant_msg_id,
                full_content,
            },
        );
    }

    Ok(())
}

#[tauri::command]
pub fn stop_generation() -> Result<(), String> {
    STOP_FLAG.store(true, Ordering::SeqCst);
    Ok(())
}

/// Get context usage stats for a conversation
#[tauri::command]
pub fn get_context_stats(
    db: State<DbState>,
    conversation_id: String,
) -> Result<compressor::ContextStats, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    compressor::get_context_stats(&conn, &conversation_id)
}

/// Toggle pin status of a message
#[tauri::command]
pub fn toggle_pin_message(db: State<DbState>, message_id: String) -> Result<bool, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let current: i32 = conn
        .query_row(
            "SELECT is_pinned FROM messages WHERE id = ?1",
            rusqlite::params![message_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Message not found: {}", e))?;

    let new_val = if current == 0 { 1 } else { 0 };
    conn.execute(
        "UPDATE messages SET is_pinned = ?1 WHERE id = ?2",
        rusqlite::params![new_val, message_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(new_val != 0)
}

/// Delete a message and all messages after it in the same conversation (keeps system messages)
#[tauri::command]
pub fn delete_messages_from(
    db: State<DbState>,
    conversation_id: String,
    message_id: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1 AND role != 'system' AND created_at >= (SELECT created_at FROM messages WHERE id = ?2)",
        rusqlite::params![conversation_id, message_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Update the content of a message
#[tauri::command]
pub fn update_message_content(
    db: State<DbState>,
    message_id: String,
    content: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE messages SET content = ?1 WHERE id = ?2",
        rusqlite::params![content, message_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Generate a short title for a conversation based on the first user message
#[tauri::command]
pub async fn generate_title(
    db: State<'_, DbState>,
    conversation_id: String,
    provider_id: String,
    model: String,
) -> Result<String, String> {
    // Get first user message
    let first_message = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT content FROM messages WHERE conversation_id = ?1 AND role = 'user' ORDER BY created_at ASC LIMIT 1",
            rusqlite::params![conversation_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| format!("No user message found: {}", e))?
    };

    // Load provider info
    let (base_url, api_key) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT base_url, api_key FROM providers WHERE id = ?1",
            rusqlite::params![provider_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|e| format!("Provider not found: {}", e))?
    };

    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: "Generate a short title (max 20 characters) for a conversation based on the user's first message. Return ONLY the title text, no quotes, no punctuation at the end. Use the same language as the user's message.".to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: first_message,
        },
    ];

    let title = chat_complete(&base_url, &api_key, &model, messages).await?;
    let title = title
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string();

    // Save title to DB
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE conversations SET title = ?1 WHERE id = ?2",
            rusqlite::params![title, conversation_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(title)
}
