use crate::attachments::{self, AttachmentUpload, PreparedAttachment};
use crate::db::{collect_rows, now_timestamp, DbState};
use crate::llm::is_vision_model;
use crate::llm::provider::{stream_chat, StreamItem};
use crate::llm::types::{ChatContent, ChatContentPart, ChatMessage, ImageUrlDetail, Usage};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, State};

static STOP_FLAG: AtomicBool = AtomicBool::new(false);

const EVENT_CHUNK: &str = "chat-stream-chunk";
const EVENT_DONE: &str = "chat-stream-done";
const EVENT_ERROR: &str = "chat-stream-error";
const DEFAULT_ATTACHMENT_PROMPT: &str =
    "Please review the attached files and summarize the key information.";
const STREAM_CHUNK_EMIT_INTERVAL: Duration = Duration::from_millis(40);
const STREAM_CHUNK_EMIT_MIN_BYTES: usize = 128;

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
    id: &str,
    conversation_id: &str,
    role: &str,
    content: &str,
    raw_content: Option<&str>,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, raw_content, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            id,
            conversation_id,
            role,
            content,
            raw_content.unwrap_or(content),
            now
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn touch_conversation(conn: &Connection, conversation_id: &str, now: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![now, conversation_id],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn load_provider(conn: &Connection, provider_id: &str) -> Result<(String, String), String> {
    conn.query_row(
        "SELECT base_url, api_key FROM providers WHERE id = ?1",
        params![provider_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )
    .map_err(|error| format!("Provider not found: {error}"))
}

fn load_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn load_conversation_assistant_prompt(
    conn: &Connection,
    conversation_id: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT assistants.system_prompt
         FROM conversations
         LEFT JOIN assistants ON assistants.id = conversations.assistant_id
         WHERE conversations.id = ?1",
        params![conversation_id],
        |row| row.get::<_, Option<String>>(0),
    )
    .optional()
    .map_err(|error| error.to_string())
    .map(|value| value.flatten().map(|prompt| prompt.trim().to_string()))
}

fn context_message_limit(setting: Option<String>) -> usize {
    setting
        .as_deref()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(50)
}

fn assistant_preset_instruction(preset: &str) -> &'static str {
    match preset {
        "coder" => {
            "You are a senior software engineer. Give pragmatic, technically rigorous answers, point out risks clearly, and prefer concrete implementation details."
        }
        "writer" => {
            "You are a writing assistant. Improve clarity, structure, and tone while preserving the user's intent and keeping the response polished."
        }
        "translator" => {
            "You are a translation assistant. Preserve meaning, formatting, and terminology accurately, and avoid adding commentary unless the user asks for it."
        }
        "research" => {
            "You are a research assistant. Synthesize findings carefully, compare options, and call out assumptions, evidence quality, and tradeoffs."
        }
        _ => {
            "You are Private Talk, a clear, helpful, and concise assistant. Balance practicality with accuracy and keep responses grounded in the user's request."
        }
    }
}

fn language_instruction(language: &str) -> Option<&'static str> {
    match language {
        "zh-CN" => Some(
            "Default to Simplified Chinese unless the user explicitly asks for another language.",
        ),
        "en" => Some("Default to English unless the user explicitly asks for another language."),
        "ja" => Some("Default to Japanese unless the user explicitly asks for another language."),
        "ko" => Some("Default to Korean unless the user explicitly asks for another language."),
        _ => None,
    }
}

fn build_system_message(
    assistant_prompt: Option<String>,
    assistant_preset: Option<String>,
    reply_language: Option<String>,
    custom_prompt: Option<String>,
) -> Option<ChatMessage> {
    let mut instructions = Vec::new();

    if let Some(prompt) = assistant_prompt
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        instructions.push(prompt);
    } else {
        let preset = assistant_preset.unwrap_or_else(|| "default".to_string());
        let custom_prompt = custom_prompt.unwrap_or_default().trim().to_string();

        if preset != "default" {
            instructions.push(assistant_preset_instruction(&preset).to_string());
        }

        if !custom_prompt.is_empty() {
            instructions.push(format!("Additional instructions: {}", custom_prompt));
        }
    }

    if let Some(language) = reply_language.as_deref().and_then(language_instruction) {
        instructions.push(language.to_string());
    }

    if instructions.is_empty() {
        return None;
    }

    Some(ChatMessage {
        role: "system".to_string(),
        content: ChatContent::text(instructions.join("\n\n")),
    })
}

fn message_content_with_attachments(
    content: &str,
    attachments: &[PreparedAttachment],
    allow_inline_images: bool,
) -> ChatContent {
    if attachments.is_empty() {
        return ChatContent::text(content.trim().to_string());
    }

    let base = if content.trim().is_empty() {
        DEFAULT_ATTACHMENT_PROMPT.to_string()
    } else {
        content.trim().to_string()
    };
    let mut parts = vec![ChatContentPart::Text { text: base }];

    for attachment in attachments {
        match attachment.file_type.as_str() {
            "text_file" => {
                if let Ok(text) = attachments::read_text_file_content(&attachment.file_path) {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        parts.push(ChatContentPart::Text {
                            text: format!(
                                "--- File: {} ---\n{}\n--- End of file ---",
                                attachment.file_name, trimmed
                            ),
                        });
                    }
                }
            }
            "pdf" => {
                if let Ok(text) = attachments::read_pdf_text_content(&attachment.file_path) {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        parts.push(ChatContentPart::Text {
                            text: format!(
                                "--- PDF: {} ---\n{}\n--- End of PDF ---",
                                attachment.file_name, trimmed
                            ),
                        });
                    } else {
                        parts.push(ChatContentPart::Text {
                            text: format!(
                                "[PDF attachment: {} has no extractable text.]",
                                attachment.file_name
                            ),
                        });
                    }
                }
            }
            "image" => {
                if allow_inline_images {
                    if let Ok((base64, mime_type)) =
                        attachments::read_image_as_base64(&attachment.file_path)
                    {
                        parts.push(ChatContentPart::ImageUrl {
                            image_url: ImageUrlDetail {
                                url: format!("data:{};base64,{}", mime_type, base64),
                                detail: Some("auto".to_string()),
                            },
                        });
                        continue;
                    }
                }
                parts.push(ChatContentPart::Text {
                    text: format!(
                        "[Image attachment: {} ({})]",
                        attachment.file_name, attachment.mime_type
                    ),
                });
            }
            _ => {
                parts.push(ChatContentPart::Text {
                    text: format!(
                        "[Attached file: {} ({})]",
                        attachment.file_name, attachment.mime_type
                    ),
                });
            }
        }
    }

    ChatContent::Multipart(parts)
}

fn load_history(
    conn: &Connection,
    conversation_id: &str,
    model: &str,
    max_messages: usize,
) -> Result<Vec<ChatMessage>, String> {
    let messages = collect_rows(
        conn,
        "SELECT id, role, content
         FROM (
            SELECT rowid AS sort_rowid, id, role, content, created_at
            FROM messages
            WHERE conversation_id = ?1
            ORDER BY created_at DESC, rowid DESC
            LIMIT ?2
         )
         ORDER BY created_at ASC, sort_rowid ASC",
        params![conversation_id, max_messages],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        },
    )?;
    let message_ids = messages
        .iter()
        .map(|(id, _, _)| id.clone())
        .collect::<Vec<_>>();
    let attachment_rows = attachments::get_attachments_for_messages(conn, &message_ids)?;
    let mut grouped: HashMap<String, Vec<PreparedAttachment>> = HashMap::new();
    for attachment in attachment_rows {
        grouped
            .entry(attachment.message_id)
            .or_default()
            .push(PreparedAttachment {
                id: attachment.id,
                file_type: attachment.file_type,
                file_name: attachment.file_name,
                file_path: attachment.file_path,
                mime_type: attachment.mime_type,
                file_size: attachment.file_size,
            });
    }

    Ok(messages
        .into_iter()
        .map(|(id, role, content)| ChatMessage {
            role,
            content: message_content_with_attachments(
                &content,
                grouped.get(&id).map(Vec::as_slice).unwrap_or(&[]),
                is_vision_model(model),
            ),
        })
        .collect())
}

fn save_usage_record(
    conn: &Connection,
    conversation_id: &str,
    conversation_title: &str,
    request_preview: &str,
    model: &str,
    usage: &Usage,
) -> Result<(), String> {
    fn insert_usage_record(
        conn: &Connection,
        id: &str,
        conversation_id: &str,
        conversation_title: &str,
        request_preview: &str,
        model: &str,
        usage: &Usage,
    ) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO usage_records (
                id, conversation_id, conversation_title, request_preview, model,
                prompt_tokens, completion_tokens, total_tokens, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                conversation_id,
                conversation_title,
                request_preview,
                model,
                usage.prompt_tokens,
                usage.completion_tokens,
                usage.total_tokens,
                now_timestamp(),
            ],
        )?;
        Ok(())
    }

    fn should_retry_usage_record_insert(error: &rusqlite::Error) -> bool {
        let message = error.to_string();
        message.contains("usage_records")
            && (message.contains("conversation_title")
                || message.contains("no such table: usage_records"))
    }

    let id = uuid::Uuid::new_v4().to_string();

    match insert_usage_record(
        conn,
        &id,
        conversation_id,
        conversation_title,
        request_preview,
        model,
        usage,
    ) {
        Ok(()) => Ok(()),
        Err(error) if should_retry_usage_record_insert(&error) => {
            crate::db::schema::init_db(conn).map_err(|retry_error| retry_error.to_string())?;
            insert_usage_record(
                conn,
                &id,
                conversation_id,
                conversation_title,
                request_preview,
                model,
                usage,
            )
            .map_err(|retry_error| retry_error.to_string())
        }
        Err(error) => Err(error.to_string()),
    }
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

fn emit_chunk(app: &tauri::AppHandle, conversation_id: &str, content: String) {
    if content.is_empty() {
        return;
    }

    let _ = app.emit(
        EVENT_CHUNK,
        StreamChunkPayload {
            conversation_id: conversation_id.to_string(),
            content,
        },
    );
}

#[tauri::command]
pub async fn send_message(
    app: tauri::AppHandle,
    db: State<'_, DbState>,
    conversation_id: String,
    content: String,
    user_display_content: String,
    provider_id: String,
    model: String,
    user_message_id: String,
    attachments_upload: Option<Vec<AttachmentUpload>>,
) -> Result<(), String> {
    STOP_FLAG.store(false, Ordering::SeqCst);

    let now = now_timestamp();
    let uploads = attachments_upload.unwrap_or_default();
    let prepared_attachments = {
        let app_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        let mut prepared = Vec::new();
        for upload in &uploads {
            prepared.push(attachments::save_upload(&app_dir, upload)?);
        }
        prepared
    };

    let (
        base_url,
        api_key,
        mut history,
        conversation_title,
        conversation_assistant_prompt,
        assistant_preset,
        reply_language,
        custom_prompt,
    ) = {
        let conn = db.lock()?;
        insert_message(
            &conn,
            &user_message_id,
            &conversation_id,
            "user",
            &user_display_content,
            Some(&content),
            &now,
        )?;
        for attachment in &prepared_attachments {
            attachments::save_attachment(&conn, attachment, &user_message_id)?;
        }
        touch_conversation(&conn, &conversation_id, &now)?;

        let provider = load_provider(&conn, &provider_id)?;
        let title = conn
            .query_row(
                "SELECT title FROM conversations WHERE id = ?1",
                params![conversation_id.clone()],
                |row| row.get::<_, String>(0),
            )
            .unwrap_or_else(|_| "New Chat".to_string());
        let context_limit = context_message_limit(load_setting(&conn, "context_max_messages")?);
        let mut history = load_history(&conn, &conversation_id, &model, context_limit)?;
        let conversation_assistant_prompt =
            load_conversation_assistant_prompt(&conn, &conversation_id)?;
        if let Some(last_user) = history
            .iter_mut()
            .rev()
            .find(|message| message.role == "user")
        {
            last_user.content = message_content_with_attachments(
                &content,
                &prepared_attachments,
                is_vision_model(&model),
            );
        }
        let assistant_preset = load_setting(&conn, "assistant_preset")?;
        let reply_language = load_setting(&conn, "assistant_language")?;
        let custom_prompt = load_setting(&conn, "assistant_custom_prompt")?;
        (
            provider.0,
            provider.1,
            history,
            title,
            conversation_assistant_prompt,
            assistant_preset,
            reply_language,
            custom_prompt,
        )
    };

    if let Some(system_message) = build_system_message(
        conversation_assistant_prompt,
        assistant_preset,
        reply_language,
        custom_prompt,
    ) {
        history.insert(0, system_message);
    }

    let mut rx = match stream_chat(&base_url, &api_key, &model, history, None).await {
        Ok(receiver) => receiver,
        Err(error) => {
            emit_error(&app, &conversation_id, error.clone());
            return Err(error);
        }
    };

    let mut full_content = String::new();
    let mut pending_content = String::new();
    let mut last_chunk_emit = Instant::now();
    let mut final_usage: Option<Usage> = None;
    let mut had_error = false;

    while let Some(chunk) = rx.recv().await {
        if STOP_FLAG.load(Ordering::SeqCst) {
            break;
        }
        match chunk {
            Ok(StreamItem::Content(text)) => {
                full_content.push_str(&text);
                pending_content.push_str(&text);

                if pending_content.len() >= STREAM_CHUNK_EMIT_MIN_BYTES
                    || last_chunk_emit.elapsed() >= STREAM_CHUNK_EMIT_INTERVAL
                {
                    emit_chunk(&app, &conversation_id, std::mem::take(&mut pending_content));
                    last_chunk_emit = Instant::now();
                }
            }
            Ok(StreamItem::Usage(usage)) => {
                final_usage = Some(usage);
            }
            Err(error) => {
                had_error = true;
                emit_error(&app, &conversation_id, error);
                break;
            }
        }
    }

    emit_chunk(&app, &conversation_id, pending_content);

    if had_error && full_content.is_empty() {
        return Ok(());
    }

    let assistant_message_id = uuid::Uuid::new_v4().to_string();
    let done_at = now_timestamp();
    {
        let conn = db.lock()?;
        insert_message(
            &conn,
            &assistant_message_id,
            &conversation_id,
            "assistant",
            &full_content,
            None,
            &done_at,
        )?;
        touch_conversation(&conn, &conversation_id, &done_at)?;
        if let Some(usage) = final_usage.as_ref() {
            if let Err(error) = save_usage_record(
                &conn,
                &conversation_id,
                &conversation_title,
                &user_display_content,
                &model,
                usage,
            ) {
                eprintln!(
                    "failed to save usage record for conversation {}: {}",
                    conversation_id, error
                );
            }
        }
    }

    let _ = app.emit(
        EVENT_DONE,
        StreamDonePayload {
            conversation_id,
            message_id: assistant_message_id,
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

#[cfg(test)]
mod tests {
    use super::save_usage_record;
    use crate::llm::types::Usage;
    use rusqlite::{params, Connection};

    #[test]
    fn save_usage_record_repairs_legacy_schema_before_retrying() {
        let conn = Connection::open_in_memory().expect("in-memory db");

        conn.execute_batch(
            "
            CREATE TABLE conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT 'New Chat',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                deleted_at TEXT
            );

            CREATE TABLE usage_records (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                request_preview TEXT NOT NULL,
                model TEXT NOT NULL,
                prompt_tokens INTEGER NOT NULL DEFAULT 0,
                completion_tokens INTEGER NOT NULL DEFAULT 0,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            ",
        )
        .expect("legacy schema");
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?1, ?2, datetime('now'), datetime('now'))",
            params!["conv-1", "Recovered title"],
        )
        .expect("insert conversation");

        save_usage_record(
            &conn,
            "conv-1",
            "Recovered title",
            "hello world",
            "grok-4",
            &Usage {
                prompt_tokens: 10,
                completion_tokens: 20,
                total_tokens: 30,
            },
        )
        .expect("save usage record");

        let (title, preview): (String, String) = conn
            .query_row(
                "SELECT conversation_title, request_preview
                 FROM usage_records
                 WHERE request_preview = ?1
                 LIMIT 1",
                params!["hello world"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read usage record");

        assert_eq!(title, "Recovered title");
        assert_eq!(preview, "hello world");
    }
}
