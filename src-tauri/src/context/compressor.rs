use crate::llm::provider::stream_chat;
use crate::llm::types::{ChatContent, ChatMessage};
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
/// Summary from conversation_summaries table, pinned messages always included,
/// and only the most recent hot_size regular messages.
pub fn build_context(conn: &Connection, conversation_id: &str) -> Result<Vec<ChatMessage>, String> {
    let (hot_size, max_messages) = get_settings(conn);

    // Load real system messages (e.g. scenario prompts), excluding old summary artifacts
    let mut sys_stmt = conn
        .prepare(
            "SELECT role, content FROM messages
             WHERE conversation_id = ?1 AND role = 'system'
               AND content NOT LIKE '[上下文摘要]%'
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let system_msgs: Vec<ChatMessage> = sys_stmt
        .query_map(rusqlite::params![conversation_id], |row| {
            Ok(ChatMessage {
                role: row.get::<_, String>(0)?,
                content: ChatContent::text(row.get::<_, String>(1)?),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Load the latest summary from conversation_summaries table
    let summary_msg: Option<ChatMessage> = conn
        .query_row(
            "SELECT summary FROM conversation_summaries WHERE conversation_id = ?1",
            rusqlite::params![conversation_id],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .map(|s| ChatMessage {
            role: "system".to_string(),
            content: ChatContent::text(s),
        });

    // Load pinned messages
    let mut pin_stmt = conn
        .prepare(
            "SELECT role, content FROM messages
             WHERE conversation_id = ?1 AND role != 'system' AND is_pinned = 1
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let pinned_msgs: Vec<ChatMessage> = pin_stmt
        .query_map(rusqlite::params![conversation_id], |row| {
            Ok(ChatMessage {
                role: row.get::<_, String>(0)?,
                content: ChatContent::text(row.get::<_, String>(1)?),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Load regular (non-system, non-pinned) messages, take most recent hot_size
    let mut reg_stmt = conn
        .prepare(
            "SELECT role, content FROM messages
             WHERE conversation_id = ?1 AND role != 'system' AND is_pinned = 0
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let regular_msgs: Vec<(String, String)> = reg_stmt
        .query_map(rusqlite::params![conversation_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let total = system_msgs.len()
        + summary_msg.as_ref().map_or(0, |_| 1)
        + pinned_msgs.len()
        + regular_msgs.len();

    // Under limit — return everything in order
    if total <= max_messages {
        let mut context = system_msgs;
        if let Some(s) = summary_msg {
            context.push(s);
        }
        context.extend(pinned_msgs);
        context.extend(regular_msgs.into_iter().map(|(role, content)| ChatMessage {
            role,
            content: ChatContent::text(content),
        }));
        return Ok(context);
    }

    // Over limit — keep system + summary + pinned + most recent hot_size regular
    let hot_start = regular_msgs.len().saturating_sub(hot_size);
    let hot_messages = &regular_msgs[hot_start..];

    let mut context: Vec<ChatMessage> = Vec::new();
    context.extend(system_msgs);
    if let Some(s) = summary_msg {
        context.push(s);
    }
    context.extend(pinned_msgs);
    context.extend(hot_messages.iter().map(|(role, content)| ChatMessage {
        role: role.clone(),
        content: ChatContent::text(content),
    }));

    // Safety trim if still over (trim from after system+summary block)
    if context.len() > max_messages {
        let fixed_count = context.iter().take_while(|m| m.role == "system").count();
        let excess = context.len() - max_messages;
        let remove_start = fixed_count;
        let remove_end = (remove_start + excess).min(context.len());
        context.drain(remove_start..remove_end);
    }

    Ok(context)
}

/// Data needed to compress old messages (extracted from DB before async work).
pub struct CompressionInput {
    pub needs_compression: bool,
    pub conversation_text: String,
    pub conversation_id: String,
    /// ID of the last message included in the compressed text (boundary for next compression).
    pub covered_until_message_id: Option<String>,
}

/// Check if compression is needed and extract data (sync, holds conn).
/// Only compresses messages not yet covered by an existing summary.
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
            covered_until_message_id: None,
        });
    }

    // Find the boundary of the last summary (if any)
    let covered_until: Option<String> = conn
        .query_row(
            "SELECT covered_until_message_id FROM conversation_summaries WHERE conversation_id = ?1",
            rusqlite::params![conversation_id],
            |row| row.get(0),
        )
        .ok();

    // Load non-system, non-pinned messages that haven't been summarized yet
    let mut stmt = conn
        .prepare(
            "SELECT id, role, content FROM messages
             WHERE conversation_id = ?1 AND role != 'system' AND is_pinned = 0
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let all_msgs: Vec<(String, String, String)> = stmt
        .query_map(rusqlite::params![conversation_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Skip messages already covered by previous summary
    let uncovered_start = match &covered_until {
        Some(boundary_id) => {
            all_msgs
                .iter()
                .position(|(id, _, _)| id == boundary_id)
                .map(|pos| pos + 1)
                .unwrap_or(0)
        }
        None => 0,
    };

    let uncovered = &all_msgs[uncovered_start..];

    if uncovered.len() <= hot_size {
        return Ok(CompressionInput {
            needs_compression: false,
            conversation_text: String::new(),
            conversation_id: conversation_id.to_string(),
            covered_until_message_id: None,
        });
    }

    // Cold zone = uncovered messages minus hot_size recent ones
    let cold_end = uncovered.len() - hot_size;
    let to_compress = &uncovered[..cold_end];

    if to_compress.is_empty() {
        return Ok(CompressionInput {
            needs_compression: false,
            conversation_text: String::new(),
            conversation_id: conversation_id.to_string(),
            covered_until_message_id: None,
        });
    }

    let last_compressed_id = to_compress.last().map(|(id, _, _)| id.clone());

    let conversation_text = to_compress
        .iter()
        .map(|(_, role, content)| format!("{}: {}", role, content))
        .collect::<Vec<_>>()
        .join("\n");

    Ok(CompressionInput {
        needs_compression: true,
        conversation_text,
        conversation_id: conversation_id.to_string(),
        covered_until_message_id: last_compressed_id,
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
        content: ChatContent::text(compress_prompt),
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

/// Save summary to conversation_summaries table (UPSERT — one summary per conversation).
/// `covered_until_message_id` must be the ID of the last message that was compressed.
pub fn save_summary(
    conn: &Connection,
    conversation_id: &str,
    summary_content: &str,
    covered_until_message_id: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    conn.execute(
        "INSERT INTO conversation_summaries (conversation_id, summary, covered_until_message_id, created_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(conversation_id) DO UPDATE SET
           summary = excluded.summary,
           covered_until_message_id = excluded.covered_until_message_id,
           created_at = excluded.created_at",
        rusqlite::params![conversation_id, summary_content, covered_until_message_id, now],
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
        assert!(context.iter().any(|m| m.content.as_text() == "Message 3"));
        assert!(context.iter().any(|m| m.content.as_text() == "Message 9"));
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

    #[test]
    fn test_save_summary_upserts_not_accumulates() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_db(&conn).unwrap();

        conn.execute(
            "INSERT INTO conversations (id, title) VALUES ('conv1', 'Test')",
            [],
        )
        .unwrap();

        for i in 0..5 {
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, 'conv1', 'user', ?2, ?3)",
                rusqlite::params![format!("msg{}", i), format!("Message {}", i), format!("2024-01-01 00:{:02}:00", i)],
            )
            .unwrap();
        }

        // Save summary twice — should UPSERT, not create two rows
        save_summary(&conn, "conv1", "[上下文摘要] First summary", "msg3").unwrap();
        save_summary(&conn, "conv1", "[上下文摘要] Second summary", "msg4").unwrap();

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM conversation_summaries WHERE conversation_id = 'conv1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "Should have exactly one summary row, not accumulate");

        let summary: String = conn
            .query_row(
                "SELECT summary FROM conversation_summaries WHERE conversation_id = 'conv1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(summary.contains("Second"), "Should have the latest summary");
    }

    #[test]
    fn test_build_context_with_summary_table() {
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

        for i in 0..10 {
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, 'conv1', 'user', ?2, ?3)",
                rusqlite::params![format!("msg{}", i), format!("Message {}", i), format!("2024-01-01 00:{:02}:00", i + 1)],
            )
            .unwrap();
        }

        // Save a summary via the new table
        save_summary(&conn, "conv1", "[上下文摘要] Test summary", "msg7").unwrap();

        let context = build_context(&conn, "conv1").unwrap();

        // Should include: summary + hot(msg8, msg9) = 3
        assert!(context.len() <= 5);
        assert!(context.iter().any(|m| m.content.as_text().contains("Test summary")));
        assert!(context.iter().any(|m| m.content.as_text() == "Message 9"));

        // Should NOT have any old-style summary system messages in the context
        let summary_system_msgs: Vec<_> = context
            .iter()
            .filter(|m| m.role == "system" && m.content.as_text().starts_with("[上下文摘要]"))
            .collect();
        assert_eq!(summary_system_msgs.len(), 1, "Only one summary from the table");
    }

    #[test]
    fn test_prepare_compression_respects_coverage_boundary() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_db(&conn).unwrap();

        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('context_hot_size', '3')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('context_max_messages', '10')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO conversations (id, title) VALUES ('conv1', 'Test')",
            [],
        )
        .unwrap();

        for i in 0..8 {
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, 'conv1', 'user', ?2, ?3)",
                rusqlite::params![format!("msg{}", i), format!("Message {}", i), format!("2024-01-01 00:{:02}:00", i + 1)],
            )
            .unwrap();
        }

        // First compression should be needed (8 > 10*0.6=6)
        let input = prepare_compression(&conn, "conv1").unwrap();
        assert!(input.needs_compression);

        // Simulate saving summary covering up to msg4
        conn.execute(
            "INSERT INTO conversation_summaries (conversation_id, summary, covered_until_message_id)
             VALUES ('conv1', 'summary', 'msg4')",
            [],
        )
        .unwrap();

        // Now only uncovered messages (msg5,msg6,msg7) exist = 3, which equals hot_size
        // So no compression needed
        let input2 = prepare_compression(&conn, "conv1").unwrap();
        assert!(!input2.needs_compression, "Should not recompress already-covered messages");
    }
}
