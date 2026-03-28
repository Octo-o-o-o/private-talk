use crate::attachments::{self, PreparedAttachment};
use crate::context::compressor;
use crate::db::DbState;
use crate::llm::is_vision_model;
use crate::llm::provider::{chat_complete, stream_chat, StreamItem};
use crate::llm::types::{ChatContent, ChatContentPart, ChatMessage, ImageUrlDetail};
use base64::Engine;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, State};

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

fn delete_messages_from_connection(
    conn: &rusqlite::Connection,
    conversation_id: &str,
    message_id: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM messages
         WHERE conversation_id = ?1
           AND role != 'system'
           AND message_order >= (SELECT message_order FROM messages WHERE id = ?2)",
        rusqlite::params![conversation_id, message_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn get_first_user_message_content(
    conn: &rusqlite::Connection,
    conversation_id: &str,
) -> Result<String, String> {
    conn.query_row(
        "SELECT content FROM messages
         WHERE conversation_id = ?1 AND role = 'user'
         ORDER BY message_order ASC
         LIMIT 1",
        rusqlite::params![conversation_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| format!("No user message found: {}", e))
}

#[tauri::command]
pub async fn send_message(
    app: tauri::AppHandle,
    db: State<'_, DbState>,
    conversation_id: String,
    content: String,
    provider_id: String,
    model: String,
    user_msg_id: String,
    attachment_ids: Option<Vec<String>>,
) -> Result<(), String> {
    STOP_FLAG.store(false, Ordering::SeqCst);

    // Save user message (ID provided by frontend for consistency)
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    // Collect prepared attachments for this message
    let prepared_attachments: Vec<PreparedAttachment> = attachment_ids
        .as_ref()
        .map(|ids| {
            ids.iter()
                .filter_map(|id_json| serde_json::from_str::<PreparedAttachment>(id_json).ok())
                .collect()
        })
        .unwrap_or_default();
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, 'user', ?3, ?4)",
            rusqlite::params![user_msg_id, conversation_id, content, now],
        )
        .map_err(|e| e.to_string())?;

        // Link attachments to this message
        for att in &prepared_attachments {
            attachments::save_attachment(&conn, att, &user_msg_id)?;
        }

        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, conversation_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // Check for /img command — intercept before normal chat flow
    if content.starts_with("/img ") || content.starts_with("/img\n") || content == "/img" {
        return super::image_gen::handle_image_generation(
            app,
            &db,
            &conversation_id,
            &content,
            &user_msg_id,
            &prepared_attachments,
        )
        .await;
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
                covered_until_message_id: None,
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
                if let Some(ref boundary_id) = compression_input.covered_until_message_id {
                    let conn = db.0.lock().map_err(|e| e.to_string())?;
                    if let Err(e) =
                        compressor::save_summary(&conn, &conversation_id, &summary, boundary_id)
                    {
                        eprintln!("Failed to save summary: {}", e);
                    }
                }
            }
            Err(e) => eprintln!("Context compression failed (non-blocking): {}", e),
        }
    }

    // Build context using compressor (respects hot_size, pinned, summaries)
    let mut messages = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        compressor::build_context(&conn, &conversation_id)?
    };

    // Inject attachment content into the last user message (current message)
    if !prepared_attachments.is_empty() {
        if let Some(last_user) = messages.iter_mut().rev().find(|m| m.role == "user") {
            let text = last_user.content.as_text().to_string();
            let mut parts: Vec<ChatContentPart> = vec![ChatContentPart::Text { text }];

            for att in &prepared_attachments {
                match att.file_type.as_str() {
                    "image" => {
                        if let Ok((b64, mime)) = attachments::read_image_as_base64(&att.file_path) {
                            parts.push(ChatContentPart::ImageUrl {
                                image_url: ImageUrlDetail {
                                    url: format!("data:{};base64,{}", mime, b64),
                                    detail: Some("auto".to_string()),
                                },
                            });
                        }
                    }
                    "text_file" => {
                        if let Ok(file_content) =
                            attachments::read_text_file_content(&att.file_path)
                        {
                            parts.push(ChatContentPart::Text {
                                text: format!(
                                    "--- File: {} ---\n{}\n--- End of file ---",
                                    att.file_name, file_content
                                ),
                            });
                        }
                    }
                    "pdf" => {
                        // Read raw bytes once; reuse for both vision base64 and text extraction
                        let raw_bytes = std::fs::read(&att.file_path).ok();

                        if is_vision_model(&model) {
                            if let Some(ref data) = raw_bytes {
                                let b64 = base64::engine::general_purpose::STANDARD.encode(data);
                                parts.push(ChatContentPart::ImageUrl {
                                    image_url: ImageUrlDetail {
                                        url: format!(
                                            "data:application/pdf;base64,{}",
                                            b64
                                        ),
                                        detail: None,
                                    },
                                });
                            }
                        }
                        if let Ok(text) = attachments::read_pdf_text_content(&att.file_path, raw_bytes.as_deref()) {
                            let trimmed = text.trim();
                            if !trimmed.is_empty() {
                                parts.push(ChatContentPart::Text {
                                    text: format!(
                                        "--- PDF: {} ---\n{}\n--- End of PDF ---",
                                        att.file_name, trimmed
                                    ),
                                });
                            }
                        }
                    }
                    _ => {}
                }
            }

            last_user.content = ChatContent::Multipart(parts);
        }
    }

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
    delete_messages_from_connection(&conn, &conversation_id, &message_id)
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
        get_first_user_message_content(&conn, &conversation_id)?
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
            content: ChatContent::text("Generate a short title (max 20 characters) for a conversation based on the user's first message. Return ONLY the title text, no quotes, no punctuation at the end. Use the same language as the user's message."),
        },
        ChatMessage {
            role: "user".to_string(),
            content: ChatContent::text(first_message),
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

#[cfg(test)]
mod tests {
    use super::{delete_messages_from_connection, get_first_user_message_content};
    use rusqlite::Connection;

    #[test]
    fn delete_messages_from_uses_message_order_boundary() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_db(&conn).unwrap();

        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('conv1', 'Test', '2024-01-01 00:00:00', '2024-01-01 00:00:00')",
            [],
        )
        .unwrap();

        for (id, role, content) in [
            ("msg1", "user", "first"),
            ("msg2", "assistant", "second"),
            ("msg3", "user", "third"),
        ] {
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, 'conv1', ?2, ?3, '2024-01-01 00:00:00')",
                rusqlite::params![id, role, content],
            )
            .unwrap();
        }

        delete_messages_from_connection(&conn, "conv1", "msg2").unwrap();

        let remaining_ids: Vec<String> = conn
            .prepare("SELECT id FROM messages WHERE conversation_id = 'conv1' ORDER BY message_order ASC")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(remaining_ids, vec!["msg1"]);
    }

    #[test]
    fn first_user_message_prefers_stable_message_order() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_db(&conn).unwrap();

        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('conv1', 'Test', '2024-01-01 00:00:00', '2024-01-01 00:00:00')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('msg1', 'conv1', 'user', 'first user', '2024-01-01 00:00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('msg2', 'conv1', 'assistant', 'assistant', '2024-01-01 00:00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('msg3', 'conv1', 'user', 'second user', '2024-01-01 00:00:00')",
            [],
        )
        .unwrap();

        let first_user = get_first_user_message_content(&conn, "conv1").unwrap();
        assert_eq!(first_user, "first user");
    }
}

/// Prepare file attachments: copy/compress to app data, return metadata.
/// Called from frontend before sending a message.
#[tauri::command]
pub async fn prepare_attachments(
    app: tauri::AppHandle,
    file_paths: Vec<String>,
) -> Result<Vec<String>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut results = Vec::new();
        for path_str in &file_paths {
            let path = Path::new(path_str);
            let prepared = attachments::prepare_attachment(&app_data_dir, path)?;
            let json = serde_json::to_string(&prepared).map_err(|e| e.to_string())?;
            results.push(json);
        }
        Ok(results)
    })
    .await
    .map_err(|e| format!("Attachment preparation task failed: {}", e))?
}

/// Prepare an image from base64 data (e.g., clipboard paste).
#[tauri::command]
pub async fn prepare_image_attachment(
    app: tauri::AppHandle,
    image_base64: String,
    mime_type: String,
) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &image_base64)
        .map_err(|e| format!("Invalid base64: {}", e))?;

    tauri::async_runtime::spawn_blocking(move || {
        let prepared = attachments::prepare_image_from_bytes(&app_data_dir, &data, &mime_type)?;
        serde_json::to_string(&prepared).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Image preparation task failed: {}", e))?
}

/// Prepare an audio attachment from base64 data (e.g., recorded voice message).
#[tauri::command]
pub async fn prepare_audio_attachment(
    app: tauri::AppHandle,
    audio_base64: String,
    mime_type: String,
) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &audio_base64)
        .map_err(|e| format!("Invalid base64: {}", e))?;

    tauri::async_runtime::spawn_blocking(move || {
        let prepared = attachments::prepare_audio_from_bytes(&app_data_dir, &data, &mime_type)?;
        serde_json::to_string(&prepared).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Audio preparation task failed: {}", e))?
}

/// Prepare a PDF attachment: save original and extract text into a companion file.
#[tauri::command]
pub async fn prepare_pdf_attachment(
    app: tauri::AppHandle,
    pdf_base64: String,
    file_name: String,
) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &pdf_base64)
        .map_err(|e| format!("Invalid base64: {}", e))?;

    tauri::async_runtime::spawn_blocking(move || {
        let prepared = attachments::prepare_pdf_from_bytes(&app_data_dir, &data, &file_name)?;
        serde_json::to_string(&prepared).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("PDF preparation task failed: {}", e))?
}

/// Prepare a text file attachment from raw content (uploaded via FileReader).
#[tauri::command]
pub async fn prepare_text_attachment(
    app: tauri::AppHandle,
    file_name: String,
    content: String,
    mime_type: String,
) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    tauri::async_runtime::spawn_blocking(move || {
        let now = chrono::Utc::now();
        let month_dir = app_data_dir
            .join("attachments")
            .join(now.format("%Y-%m").to_string());
        std::fs::create_dir_all(&month_dir)
            .map_err(|e| format!("Failed to create attachments dir: {}", e))?;

        let ext = std::path::Path::new(&file_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("txt");
        let dest = month_dir.join(format!("{}.{}", uuid::Uuid::new_v4(), ext));
        std::fs::write(&dest, &content).map_err(|e| format!("Failed to write text file: {}", e))?;

        let prepared = attachments::PreparedAttachment {
            id: uuid::Uuid::new_v4().to_string(),
            file_type: "text_file".to_string(),
            file_name,
            file_path: dest.to_string_lossy().to_string(),
            mime_type,
            file_size: content.len() as i64,
        };
        serde_json::to_string(&prepared).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Text attachment preparation task failed: {}", e))?
}
