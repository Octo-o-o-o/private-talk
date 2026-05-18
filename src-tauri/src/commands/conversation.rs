use crate::db::{collect_rows, now_timestamp, DbState};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rusqlite::{params, Connection};
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
    pub raw_content: String,
    pub attachments: Vec<crate::attachments::Attachment>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct MessageResendPayload {
    pub message_id: String,
    pub raw_content: String,
    pub attachments_upload: Vec<crate::attachments::AttachmentUpload>,
}

#[derive(Debug)]
pub(crate) struct StoredMessage {
    pub(crate) id: String,
    pub(crate) content: String,
}

fn decode_local_image_uri(value: &str) -> Option<String> {
    let payload = value.strip_prefix("localb64://")?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    String::from_utf8(bytes).ok()
}

fn delete_generated_images_in_root(generated_root: &std::path::Path, messages: &[StoredMessage]) {
    for message in messages {
        let mut remaining = message.content.as_str();
        while let Some(offset) = remaining.find("localb64://") {
            let candidate = &remaining[offset..];
            let end = candidate
                .find(|ch: char| ch.is_whitespace() || matches!(ch, ')' | ']' | '"' | '\\'))
                .unwrap_or(candidate.len());
            let uri = &candidate[..end];
            if let Some(path) = decode_local_image_uri(uri) {
                let path_ref = std::path::Path::new(&path);
                if path_ref.starts_with(generated_root) {
                    let _ = std::fs::remove_file(path_ref);
                }
            }
            remaining = &candidate[end..];
        }
    }
}

fn delete_generated_images_for_messages(
    app: &tauri::AppHandle,
    messages: &[StoredMessage],
) -> Result<(), String> {
    let generated_root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("generated-images");

    delete_generated_images_in_root(&generated_root, messages);
    Ok(())
}

fn query_visible_conversations(conn: &Connection) -> Result<Vec<Conversation>, String> {
    collect_rows(
        conn,
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
pub fn list_conversations(db: State<DbState>) -> Result<Vec<Conversation>, String> {
    let conn = db.lock()?;
    query_visible_conversations(&conn)
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

fn update_conversation_assistant_db(
    conn: &Connection,
    id: String,
    assistant_id: Option<String>,
) -> Result<Conversation, String> {
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
            params![id.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| format!("Conversation not found: {error}"))?;

    let sent_message_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1 AND role != 'system'",
            params![id.as_str()],
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
        params![assistant_id, now, id.as_str()],
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
pub fn update_conversation_assistant(
    db: State<DbState>,
    id: String,
    assistant_id: Option<String>,
) -> Result<Conversation, String> {
    let conn = db.lock()?;
    update_conversation_assistant_db(&conn, id, assistant_id)
}

/// DB-only portion of `delete_conversation`. Soft-deletes the conversation,
/// hard-deletes its messages + attachments rows, and returns the attachments
/// whose backing files the caller still needs to remove from disk.
pub(crate) fn delete_conversation_db(
    conn: &Connection,
    id: &str,
) -> Result<Vec<crate::attachments::Attachment>, String> {
    let message_ids = collect_rows(
        conn,
        "SELECT id FROM messages WHERE conversation_id = ?1",
        params![id],
        |row| row.get::<_, String>(0),
    )?;
    let attachments = if message_ids.is_empty() {
        vec![]
    } else {
        let attachments = crate::attachments::get_attachments_for_messages(conn, &message_ids)?;
        conn.execute(
            "DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?1)",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        attachments
    };
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE conversations
         SET deleted_at = COALESCE(deleted_at, ?1)
         WHERE id = ?2",
        params![now_timestamp(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(attachments)
}

#[tauri::command]
pub fn delete_conversation(
    app: tauri::AppHandle,
    db: State<DbState>,
    id: String,
) -> Result<(), String> {
    let conn = db.lock()?;
    let attachments = delete_conversation_db(&conn, &id)?;
    crate::attachments::delete_attachment_files(&attachments);

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
    fn should_retry_usage_title_update(error: &rusqlite::Error) -> bool {
        let message = error.to_string();
        message.contains("usage_records")
            && (message.contains("conversation_title")
                || message.contains("no such table: usage_records"))
    }

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

    let sync_usage_titles = || {
        conn.execute(
            "UPDATE usage_records SET conversation_title = ?1 WHERE conversation_id = ?2",
            params![title.as_str(), id.as_str()],
        )
    };

    match sync_usage_titles() {
        Ok(_) => Ok(()),
        Err(error) if should_retry_usage_title_update(&error) => {
            crate::db::schema::init_db(&conn).map_err(|retry_error| retry_error.to_string())?;
            sync_usage_titles().map_err(|retry_error| retry_error.to_string())?;
            Ok(())
        }
        Err(error) => {
            eprintln!(
                "failed to sync usage record titles for conversation {}: {}",
                id, error
            );
            Ok(())
        }
    }
}

#[tauri::command]
pub fn get_messages(db: State<DbState>, conversation_id: String) -> Result<Vec<Message>, String> {
    let conn = db.lock()?;
    let mut messages = collect_rows(
        &conn,
        "SELECT id, conversation_id, role, content, raw_content, created_at FROM messages \
         WHERE conversation_id = ?1 AND role != 'system' ORDER BY created_at ASC, rowid ASC",
        params![conversation_id],
        |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                raw_content: row.get(4)?,
                attachments: vec![],
                created_at: row.get(5)?,
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

fn get_message_resend_payload_db(
    conn: &Connection,
    message_id: String,
) -> Result<MessageResendPayload, String> {
    let (role, content, raw_content): (String, String, String) = conn
        .query_row(
            "SELECT role, content, raw_content FROM messages WHERE id = ?1",
            params![message_id.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| format!("Message not found: {error}"))?;

    if role != "user" {
        return Err("Only user messages can be resent.".to_string());
    }

    let attachments_upload =
        crate::attachments::get_attachment_uploads_for_message(conn, &message_id)?;
    let raw_content = if raw_content.trim().is_empty() {
        content
    } else {
        raw_content
    };

    Ok(MessageResendPayload {
        message_id,
        raw_content,
        attachments_upload,
    })
}

#[tauri::command]
pub fn get_message_resend_payload(
    db: State<DbState>,
    message_id: String,
) -> Result<MessageResendPayload, String> {
    let conn = db.lock()?;
    get_message_resend_payload_db(&conn, message_id)
}

#[derive(Debug)]
pub(crate) struct TruncateCascade {
    pub messages_to_delete: Vec<StoredMessage>,
    pub deleted_attachments: Vec<crate::attachments::Attachment>,
}

/// DB-only portion of `truncate_conversation_from_message`. Identifies and
/// deletes the message tail (plus its attachments rows and usage records) and
/// updates the conversation's `updated_at`. Returns the messages and
/// attachments whose backing files the caller still needs to remove from disk.
pub(crate) fn truncate_db_cascade(
    conn: &Connection,
    message_id: &str,
) -> Result<TruncateCascade, String> {
    let (conversation_id, created_at, rowid): (String, String, i64) = conn
        .query_row(
            "SELECT conversation_id, created_at, rowid
             FROM messages
             WHERE id = ?1
               AND role != 'system'",
            params![message_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| format!("Message not found: {error}"))?;

    let messages_to_delete = collect_rows(
        conn,
        "SELECT id, content
         FROM messages
         WHERE conversation_id = ?1
           AND (created_at > ?2 OR (created_at = ?2 AND rowid >= ?3))
         ORDER BY created_at ASC, rowid ASC",
        params![conversation_id.as_str(), created_at.as_str(), rowid],
        |row| {
            Ok(StoredMessage {
                id: row.get(0)?,
                content: row.get(1)?,
            })
        },
    )?;

    if messages_to_delete.is_empty() {
        return Ok(TruncateCascade {
            messages_to_delete,
            deleted_attachments: vec![],
        });
    }

    let message_ids = messages_to_delete
        .iter()
        .map(|message| message.id.clone())
        .collect::<Vec<_>>();
    let deleted_attachments =
        crate::attachments::get_attachments_for_messages(conn, &message_ids)?;

    conn.execute(
        "DELETE FROM attachments
         WHERE message_id IN (
            SELECT id
            FROM messages
            WHERE conversation_id = ?1
              AND (created_at > ?2 OR (created_at = ?2 AND rowid >= ?3))
         )",
        params![conversation_id.as_str(), created_at.as_str(), rowid],
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "DELETE FROM messages
         WHERE conversation_id = ?1
           AND (created_at > ?2 OR (created_at = ?2 AND rowid >= ?3))",
        params![conversation_id.as_str(), created_at.as_str(), rowid],
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "DELETE FROM usage_records
         WHERE conversation_id = ?1
           AND created_at >= ?2",
        params![conversation_id.as_str(), created_at.as_str()],
    )
    .map_err(|error| error.to_string())?;

    let next_updated_at: String = conn
        .query_row(
            "SELECT COALESCE(
                (
                    SELECT created_at
                    FROM messages
                    WHERE conversation_id = ?1
                    ORDER BY created_at DESC, rowid DESC
                    LIMIT 1
                ),
                (
                    SELECT created_at
                    FROM conversations
                    WHERE id = ?1
                ),
                ?2
            )",
            params![conversation_id.as_str(), now_timestamp()],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![next_updated_at, conversation_id],
    )
    .map_err(|error| error.to_string())?;

    Ok(TruncateCascade {
        messages_to_delete,
        deleted_attachments,
    })
}

#[tauri::command]
pub fn truncate_conversation_from_message(
    app: tauri::AppHandle,
    db: State<DbState>,
    message_id: String,
) -> Result<(), String> {
    let conn = db.lock()?;
    let cascade = truncate_db_cascade(&conn, &message_id)?;

    if cascade.messages_to_delete.is_empty() {
        return Ok(());
    }

    crate::attachments::delete_attachment_files(&cascade.deleted_attachments);
    delete_generated_images_for_messages(&app, &cascade.messages_to_delete)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        decode_local_image_uri, delete_conversation_db, delete_generated_images_in_root,
        get_message_resend_payload_db, query_visible_conversations, truncate_db_cascade,
        update_conversation_assistant_db, StoredMessage,
    };
    use crate::db::schema::init_db;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use rusqlite::{params, Connection};
    use tempfile::TempDir;

    fn make_uri(path: &str) -> String {
        format!("localb64://{}", URL_SAFE_NO_PAD.encode(path.as_bytes()))
    }

    fn fresh_db() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        init_db(&conn).expect("init schema");
        conn
    }

    fn seed_conversation(conn: &Connection, id: &str, title: &str, updated_at: &str) {
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, title, updated_at, updated_at],
        )
        .expect("seed conversation");
    }

    fn seed_message(
        conn: &Connection,
        id: &str,
        conv_id: &str,
        role: &str,
        content: &str,
        created_at: &str,
    ) {
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, raw_content, created_at)
             VALUES (?1, ?2, ?3, ?4, ?4, ?5)",
            params![id, conv_id, role, content, created_at],
        )
        .expect("seed message");
    }

    fn seed_usage(conn: &Connection, id: &str, conv_id: &str, created_at: &str) {
        conn.execute(
            "INSERT INTO usage_records
             (id, conversation_id, conversation_title, request_preview, model,
              prompt_tokens, completion_tokens, total_tokens, created_at)
             VALUES (?1, ?2, 'title', 'preview', 'm', 1, 1, 2, ?3)",
            params![id, conv_id, created_at],
        )
        .expect("seed usage");
    }

    // ---------- query_visible_conversations ----------

    #[test]
    fn query_visible_conversations_excludes_soft_deleted() {
        let conn = fresh_db();
        seed_conversation(&conn, "live", "Live", "2026-05-17 12:00:00");
        seed_conversation(&conn, "gone", "Gone", "2026-05-17 11:00:00");
        conn.execute(
            "UPDATE conversations SET deleted_at = ?1 WHERE id = 'gone'",
            params!["2026-05-17 11:30:00"],
        )
        .expect("soft-delete");

        let rows = query_visible_conversations(&conn).expect("query");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "live");
    }

    #[test]
    fn query_visible_conversations_orders_by_updated_at_desc() {
        let conn = fresh_db();
        seed_conversation(&conn, "old", "Old", "2026-05-17 09:00:00");
        seed_conversation(&conn, "newest", "Newest", "2026-05-17 12:00:00");
        seed_conversation(&conn, "mid", "Mid", "2026-05-17 10:00:00");

        let rows = query_visible_conversations(&conn).expect("query");
        assert_eq!(
            rows.iter().map(|c| c.id.clone()).collect::<Vec<_>>(),
            vec!["newest", "mid", "old"],
        );
    }

    #[test]
    fn query_visible_conversations_preview_is_latest_non_system_message_content() {
        let conn = fresh_db();
        seed_conversation(&conn, "c", "Title", "2026-05-17 12:00:00");
        // System message should be ignored even if it is the most recent one.
        seed_message(&conn, "m-sys", "c", "system", "system prompt", "2026-05-17 12:00:05");
        seed_message(&conn, "m-user", "c", "user", "user one", "2026-05-17 12:00:01");
        seed_message(&conn, "m-asst", "c", "assistant", "assistant reply", "2026-05-17 12:00:02");

        let rows = query_visible_conversations(&conn).expect("query");
        assert_eq!(rows[0].preview, "assistant reply");
    }

    #[test]
    fn query_visible_conversations_preview_is_empty_string_when_no_messages() {
        let conn = fresh_db();
        seed_conversation(&conn, "c", "Title", "2026-05-17 12:00:00");

        let rows = query_visible_conversations(&conn).expect("query");
        assert_eq!(rows[0].preview, "");
    }

    // ---------- truncate_db_cascade ----------

    #[test]
    fn truncate_db_cascade_deletes_messages_at_and_after_target() {
        let conn = fresh_db();
        seed_conversation(&conn, "c", "T", "2026-05-17 12:00:00");
        seed_message(&conn, "m1", "c", "user", "first", "2026-05-17 12:00:01");
        seed_message(&conn, "m2", "c", "assistant", "second", "2026-05-17 12:00:02");
        seed_message(&conn, "m3", "c", "user", "third", "2026-05-17 12:00:03");
        seed_message(&conn, "m4", "c", "assistant", "fourth", "2026-05-17 12:00:04");

        let cascade = truncate_db_cascade(&conn, "m3").expect("cascade");
        assert_eq!(
            cascade
                .messages_to_delete
                .iter()
                .map(|m| m.id.clone())
                .collect::<Vec<_>>(),
            vec!["m3", "m4"],
        );

        // Surviving messages.
        let surviving: Vec<String> = conn
            .prepare("SELECT id FROM messages ORDER BY created_at ASC")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(surviving, vec!["m1", "m2"]);
    }

    #[test]
    fn truncate_db_cascade_uses_rowid_tiebreaker_for_same_timestamp() {
        // Two messages with identical created_at — rowid (insertion order)
        // breaks the tie; truncating from the SECOND must keep the first.
        let conn = fresh_db();
        seed_conversation(&conn, "c", "T", "2026-05-17 12:00:00");
        let ts = "2026-05-17 12:00:01";
        seed_message(&conn, "m-first", "c", "user", "alpha", ts);
        seed_message(&conn, "m-second", "c", "assistant", "beta", ts);

        let cascade = truncate_db_cascade(&conn, "m-second").expect("cascade");
        let deleted_ids: Vec<String> = cascade
            .messages_to_delete
            .iter()
            .map(|m| m.id.clone())
            .collect();
        assert_eq!(deleted_ids, vec!["m-second"]);

        let surviving: Vec<String> = conn
            .prepare("SELECT id FROM messages")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(surviving, vec!["m-first"]);
    }

    #[test]
    fn truncate_db_cascade_also_clears_usage_records_at_and_after_target() {
        let conn = fresh_db();
        seed_conversation(&conn, "c", "T", "2026-05-17 12:00:00");
        seed_message(&conn, "m1", "c", "user", "u1", "2026-05-17 12:00:01");
        seed_message(&conn, "m2", "c", "assistant", "a2", "2026-05-17 12:00:02");
        seed_usage(&conn, "u-early", "c", "2026-05-17 12:00:00");
        seed_usage(&conn, "u-on", "c", "2026-05-17 12:00:02");
        seed_usage(&conn, "u-after", "c", "2026-05-17 12:00:05");

        truncate_db_cascade(&conn, "m2").expect("cascade");

        let surviving_usage: Vec<String> = conn
            .prepare("SELECT id FROM usage_records ORDER BY created_at ASC")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        // Only the strictly earlier usage record survives (cascade uses `>=`).
        assert_eq!(surviving_usage, vec!["u-early"]);
    }

    #[test]
    fn truncate_db_cascade_resets_conversation_updated_at_to_previous_message() {
        let conn = fresh_db();
        seed_conversation(&conn, "c", "T", "2026-05-17 12:00:00");
        seed_message(&conn, "m1", "c", "user", "first", "2026-05-17 12:00:01");
        seed_message(&conn, "m2", "c", "assistant", "second", "2026-05-17 12:00:02");
        seed_message(&conn, "m3", "c", "user", "third", "2026-05-17 12:00:03");

        truncate_db_cascade(&conn, "m3").expect("cascade");

        let updated_at: String = conn
            .query_row(
                "SELECT updated_at FROM conversations WHERE id = 'c'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(updated_at, "2026-05-17 12:00:02");
    }

    #[test]
    fn truncate_db_cascade_errors_on_missing_message() {
        let conn = fresh_db();
        seed_conversation(&conn, "c", "T", "2026-05-17 12:00:00");

        let err = truncate_db_cascade(&conn, "ghost").expect_err("must error");
        assert!(err.contains("Message not found"));
    }

    #[test]
    fn truncate_db_cascade_refuses_to_target_a_system_message() {
        let conn = fresh_db();
        seed_conversation(&conn, "c", "T", "2026-05-17 12:00:00");
        seed_message(&conn, "m-sys", "c", "system", "sysprompt", "2026-05-17 12:00:01");

        let err = truncate_db_cascade(&conn, "m-sys").expect_err("must error");
        assert!(err.contains("Message not found"));
    }

    // ---------- update_conversation_assistant_db ----------

    #[test]
    fn update_conversation_assistant_rejects_when_user_messages_already_sent() {
        let conn = fresh_db();
        seed_conversation(&conn, "c", "T", "2026-05-17 12:00:00");
        seed_message(&conn, "m1", "c", "user", "hi", "2026-05-17 12:00:01");

        let err = update_conversation_assistant_db(&conn, "c".into(), Some("a-new".into()))
            .expect_err("must reject after user sent");
        assert!(err.contains("Cannot change assistant"));
    }

    #[test]
    fn update_conversation_assistant_allows_change_when_only_system_messages_exist() {
        // Per the SQL: WHERE role != 'system' — system messages should NOT
        // count against the "already sent" guard.
        let conn = fresh_db();
        seed_conversation(&conn, "c", "T", "2026-05-17 12:00:00");
        seed_message(
            &conn,
            "m-sys",
            "c",
            "system",
            "sysprompt",
            "2026-05-17 12:00:01",
        );

        let updated =
            update_conversation_assistant_db(&conn, "c".into(), Some("a-new".into())).unwrap();
        assert_eq!(updated.assistant_id.as_deref(), Some("a-new"));
    }

    #[test]
    fn update_conversation_assistant_returns_error_for_unknown_conversation() {
        let conn = fresh_db();
        let err = update_conversation_assistant_db(&conn, "ghost".into(), None)
            .expect_err("must error");
        assert!(err.contains("Conversation not found"));
    }

    #[test]
    fn update_conversation_assistant_refuses_soft_deleted_conversation() {
        let conn = fresh_db();
        seed_conversation(&conn, "c", "T", "2026-05-17 12:00:00");
        conn.execute(
            "UPDATE conversations SET deleted_at = ?1 WHERE id = 'c'",
            params!["2026-05-17 12:30:00"],
        )
        .unwrap();

        let err = update_conversation_assistant_db(&conn, "c".into(), Some("x".into()))
            .expect_err("soft-deleted conversation should be invisible");
        assert!(err.contains("Conversation not found"));
    }

    // ---------- delete_conversation_db ----------

    #[test]
    fn delete_conversation_soft_deletes_and_returns_attachments_for_disk_cleanup() {
        let conn = fresh_db();
        seed_conversation(&conn, "c", "T", "2026-05-17 12:00:00");
        seed_message(&conn, "m1", "c", "user", "hi", "2026-05-17 12:00:01");
        conn.execute(
            "INSERT INTO attachments (id, message_id, file_type, file_name, file_path, mime_type, file_size, created_at)
             VALUES ('att-1', 'm1', 'image', 'photo.png', '/tmp/photo.png', 'image/png', 9, datetime('now'))",
            [],
        )
        .unwrap();

        let to_delete = delete_conversation_db(&conn, "c").unwrap();

        assert_eq!(to_delete.len(), 1);
        assert_eq!(to_delete[0].file_path, "/tmp/photo.png");

        // Soft-delete sets deleted_at; conversation row stays.
        let deleted_at: Option<String> = conn
            .query_row(
                "SELECT deleted_at FROM conversations WHERE id = 'c'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(deleted_at.is_some());

        // Messages and attachment rows hard-deleted.
        let msg_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE conversation_id = 'c'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(msg_count, 0);
        let att_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM attachments", [], |row| row.get(0))
            .unwrap();
        assert_eq!(att_count, 0);

        // Subsequent list_visible should NOT show the soft-deleted convo.
        assert!(query_visible_conversations(&conn).unwrap().is_empty());
    }

    #[test]
    fn delete_conversation_with_no_messages_still_soft_deletes_and_returns_empty_attachments() {
        let conn = fresh_db();
        seed_conversation(&conn, "c", "T", "2026-05-17 12:00:00");

        let to_delete = delete_conversation_db(&conn, "c").unwrap();
        assert!(to_delete.is_empty());

        let deleted_at: Option<String> = conn
            .query_row(
                "SELECT deleted_at FROM conversations WHERE id = 'c'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(deleted_at.is_some());
    }

    #[test]
    fn delete_conversation_is_idempotent_keeping_original_deleted_at_timestamp() {
        let conn = fresh_db();
        seed_conversation(&conn, "c", "T", "2026-05-17 12:00:00");

        // First soft-delete.
        delete_conversation_db(&conn, "c").unwrap();
        let first_deleted_at: String = conn
            .query_row(
                "SELECT deleted_at FROM conversations WHERE id = 'c'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        // Second soft-delete must NOT overwrite the original deleted_at
        // (COALESCE keeps the first timestamp).
        delete_conversation_db(&conn, "c").unwrap();
        let second_deleted_at: String = conn
            .query_row(
                "SELECT deleted_at FROM conversations WHERE id = 'c'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(first_deleted_at, second_deleted_at);
    }

    // ---------- get_message_resend_payload_db ----------

    #[test]
    fn resend_payload_returns_raw_content_for_user_message() {
        let conn = fresh_db();
        seed_conversation(&conn, "c", "T", "2026-05-17 12:00:00");
        // Display content differs from raw (e.g. user typed bare prompt, display
        // wrapper added a prefix). Raw must be returned verbatim.
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, raw_content, created_at)
             VALUES ('m1', 'c', 'user', 'display text', 'real raw payload', '2026-05-17 12:00:01')",
            [],
        )
        .unwrap();

        let payload = get_message_resend_payload_db(&conn, "m1".into()).unwrap();
        assert_eq!(payload.message_id, "m1");
        assert_eq!(payload.raw_content, "real raw payload");
        assert!(payload.attachments_upload.is_empty());
    }

    #[test]
    fn resend_payload_falls_back_to_content_when_raw_content_is_blank() {
        let conn = fresh_db();
        seed_conversation(&conn, "c", "T", "2026-05-17 12:00:00");
        // Legacy row migrated from before raw_content existed: raw is "" but
        // content holds the original payload.
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, raw_content, created_at)
             VALUES ('m1', 'c', 'user', 'legacy content', '   ', '2026-05-17 12:00:01')",
            [],
        )
        .unwrap();

        let payload = get_message_resend_payload_db(&conn, "m1".into()).unwrap();
        assert_eq!(payload.raw_content, "legacy content");
    }

    #[test]
    fn resend_payload_rejects_assistant_message() {
        let conn = fresh_db();
        seed_conversation(&conn, "c", "T", "2026-05-17 12:00:00");
        seed_message(
            &conn,
            "m1",
            "c",
            "assistant",
            "model reply",
            "2026-05-17 12:00:01",
        );

        let err = get_message_resend_payload_db(&conn, "m1".into())
            .expect_err("assistant messages cannot be resent");
        assert!(err.contains("Only user messages"));
    }

    #[test]
    fn resend_payload_rejects_system_message() {
        let conn = fresh_db();
        seed_conversation(&conn, "c", "T", "2026-05-17 12:00:00");
        seed_message(&conn, "m-sys", "c", "system", "sys", "2026-05-17 12:00:01");

        let err = get_message_resend_payload_db(&conn, "m-sys".into())
            .expect_err("system messages cannot be resent");
        assert!(err.contains("Only user messages"));
    }

    #[test]
    fn resend_payload_errors_for_unknown_message_id() {
        let conn = fresh_db();
        let err = get_message_resend_payload_db(&conn, "ghost".into())
            .expect_err("must error on missing id");
        assert!(err.contains("Message not found"));
    }

    #[test]
    fn resend_payload_round_trips_attachments_via_base64() {
        let conn = fresh_db();
        seed_conversation(&conn, "c", "T", "2026-05-17 12:00:00");
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, raw_content, created_at)
             VALUES ('m1', 'c', 'user', 'display', 'raw', '2026-05-17 12:00:01')",
            [],
        )
        .unwrap();

        // Real file on disk so get_attachment_uploads_for_message can read it.
        let tmp = TempDir::new().unwrap();
        let attachment_path = tmp.path().join("doc.txt");
        let payload_bytes = b"hello attachment";
        std::fs::write(&attachment_path, payload_bytes).unwrap();

        conn.execute(
            "INSERT INTO attachments (id, message_id, file_type, file_name, file_path, mime_type, file_size, created_at)
             VALUES ('att-1', 'm1', 'text_file', 'doc.txt', ?1, 'text/plain', ?2, datetime('now'))",
            params![
                attachment_path.to_str().unwrap(),
                payload_bytes.len() as i64
            ],
        )
        .unwrap();

        let payload = get_message_resend_payload_db(&conn, "m1".into()).unwrap();
        assert_eq!(payload.attachments_upload.len(), 1);
        let att = &payload.attachments_upload[0];
        assert_eq!(att.file_name, "doc.txt");
        assert_eq!(att.mime_type, "text/plain");

        // Base64 must decode back to the original file bytes.
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&att.data_base64)
            .unwrap();
        assert_eq!(decoded, payload_bytes);
    }

    #[test]
    fn decode_local_image_uri_returns_none_for_non_localb64_prefix() {
        assert!(decode_local_image_uri("https://example.com/img.png").is_none());
        assert!(decode_local_image_uri("file:///etc/passwd").is_none());
        assert!(decode_local_image_uri("localb65://anything").is_none());
        assert!(decode_local_image_uri("").is_none());
    }

    #[test]
    fn decode_local_image_uri_returns_none_for_invalid_base64() {
        assert!(decode_local_image_uri("localb64://!!!not-base64!!!").is_none());
        // URL_SAFE_NO_PAD must not accept padded input.
        assert!(decode_local_image_uri("localb64://aGVsbG8=").is_none());
    }

    #[test]
    fn decode_local_image_uri_round_trips_valid_url_safe_no_pad() {
        let original = "/Users/x/.local/share/private-talk/generated-images/abc.png";
        let uri = make_uri(original);
        assert_eq!(decode_local_image_uri(&uri).as_deref(), Some(original));
    }

    #[test]
    fn delete_generated_images_in_root_removes_files_inside_root() {
        let tmp = TempDir::new().expect("temp dir");
        let root = tmp.path().join("generated-images");
        std::fs::create_dir_all(&root).expect("create root");
        let conv_dir = root.join("conv-1");
        std::fs::create_dir_all(&conv_dir).expect("create conv dir");

        let target = conv_dir.join("image-a.png");
        std::fs::write(&target, b"png-bytes").expect("write target");

        let uri = make_uri(target.to_str().unwrap());
        let messages = [StoredMessage {
            id: "msg-1".into(),
            content: format!("Generated 1 image(s).\n![Generated image 1]({uri})"),
        }];

        delete_generated_images_in_root(&root, &messages);

        assert!(!target.exists(), "file inside generated_root must be removed");
    }

    #[test]
    fn delete_generated_images_in_root_ignores_paths_outside_root() {
        let tmp = TempDir::new().expect("temp dir");
        let root = tmp.path().join("generated-images");
        let outside = tmp.path().join("unrelated").join("victim.txt");
        std::fs::create_dir_all(outside.parent().unwrap()).expect("create outside dir");
        std::fs::create_dir_all(&root).expect("create root");
        std::fs::write(&outside, b"do not touch").expect("write victim");

        // Attacker-controlled URI pointing outside generated_root.
        let uri = make_uri(outside.to_str().unwrap());
        let messages = [StoredMessage {
            id: "evil".into(),
            content: format!("see this ![x]({uri})"),
        }];

        delete_generated_images_in_root(&root, &messages);

        assert!(
            outside.exists(),
            "files outside generated_root must NOT be deleted (path-traversal guard)",
        );
    }

    #[test]
    fn delete_generated_images_in_root_handles_multiple_uris_in_one_message() {
        let tmp = TempDir::new().expect("temp dir");
        let root = tmp.path().join("generated-images").join("conv-1");
        std::fs::create_dir_all(&root).expect("create root");

        let a = root.join("a.png");
        let b = root.join("b.png");
        let c = root.join("c.png");
        for path in [&a, &b, &c] {
            std::fs::write(path, b"x").expect("write");
        }

        let content = format!(
            "first ![1]({}) middle ![2]({}) and \"quoted\" ![3]({})",
            make_uri(a.to_str().unwrap()),
            make_uri(b.to_str().unwrap()),
            make_uri(c.to_str().unwrap()),
        );

        delete_generated_images_in_root(
            &tmp.path().join("generated-images"),
            &[StoredMessage {
                id: "m".into(),
                content,
            }],
        );

        assert!(!a.exists());
        assert!(!b.exists());
        assert!(!c.exists());
    }

    #[test]
    fn delete_generated_images_in_root_is_silent_when_file_already_gone() {
        let tmp = TempDir::new().expect("temp dir");
        let root = tmp.path().join("generated-images");
        std::fs::create_dir_all(&root).expect("create root");

        let phantom = root.join("ghost.png"); // never created
        let uri = make_uri(phantom.to_str().unwrap());

        // Must not panic / error when the file doesn't exist.
        delete_generated_images_in_root(
            &root,
            &[StoredMessage {
                id: "m".into(),
                content: format!("![x]({uri})"),
            }],
        );
    }
}
