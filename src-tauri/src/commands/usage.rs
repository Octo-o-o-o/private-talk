use crate::db::{collect_rows, DbState};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct ModelUsage {
    pub model: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub request_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConversationUsage {
    pub conversation_id: String,
    pub conversation_title: String,
    pub is_deleted: bool,
    pub first_message_preview: String,
    pub created_at: String,
    pub updated_at: String,
    pub latest_at: String,
    pub message_count: i64,
    pub total_requests: i64,
    pub model_usages: Vec<ModelUsage>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DailyUsage {
    pub date: String,
    pub conversation_count: i64,
    pub model_usages: Vec<ModelUsage>,
}

#[derive(Debug)]
struct UsageRow {
    conversation_id: String,
    conversation_title: String,
    request_preview: String,
    model: String,
    prompt_tokens: i64,
    completion_tokens: i64,
    total_tokens: i64,
    created_at: String,
}

#[derive(Debug)]
struct ConversationMetaRow {
    conversation_id: String,
    conversation_title: String,
    is_deleted: bool,
    first_message_preview: String,
    created_at: String,
    updated_at: String,
    message_count: i64,
}

#[tauri::command]
pub fn get_usage_by_conversation(db: State<'_, DbState>) -> Result<Vec<ConversationUsage>, String> {
    let conn = db.lock()?;
    crate::db::schema::init_db(&conn).map_err(|error| error.to_string())?;
    let rows = collect_rows(
        &conn,
        "SELECT conversation_id, conversation_title, request_preview, model, prompt_tokens, completion_tokens, total_tokens, created_at
         FROM usage_records
         ORDER BY created_at DESC",
        [],
        |row| {
            Ok(UsageRow {
                conversation_id: row.get(0)?,
                conversation_title: row.get(1)?,
                request_preview: row.get(2)?,
                model: row.get(3)?,
                prompt_tokens: row.get(4)?,
                completion_tokens: row.get(5)?,
                total_tokens: row.get(6)?,
                created_at: row.get(7)?,
            })
        },
    )?;
    let metadata = collect_rows(
        &conn,
        "SELECT
            conversations.id,
            conversations.title,
            COALESCE(
                (
                    SELECT content
                    FROM messages
                    WHERE conversation_id = conversations.id
                      AND role = 'user'
                    ORDER BY created_at ASC
                    LIMIT 1
                ),
                (
                    SELECT request_preview
                    FROM usage_records
                    WHERE conversation_id = conversations.id
                    ORDER BY created_at ASC
                    LIMIT 1
                ),
                ''
            ) AS first_message_preview,
            conversations.created_at,
            conversations.updated_at,
            (
                SELECT COUNT(*)
                FROM messages
                WHERE conversation_id = conversations.id
                  AND role != 'system'
            ) AS message_count
            ,
            conversations.deleted_at IS NOT NULL AS is_deleted
         FROM conversations
         WHERE EXISTS (
            SELECT 1
            FROM usage_records
            WHERE usage_records.conversation_id = conversations.id
         )",
        [],
        |row| {
            Ok(ConversationMetaRow {
                conversation_id: row.get(0)?,
                conversation_title: row.get(1)?,
                first_message_preview: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                message_count: row.get(5)?,
                is_deleted: row.get(6)?,
            })
        },
    )?
    .into_iter()
    .map(|row| (row.conversation_id.clone(), row))
    .collect::<HashMap<_, _>>();

    let mut grouped: HashMap<String, ConversationUsage> = HashMap::new();
    let mut models: HashMap<(String, String), ModelUsage> = HashMap::new();
    let mut earliest_previews: HashMap<String, (String, String)> = HashMap::new();

    for row in rows {
        earliest_previews
            .entry(row.conversation_id.clone())
            .and_modify(|(earliest_at, preview)| {
                if row.created_at < *earliest_at {
                    *earliest_at = row.created_at.clone();
                    *preview = row.request_preview.clone();
                }
            })
            .or_insert_with(|| (row.created_at.clone(), row.request_preview.clone()));

        let meta = metadata.get(&row.conversation_id);
        grouped
            .entry(row.conversation_id.clone())
            .and_modify(|entry| {
                if row.created_at > entry.latest_at {
                    entry.latest_at = row.created_at.clone();
                }
                if entry.conversation_title.is_empty() {
                    entry.conversation_title = meta
                        .map(|value| value.conversation_title.clone())
                        .unwrap_or_else(|| row.conversation_title.clone());
                }
                entry.total_requests += 1;
            })
            .or_insert_with(|| ConversationUsage {
                conversation_id: row.conversation_id.clone(),
                conversation_title: meta
                    .map(|value| value.conversation_title.clone())
                    .unwrap_or_else(|| row.conversation_title.clone()),
                is_deleted: meta.map(|value| value.is_deleted).unwrap_or(true),
                first_message_preview: meta
                    .map(|value| value.first_message_preview.clone())
                    .unwrap_or_default(),
                created_at: meta
                    .map(|value| value.created_at.clone())
                    .unwrap_or_else(|| row.created_at.clone()),
                updated_at: meta
                    .map(|value| value.updated_at.clone())
                    .unwrap_or_else(|| row.created_at.clone()),
                latest_at: row.created_at.clone(),
                message_count: meta.map(|value| value.message_count).unwrap_or(0),
                total_requests: 1,
                model_usages: vec![],
            });

        let model_key = (row.conversation_id.clone(), row.model.clone());
        models
            .entry(model_key)
            .and_modify(|entry| {
                entry.prompt_tokens += row.prompt_tokens;
                entry.completion_tokens += row.completion_tokens;
                entry.total_tokens += row.total_tokens;
                entry.request_count += 1;
            })
            .or_insert(ModelUsage {
                model: row.model,
                prompt_tokens: row.prompt_tokens,
                completion_tokens: row.completion_tokens,
                total_tokens: row.total_tokens,
                request_count: 1,
            });
    }

    for (conversation_id, (_, preview)) in earliest_previews {
        if let Some(conversation) = grouped.get_mut(&conversation_id) {
            if conversation.first_message_preview.is_empty() {
                conversation.first_message_preview = preview;
            }
        }
    }

    for ((conversation_id, _), usage) in models {
        if let Some(conversation) = grouped.get_mut(&conversation_id) {
            conversation.model_usages.push(usage);
        }
    }

    let mut result = grouped.into_values().collect::<Vec<_>>();
    result.sort_by(|left, right| right.latest_at.cmp(&left.latest_at));
    for conversation in &mut result {
        conversation
            .model_usages
            .sort_by(|left, right| right.total_tokens.cmp(&left.total_tokens));
    }
    Ok(result)
}

#[tauri::command]
pub fn get_usage_by_date(db: State<'_, DbState>) -> Result<Vec<DailyUsage>, String> {
    let conn = db.lock()?;
    crate::db::schema::init_db(&conn).map_err(|error| error.to_string())?;
    let rows = collect_rows(
        &conn,
        "SELECT substr(created_at, 1, 10), conversation_id, model, prompt_tokens, completion_tokens, total_tokens
         FROM usage_records
         ORDER BY created_at DESC",
        [],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
            ))
        },
    )?;

    let mut grouped: HashMap<String, DailyUsage> = HashMap::new();
    let mut day_conversations: HashMap<String, HashSet<String>> = HashMap::new();
    let mut models: HashMap<(String, String), ModelUsage> = HashMap::new();

    for (date, conversation_id, model, prompt_tokens, completion_tokens, total_tokens) in rows {
        grouped.entry(date.clone()).or_insert_with(|| DailyUsage {
            date: date.clone(),
            conversation_count: 0,
            model_usages: vec![],
        });

        day_conversations
            .entry(date.clone())
            .or_default()
            .insert(conversation_id);

        models
            .entry((date.clone(), model.clone()))
            .and_modify(|entry| {
                entry.prompt_tokens += prompt_tokens;
                entry.completion_tokens += completion_tokens;
                entry.total_tokens += total_tokens;
                entry.request_count += 1;
            })
            .or_insert(ModelUsage {
                model,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                request_count: 1,
            });
    }

    for (date, usage) in &mut grouped {
        usage.conversation_count = day_conversations
            .get(date)
            .map(|values| values.len() as i64)
            .unwrap_or(0);
    }

    for ((date, _), usage) in models {
        if let Some(day) = grouped.get_mut(&date) {
            day.model_usages.push(usage);
        }
    }

    let mut result = grouped.into_values().collect::<Vec<_>>();
    result.sort_by(|left, right| right.date.cmp(&left.date));
    for day in &mut result {
        day.model_usages
            .sort_by(|left, right| right.total_tokens.cmp(&left.total_tokens));
    }
    Ok(result)
}
