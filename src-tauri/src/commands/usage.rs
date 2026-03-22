use crate::db::DbState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct ConversationUsage {
    pub conversation_id: String,
    pub conversation_title: String,
    pub is_deleted: bool,
    pub first_message_preview: String,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: i64,
    pub model_usages: Vec<ModelUsage>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelUsage {
    pub model: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub request_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DailyUsage {
    pub date: String,
    pub conversation_count: i64,
    pub model_usages: Vec<ModelUsage>,
}

/// Get usage stats grouped by conversation
#[tauri::command]
pub fn get_usage_by_conversation(db: State<DbState>) -> Result<Vec<ConversationUsage>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Get all conversations that have usage records
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT c.id, c.title, c.created_at, c.updated_at, c.deleted_at IS NOT NULL
             FROM conversations c
             INNER JOIN usage_records u ON u.conversation_id = c.id
             ORDER BY c.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let conversations: Vec<(String, String, String, String, bool)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, bool>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut results = Vec::new();

    for (conv_id, title, created_at, updated_at, is_deleted) in conversations {
        // Get first user message preview
        let first_msg: String = conn
            .query_row(
                "SELECT content FROM messages WHERE conversation_id = ?1 AND role = 'user' ORDER BY created_at ASC LIMIT 1",
                rusqlite::params![conv_id],
                |row| row.get(0),
            )
            .unwrap_or_default();
        let preview: String = first_msg.chars().take(80).collect();

        // Get message count (non-system)
        let message_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1 AND role != 'system'",
                rusqlite::params![conv_id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        // Get model usage breakdown
        let mut usage_stmt = conn
            .prepare(
                "SELECT model, SUM(prompt_tokens), SUM(completion_tokens), SUM(total_tokens), COUNT(*)
                 FROM usage_records WHERE conversation_id = ?1
                 GROUP BY model",
            )
            .map_err(|e| e.to_string())?;

        let model_usages: Vec<ModelUsage> = usage_stmt
            .query_map(rusqlite::params![conv_id], |row| {
                Ok(ModelUsage {
                    model: row.get(0)?,
                    prompt_tokens: row.get(1)?,
                    completion_tokens: row.get(2)?,
                    total_tokens: row.get(3)?,
                    request_count: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        results.push(ConversationUsage {
            conversation_id: conv_id,
            conversation_title: title,
            is_deleted,
            first_message_preview: preview,
            created_at,
            updated_at,
            message_count,
            model_usages,
        });
    }

    Ok(results)
}

/// Get usage stats grouped by date
#[tauri::command]
pub fn get_usage_by_date(db: State<DbState>) -> Result<Vec<DailyUsage>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Get distinct dates
    let mut date_stmt = conn
        .prepare(
            "SELECT DISTINCT date(created_at) as day
             FROM usage_records
             ORDER BY day DESC",
        )
        .map_err(|e| e.to_string())?;

    let dates: Vec<String> = date_stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut results = Vec::new();

    for date in dates {
        // Get conversation count for this date
        let conversation_count: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT conversation_id) FROM usage_records WHERE date(created_at) = ?1",
                rusqlite::params![date],
                |row| row.get(0),
            )
            .unwrap_or(0);

        // Get model usage breakdown for this date
        let mut usage_stmt = conn
            .prepare(
                "SELECT model, SUM(prompt_tokens), SUM(completion_tokens), SUM(total_tokens), COUNT(*)
                 FROM usage_records WHERE date(created_at) = ?1
                 GROUP BY model",
            )
            .map_err(|e| e.to_string())?;

        let model_usages: Vec<ModelUsage> = usage_stmt
            .query_map(rusqlite::params![date], |row| {
                Ok(ModelUsage {
                    model: row.get(0)?,
                    prompt_tokens: row.get(1)?,
                    completion_tokens: row.get(2)?,
                    total_tokens: row.get(3)?,
                    request_count: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        results.push(DailyUsage {
            date,
            conversation_count,
            model_usages,
        });
    }

    Ok(results)
}
