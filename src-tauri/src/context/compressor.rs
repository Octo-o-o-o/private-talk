use crate::llm::provider::stream_chat;
use crate::llm::types::ChatMessage;
use rusqlite::Connection;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ContextStats {
    pub total_messages: usize,
    pub max_messages: usize,
    pub usage_percent: f64,
}

/// Load context settings from the database.
fn get_settings(conn: &Connection) -> (usize, usize) {
    let hot_size: usize = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'context_hot_size'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(20);

    let max_messages: usize = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'context_max_messages'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(50);

    (hot_size, max_messages)
}

/// Get context usage statistics for a conversation.
pub fn get_context_stats(conn: &Connection, conversation_id: &str) -> Result<ContextStats, String> {
    let (_, max_messages) = get_settings(conn);

    let total: usize = conn
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1",
            rusqlite::params![conversation_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let usage_percent = if max_messages > 0 {
        (total as f64 / max_messages as f64 * 100.0).min(100.0)
    } else {
        0.0
    };

    Ok(ContextStats {
        total_messages: total,
        max_messages,
        usage_percent,
    })
}

/// Build the context to send to the LLM.
/// Keeps system messages at the front, pinned messages always included,
/// and only the most recent hot_size regular messages.
pub fn build_context(conn: &Connection, conversation_id: &str) -> Result<Vec<ChatMessage>, String> {
    let (hot_size, max_messages) = get_settings(conn);

    let mut stmt = conn
        .prepare(
            "SELECT role, content, is_pinned FROM messages
             WHERE conversation_id = ?1
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let all_messages: Vec<(String, String, bool)> = stmt
        .query_map(rusqlite::params![conversation_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i32>(2)? != 0,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let total = all_messages.len();

    // Under limit — return everything
    if total <= max_messages {
        return Ok(all_messages
            .into_iter()
            .map(|(role, content, _)| ChatMessage { role, content })
            .collect());
    }

    // Split into system, pinned, and regular
    let mut system_msgs: Vec<ChatMessage> = Vec::new();
    let mut pinned_msgs: Vec<ChatMessage> = Vec::new();
    let mut regular_msgs: Vec<(String, String)> = Vec::new();

    for (role, content, is_pinned) in &all_messages {
        if role == "system" {
            system_msgs.push(ChatMessage {
                role: role.clone(),
                content: content.clone(),
            });
        } else if *is_pinned {
            pinned_msgs.push(ChatMessage {
                role: role.clone(),
                content: content.clone(),
            });
        } else {
            regular_msgs.push((role.clone(), content.clone()));
        }
    }

    // Keep most recent hot_size regular messages
    let hot_start = regular_msgs.len().saturating_sub(hot_size);
    let cold_messages = &regular_msgs[..hot_start];
    let hot_messages = &regular_msgs[hot_start..];

    let mut context: Vec<ChatMessage> = Vec::new();

    // 1. System messages
    context.extend(system_msgs);

    // 2. Include most recent summary from cold zone if exists
    if !cold_messages.is_empty() {
        for (role, content) in cold_messages.iter().rev() {
            if content.starts_with("[上下文摘要]") {
                context.push(ChatMessage {
                    role: role.clone(),
                    content: content.clone(),
                });
                break;
            }
        }
    }

    // 3. Pinned messages
    context.extend(pinned_msgs);

    // 4. Hot zone
    context.extend(hot_messages.iter().map(|(role, content)| ChatMessage {
        role: role.clone(),
        content: content.clone(),
    }));

    // Safety trim
    if context.len() > max_messages {
        let system_count = context.iter().take_while(|m| m.role == "system").count();
        let excess = context.len() - max_messages;
        let remove_start = system_count;
        let remove_end = (remove_start + excess).min(context.len());
        context.drain(remove_start..remove_end);
    }

    Ok(context)
}

/// Data needed to compress old messages (extracted from DB before async work).
pub struct CompressionInput {
    pub needs_compression: bool,
    pub conversation_text: String,
    #[allow(dead_code)]
    pub conversation_id: String,
}

/// Check if compression is needed and extract data (sync, holds conn).
pub fn prepare_compression(
    conn: &Connection,
    conversation_id: &str,
) -> Result<CompressionInput, String> {
    let (hot_size, max_messages) = get_settings(conn);

    let total: usize = conn
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1",
            rusqlite::params![conversation_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let threshold = (max_messages as f64 * 0.6) as usize;
    if total <= threshold {
        return Ok(CompressionInput {
            needs_compression: false,
            conversation_text: String::new(),
            conversation_id: conversation_id.to_string(),
        });
    }

    // Load non-system, non-pinned messages
    let mut stmt = conn
        .prepare(
            "SELECT role, content FROM messages
             WHERE conversation_id = ?1 AND role != 'system' AND is_pinned = 0
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let messages: Vec<(String, String)> = stmt
        .query_map(rusqlite::params![conversation_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    if messages.len() <= hot_size {
        return Ok(CompressionInput {
            needs_compression: false,
            conversation_text: String::new(),
            conversation_id: conversation_id.to_string(),
        });
    }

    let to_compress = &messages[..messages.len() - hot_size];

    if to_compress.is_empty()
        || to_compress
            .iter()
            .all(|(_, c)| c.starts_with("[上下文摘要]"))
    {
        return Ok(CompressionInput {
            needs_compression: false,
            conversation_text: String::new(),
            conversation_id: conversation_id.to_string(),
        });
    }

    let conversation_text = to_compress
        .iter()
        .filter(|(_, c)| !c.starts_with("[上下文摘要]"))
        .map(|(role, content)| format!("{}: {}", role, content))
        .collect::<Vec<_>>()
        .join("\n");

    Ok(CompressionInput {
        needs_compression: true,
        conversation_text,
        conversation_id: conversation_id.to_string(),
    })
}

/// Call LLM to generate summary (async, no conn needed).
pub async fn generate_summary(
    conversation_text: &str,
    base_url: &str,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    let compress_prompt = format!(
        "将以下对话压缩为要点摘要，保留关键事实、用户偏好和未完结的话题。用中文回复，简洁但完整：\n\n{}",
        conversation_text
    );

    let compress_messages = vec![ChatMessage {
        role: "user".to_string(),
        content: compress_prompt,
    }];

    let mut rx = stream_chat(base_url, api_key, model, compress_messages, Some(0.3))
        .await
        .map_err(|e| format!("Compression LLM call failed: {}", e))?;

    let mut summary = String::new();
    while let Some(chunk) = rx.recv().await {
        match chunk {
            Ok(crate::llm::provider::StreamItem::Content(text)) => summary.push_str(&text),
            Ok(crate::llm::provider::StreamItem::Usage(_)) => {} // ignore usage for compression
            Err(e) => return Err(format!("Compression stream error: {}", e)),
        }
    }

    if summary.trim().is_empty() {
        return Err("Empty summary from LLM".to_string());
    }

    Ok(format!("[上下文摘要] {}", summary.trim()))
}

/// Save summary to DB (sync, holds conn).
pub fn save_summary(
    conn: &Connection,
    conversation_id: &str,
    summary_content: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let summary_id = uuid::Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, is_pinned, created_at) VALUES (?1, ?2, 'system', ?3, 0, ?4)",
        rusqlite::params![summary_id, conversation_id, summary_content, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_context_stats() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_db(&conn).unwrap();

        conn.execute(
            "INSERT INTO conversations (id, title) VALUES ('conv1', 'Test')",
            [],
        )
        .unwrap();

        for i in 0..5 {
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content) VALUES (?1, 'conv1', 'user', ?2)",
                rusqlite::params![format!("msg{}", i), format!("Message {}", i)],
            )
            .unwrap();
        }

        let stats = get_context_stats(&conn, "conv1").unwrap();
        assert_eq!(stats.total_messages, 5);
        assert_eq!(stats.max_messages, 50);
        assert!((stats.usage_percent - 10.0).abs() < 0.01);
    }

    #[test]
    fn test_build_context_under_limit() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_db(&conn).unwrap();

        conn.execute(
            "INSERT INTO conversations (id, title) VALUES ('conv1', 'Test')",
            [],
        )
        .unwrap();

        for i in 0..5 {
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content) VALUES (?1, 'conv1', 'user', ?2)",
                rusqlite::params![format!("msg{}", i), format!("Message {}", i)],
            )
            .unwrap();
        }

        let context = build_context(&conn, "conv1").unwrap();
        assert_eq!(context.len(), 5);
    }

    #[test]
    fn test_build_context_preserves_system_and_pinned() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_db(&conn).unwrap();

        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('context_hot_size', '2')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('context_max_messages', '5')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO conversations (id, title) VALUES ('conv1', 'Test')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('sys1', 'conv1', 'system', 'You are helpful', '2024-01-01 00:00:00')",
            [],
        )
        .unwrap();

        for i in 0..10 {
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, 'conv1', 'user', ?2, ?3)",
                rusqlite::params![
                    format!("msg{}", i),
                    format!("Message {}", i),
                    format!("2024-01-01 00:{:02}:00", i + 1)
                ],
            )
            .unwrap();
        }

        conn.execute("UPDATE messages SET is_pinned = 1 WHERE id = 'msg3'", [])
            .unwrap();

        let context = build_context(&conn, "conv1").unwrap();

        // system + pinned(msg3) + hot(msg8, msg9) = 4
        assert!(context.len() <= 5);
        assert_eq!(context[0].role, "system");
        assert!(context.iter().any(|m| m.content == "Message 3"));
        assert!(context.iter().any(|m| m.content == "Message 9"));
    }

    #[test]
    fn test_prepare_compression_not_needed() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_db(&conn).unwrap();

        conn.execute(
            "INSERT INTO conversations (id, title) VALUES ('conv1', 'Test')",
            [],
        )
        .unwrap();

        for i in 0..5 {
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content) VALUES (?1, 'conv1', 'user', ?2)",
                rusqlite::params![format!("msg{}", i), format!("Message {}", i)],
            )
            .unwrap();
        }

        let input = prepare_compression(&conn, "conv1").unwrap();
        assert!(!input.needs_compression);
    }
}
