use crate::db::{collect_rows, DbState};
use rusqlite::Connection;
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

fn get_usage_by_conversation_db(conn: &Connection) -> Result<Vec<ConversationUsage>, String> {
    let rows = collect_rows(
        conn,
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
        conn,
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
pub fn get_usage_by_conversation(db: State<'_, DbState>) -> Result<Vec<ConversationUsage>, String> {
    let conn = db.lock()?;
    crate::db::schema::init_db(&conn).map_err(|error| error.to_string())?;
    get_usage_by_conversation_db(&conn)
}

fn get_usage_by_date_db(conn: &Connection) -> Result<Vec<DailyUsage>, String> {
    let rows = collect_rows(
        conn,
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

#[tauri::command]
pub fn get_usage_by_date(db: State<'_, DbState>) -> Result<Vec<DailyUsage>, String> {
    let conn = db.lock()?;
    crate::db::schema::init_db(&conn).map_err(|error| error.to_string())?;
    get_usage_by_date_db(&conn)
}

#[cfg(test)]
mod tests {
    use super::{get_usage_by_conversation_db, get_usage_by_date_db};
    use crate::db::schema::init_db;
    use rusqlite::{params, Connection};

    fn fresh() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init_db(&c).unwrap();
        c
    }

    fn seed_conv(conn: &Connection, id: &str, title: &str, created_at: &str, deleted: bool) {
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?3, ?4)",
            params![id, title, created_at, deleted.then_some(created_at)],
        )
        .unwrap();
    }

    fn seed_msg(conn: &Connection, id: &str, conv_id: &str, role: &str, content: &str, created_at: &str) {
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, raw_content, created_at)
             VALUES (?1, ?2, ?3, ?4, ?4, ?5)",
            params![id, conv_id, role, content, created_at],
        )
        .unwrap();
    }

    fn seed_usage(
        conn: &Connection,
        id: &str,
        conv_id: &str,
        title: &str,
        preview: &str,
        model: &str,
        prompt_t: i64,
        completion_t: i64,
        created_at: &str,
    ) {
        conn.execute(
            "INSERT INTO usage_records
             (id, conversation_id, conversation_title, request_preview, model,
              prompt_tokens, completion_tokens, total_tokens, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                conv_id,
                title,
                preview,
                model,
                prompt_t,
                completion_t,
                prompt_t + completion_t,
                created_at
            ],
        )
        .unwrap();
    }

    // ---------- get_usage_by_conversation_db ----------

    #[test]
    fn aggregates_tokens_per_model_within_one_conversation() {
        let conn = fresh();
        seed_conv(&conn, "c", "T", "2026-05-17 10:00:00", false);
        seed_msg(&conn, "m1", "c", "user", "first", "2026-05-17 10:00:01");
        seed_usage(&conn, "u1", "c", "T", "first", "gpt-4o", 100, 50, "2026-05-17 10:00:01");
        seed_usage(&conn, "u2", "c", "T", "second", "gpt-4o", 30, 20, "2026-05-17 10:01:00");
        seed_usage(&conn, "u3", "c", "T", "third", "gpt-5", 10, 5, "2026-05-17 10:02:00");

        let rows = get_usage_by_conversation_db(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        let r = &rows[0];

        assert_eq!(r.conversation_id, "c");
        assert_eq!(r.total_requests, 3);
        assert_eq!(r.model_usages.len(), 2);

        // model_usages is sorted by total_tokens DESC: gpt-4o = 200 > gpt-5 = 15
        assert_eq!(r.model_usages[0].model, "gpt-4o");
        assert_eq!(r.model_usages[0].prompt_tokens, 130);
        assert_eq!(r.model_usages[0].completion_tokens, 70);
        assert_eq!(r.model_usages[0].total_tokens, 200);
        assert_eq!(r.model_usages[0].request_count, 2);

        assert_eq!(r.model_usages[1].model, "gpt-5");
        assert_eq!(r.model_usages[1].request_count, 1);
    }

    #[test]
    fn marks_conversations_as_deleted_when_deleted_at_is_set() {
        let conn = fresh();
        seed_conv(&conn, "alive", "T1", "2026-05-17 10:00:00", false);
        seed_conv(&conn, "gone", "T2", "2026-05-17 10:00:00", true);
        seed_usage(&conn, "u-alive", "alive", "T1", "hi", "m", 1, 1, "2026-05-17 10:00:01");
        seed_usage(&conn, "u-gone", "gone", "T2", "hi", "m", 1, 1, "2026-05-17 10:00:01");

        let rows = get_usage_by_conversation_db(&conn).unwrap();
        let alive = rows.iter().find(|r| r.conversation_id == "alive").unwrap();
        let gone = rows.iter().find(|r| r.conversation_id == "gone").unwrap();

        assert!(!alive.is_deleted);
        assert!(gone.is_deleted);
    }

    #[test]
    fn first_message_preview_prefers_earliest_user_message_content() {
        let conn = fresh();
        seed_conv(&conn, "c", "T", "2026-05-17 10:00:00", false);
        // Multiple user + assistant messages; first user message wins for preview.
        seed_msg(&conn, "ma1", "c", "assistant", "asst-noise", "2026-05-17 10:00:00");
        seed_msg(&conn, "mu1", "c", "user", "real first user msg", "2026-05-17 10:00:01");
        seed_msg(&conn, "mu2", "c", "user", "later user msg", "2026-05-17 10:00:02");
        seed_usage(&conn, "u1", "c", "T", "preview-ignored", "m", 1, 1, "2026-05-17 10:00:01");

        let rows = get_usage_by_conversation_db(&conn).unwrap();
        assert_eq!(rows[0].first_message_preview, "real first user msg");
    }

    #[test]
    fn first_message_preview_falls_back_to_earliest_usage_preview_when_no_user_messages() {
        let conn = fresh();
        seed_conv(&conn, "c", "T", "2026-05-17 10:00:00", false);
        // Only assistant messages → fallback to earliest usage_records.request_preview.
        seed_msg(&conn, "ma1", "c", "assistant", "asst-only", "2026-05-17 10:00:01");
        seed_usage(&conn, "u-late", "c", "T", "later usage preview", "m", 1, 1, "2026-05-17 10:00:05");
        seed_usage(&conn, "u-early", "c", "T", "EARLIEST USAGE PREVIEW", "m", 1, 1, "2026-05-17 10:00:02");

        let rows = get_usage_by_conversation_db(&conn).unwrap();
        assert_eq!(rows[0].first_message_preview, "EARLIEST USAGE PREVIEW");
    }

    #[test]
    fn rows_are_sorted_by_latest_usage_timestamp_desc() {
        let conn = fresh();
        seed_conv(&conn, "old", "Old", "2026-05-17 08:00:00", false);
        seed_conv(&conn, "new", "New", "2026-05-17 12:00:00", false);
        seed_usage(&conn, "u-old", "old", "Old", "x", "m", 1, 1, "2026-05-17 08:01:00");
        seed_usage(&conn, "u-new", "new", "New", "x", "m", 1, 1, "2026-05-17 12:01:00");

        let rows = get_usage_by_conversation_db(&conn).unwrap();
        assert_eq!(
            rows.iter().map(|r| r.conversation_id.clone()).collect::<Vec<_>>(),
            vec!["new", "old"],
        );
    }

    #[test]
    fn empty_db_returns_empty_vec() {
        let conn = fresh();
        let rows = get_usage_by_conversation_db(&conn).unwrap();
        assert!(rows.is_empty());
    }

    // ---------- get_usage_by_date_db ----------

    #[test]
    fn date_aggregation_groups_by_yyyy_mm_dd_prefix() {
        let conn = fresh();
        seed_conv(&conn, "c", "T", "2026-05-17 10:00:00", false);
        seed_usage(&conn, "u-morning", "c", "T", "x", "m1", 100, 50, "2026-05-17 09:00:00");
        seed_usage(&conn, "u-afternoon", "c", "T", "x", "m1", 30, 20, "2026-05-17 15:00:00");
        seed_usage(&conn, "u-other-day", "c", "T", "x", "m1", 1, 1, "2026-05-18 09:00:00");

        let rows = get_usage_by_date_db(&conn).unwrap();
        // Sorted by date DESC.
        assert_eq!(rows[0].date, "2026-05-18");
        assert_eq!(rows[1].date, "2026-05-17");

        let day_17 = &rows[1];
        assert_eq!(day_17.model_usages.len(), 1);
        assert_eq!(day_17.model_usages[0].prompt_tokens, 130);
        assert_eq!(day_17.model_usages[0].completion_tokens, 70);
        assert_eq!(day_17.model_usages[0].request_count, 2);
    }

    #[test]
    fn date_aggregation_counts_distinct_conversations_per_day() {
        let conn = fresh();
        seed_conv(&conn, "c1", "T1", "2026-05-17 10:00:00", false);
        seed_conv(&conn, "c2", "T2", "2026-05-17 10:00:00", false);
        seed_conv(&conn, "c3", "T3", "2026-05-17 10:00:00", false);

        // Three records but only two distinct conversations on day 2026-05-17.
        seed_usage(&conn, "u1", "c1", "T1", "x", "m", 1, 1, "2026-05-17 09:00:00");
        seed_usage(&conn, "u2", "c1", "T1", "x", "m", 1, 1, "2026-05-17 10:00:00");
        seed_usage(&conn, "u3", "c2", "T2", "x", "m", 1, 1, "2026-05-17 11:00:00");
        // c3 on a different day.
        seed_usage(&conn, "u4", "c3", "T3", "x", "m", 1, 1, "2026-05-18 09:00:00");

        let rows = get_usage_by_date_db(&conn).unwrap();
        let day_17 = rows.iter().find(|r| r.date == "2026-05-17").unwrap();
        let day_18 = rows.iter().find(|r| r.date == "2026-05-18").unwrap();
        assert_eq!(day_17.conversation_count, 2);
        assert_eq!(day_18.conversation_count, 1);
    }

    #[test]
    fn date_aggregation_model_usages_sorted_by_total_tokens_desc() {
        let conn = fresh();
        seed_conv(&conn, "c", "T", "2026-05-17 10:00:00", false);
        seed_usage(&conn, "u1", "c", "T", "x", "small-model", 5, 5, "2026-05-17 10:00:00");
        seed_usage(&conn, "u2", "c", "T", "x", "big-model", 500, 500, "2026-05-17 11:00:00");

        let rows = get_usage_by_date_db(&conn).unwrap();
        assert_eq!(rows[0].model_usages[0].model, "big-model");
        assert_eq!(rows[0].model_usages[1].model, "small-model");
    }
}
