use rusqlite::{Connection, Result};

fn has_table(conn: &Connection, table: &str) -> Result<bool> {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        rusqlite::params![table],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count > 0)
}

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for name in names {
        if name? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn seed_assistant_presets(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        INSERT INTO assistants (id, name, description, system_prompt, icon, is_preset, created_at, updated_at)
        VALUES
            (
                'preset-default-assistant',
                'Balanced Assistant',
                'General-purpose replies with clear, practical tone.',
                'You are Private Talk, a clear, helpful, and concise assistant. Balance practicality with accuracy and keep responses grounded in the user''s request.',
                'sparkles',
                1,
                datetime('now'),
                datetime('now')
            ),
            (
                'preset-coding-assistant',
                'Coding Assistant',
                'Implementation-focused help for debugging, architecture, and code quality.',
                'You are a senior software engineer. Give pragmatic, technically rigorous answers, point out risks clearly, and prefer concrete implementation details.',
                'code',
                1,
                datetime('now'),
                datetime('now')
            ),
            (
                'preset-writing-assistant',
                'Writing Assistant',
                'Sharper structure, phrasing, and editing support for drafts.',
                'You are a writing assistant. Improve clarity, structure, and tone while preserving the user''s intent and keeping the response polished.',
                'pen',
                1,
                datetime('now'),
                datetime('now')
            ),
            (
                'preset-translator',
                'Translation Assistant',
                'Meaning-first translation with terminology and format preserved.',
                'You are a translation assistant. Preserve meaning, formatting, and terminology accurately, and avoid adding commentary unless the user asks for it.',
                'languages',
                1,
                datetime('now'),
                datetime('now')
            ),
            (
                'preset-research-assistant',
                'Research Assistant',
                'Tradeoff-aware synthesis for options, planning, and comparisons.',
                'You are a research assistant. Synthesize findings carefully, compare options, and call out assumptions, evidence quality, and tradeoffs.',
                'search',
                1,
                datetime('now'),
                datetime('now')
            )
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            system_prompt = excluded.system_prompt,
            icon = excluded.icon,
            is_preset = excluded.is_preset,
            updated_at = datetime('now');
        ",
    )?;

    Ok(())
}

fn migrate_old_scenarios(conn: &Connection) -> Result<()> {
    if !has_table(conn, "scenarios")? {
        return Ok(());
    }

    conn.execute_batch(
        "
        INSERT INTO assistants (id, name, description, system_prompt, icon, is_preset, created_at, updated_at)
        SELECT
            id,
            COALESCE(name, ''),
            COALESCE(description, ''),
            COALESCE(system_prompt, ''),
            COALESCE(icon, ''),
            COALESCE(is_preset, 0),
            COALESCE(created_at, datetime('now')),
            COALESCE(updated_at, datetime('now'))
        FROM scenarios
        WHERE NOT EXISTS (
            SELECT 1 FROM assistants WHERE assistants.id = scenarios.id
        );
        ",
    )?;

    Ok(())
}

fn migrate_usage_records(conn: &Connection) -> Result<()> {
    if !has_table(conn, "usage_records")? {
        return Ok(());
    }

    if !has_column(conn, "usage_records", "conversation_title")? {
        conn.execute_batch(
            "ALTER TABLE usage_records ADD COLUMN conversation_title TEXT NOT NULL DEFAULT '';",
        )?;
    }

    conn.execute_batch(
        "
        UPDATE usage_records
        SET conversation_title = COALESCE(
            NULLIF(TRIM(conversation_title), ''),
            (
                SELECT title
                FROM conversations
                WHERE conversations.id = usage_records.conversation_id
            ),
            'New Chat'
        )
        WHERE TRIM(COALESCE(conversation_title, '')) = '';
        ",
    )?;

    Ok(())
}

pub fn init_db(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT 'New Chat',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('system','user','assistant')),
            content TEXT NOT NULL,
            raw_content TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_messages_conversation
            ON messages(conversation_id, created_at);

        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            file_type TEXT NOT NULL,
            file_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            metadata TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_attachments_message
            ON attachments(message_id, created_at);

        CREATE TABLE IF NOT EXISTS usage_records (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            conversation_title TEXT NOT NULL,
            request_preview TEXT NOT NULL,
            model TEXT NOT NULL,
            prompt_tokens INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_usage_records_conversation
            ON usage_records(conversation_id, created_at);

        CREATE INDEX IF NOT EXISTS idx_usage_records_created_at
            ON usage_records(created_at);

        CREATE TABLE IF NOT EXISTS providers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            api_type TEXT NOT NULL DEFAULT 'openai-compatible',
            base_url TEXT NOT NULL,
            api_key TEXT NOT NULL,
            models TEXT NOT NULL DEFAULT '[]',
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS assistants (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            system_prompt TEXT NOT NULL DEFAULT '',
            icon TEXT NOT NULL DEFAULT '',
            is_preset INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_assistants_preset
            ON assistants(is_preset, created_at);

        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        ",
    )?;

    if !has_column(conn, "conversations", "assistant_id")? {
        conn.execute_batch("ALTER TABLE conversations ADD COLUMN assistant_id TEXT;")?;
    }

    if !has_column(conn, "conversations", "deleted_at")? {
        conn.execute_batch("ALTER TABLE conversations ADD COLUMN deleted_at TEXT;")?;
    }

    if !has_column(conn, "messages", "raw_content")? {
        conn.execute_batch(
            "ALTER TABLE messages ADD COLUMN raw_content TEXT NOT NULL DEFAULT '';
             UPDATE messages SET raw_content = content WHERE TRIM(raw_content) = '';",
        )?;
    } else {
        conn.execute_batch(
            "UPDATE messages SET raw_content = content WHERE TRIM(COALESCE(raw_content, '')) = '';",
        )?;
    }

    if has_column(conn, "conversations", "scenario_id")? {
        conn.execute_batch(
            "
            UPDATE conversations
            SET assistant_id = COALESCE(assistant_id, scenario_id)
            WHERE scenario_id IS NOT NULL;
            ",
        )?;
    }

    conn.execute_batch(
        "
        CREATE INDEX IF NOT EXISTS idx_conversations_assistant
            ON conversations(assistant_id, updated_at);
        ",
    )?;

    migrate_old_scenarios(conn)?;
    migrate_usage_records(conn)?;
    seed_assistant_presets(conn)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{has_column, has_table, init_db};
    use rusqlite::{params, Connection};

    fn table_count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |row| row.get(0)).expect("count query")
    }

    #[test]
    fn init_db_creates_all_tables_and_indexes_on_fresh_database() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        init_db(&conn).expect("init fresh db");

        for table in [
            "conversations",
            "messages",
            "attachments",
            "usage_records",
            "providers",
            "settings",
            "assistants",
        ] {
            assert!(
                has_table(&conn, table).expect("table lookup"),
                "missing table after init_db: {table}",
            );
        }

        for index in [
            "idx_messages_conversation",
            "idx_attachments_message",
            "idx_usage_records_conversation",
            "idx_usage_records_created_at",
            "idx_assistants_preset",
            "idx_conversations_assistant",
        ] {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1",
                    params![index],
                    |row| row.get(0),
                )
                .expect("index lookup");
            assert_eq!(exists, 1, "missing index after init_db: {index}");
        }

        let preset_count =
            table_count(&conn, "SELECT COUNT(*) FROM assistants WHERE is_preset = 1");
        assert_eq!(
            preset_count, 5,
            "expected 5 seeded preset assistants, got {preset_count}",
        );
    }

    #[test]
    fn init_db_is_idempotent_across_repeated_calls() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        init_db(&conn).expect("first init");
        init_db(&conn).expect("second init must not error");
        init_db(&conn).expect("third init must not error");

        let preset_count =
            table_count(&conn, "SELECT COUNT(*) FROM assistants WHERE is_preset = 1");
        assert_eq!(
            preset_count, 5,
            "preset assistants must not duplicate across init_db calls",
        );
    }

    #[test]
    fn init_db_backfills_usage_record_titles_for_legacy_databases() {
        let conn = Connection::open_in_memory().expect("in-memory db");

        conn.execute_batch(
            "
            CREATE TABLE conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT 'New Chat',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
            params!["conv-1", "Migrated conversation"],
        )
        .expect("insert conversation");
        conn.execute(
            "INSERT INTO usage_records (id, conversation_id, request_preview, model, prompt_tokens, completion_tokens, total_tokens, created_at)
             VALUES (?1, ?2, ?3, ?4, 12, 34, 46, datetime('now'))",
            params!["usage-1", "conv-1", "hello", "grok-4"],
        )
        .expect("insert legacy usage");

        init_db(&conn).expect("init db migrates usage table");

        assert!(
            has_column(&conn, "usage_records", "conversation_title").expect("column lookup"),
            "legacy usage_records table should gain conversation_title",
        );

        let title: String = conn
            .query_row(
                "SELECT conversation_title FROM usage_records WHERE id = ?1",
                params!["usage-1"],
                |row| row.get(0),
            )
            .expect("read migrated title");

        assert_eq!(title, "Migrated conversation");
    }

    #[test]
    fn init_db_backfills_message_raw_content_for_legacy_databases() {
        let conn = Connection::open_in_memory().expect("in-memory db");

        conn.execute_batch(
            "
            CREATE TABLE conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT 'New Chat',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            ",
        )
        .expect("legacy schema");

        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at)
             VALUES (?1, ?2, datetime('now'), datetime('now'))",
            params!["conv-1", "Legacy conversation"],
        )
        .expect("insert conversation");
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at)
             VALUES (?1, ?2, 'user', ?3, datetime('now'))",
            params!["msg-1", "conv-1", "legacy display content"],
        )
        .expect("insert message");

        init_db(&conn).expect("init db migrates messages table");

        assert!(
            has_column(&conn, "messages", "raw_content").expect("column lookup"),
            "legacy messages table should gain raw_content",
        );

        let raw_content: String = conn
            .query_row(
                "SELECT raw_content FROM messages WHERE id = ?1",
                params!["msg-1"],
                |row| row.get(0),
            )
            .expect("read migrated raw content");

        assert_eq!(raw_content, "legacy display content");
    }
}
