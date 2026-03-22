use rusqlite::{Connection, Result};

/// Get current schema version from PRAGMA user_version
fn get_schema_version(conn: &Connection) -> Result<i32> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
}

/// Set schema version
fn set_schema_version(conn: &Connection, version: i32) -> Result<()> {
    conn.execute_batch(&format!("PRAGMA user_version = {}", version))?;
    Ok(())
}

/// Seed preset scenarios (called in v2 migration and after reset)
pub fn seed_presets(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        INSERT OR IGNORE INTO scenarios (id, name, description, system_prompt, icon, is_preset)
        VALUES
            ('preset-emotional-bot', '情感机器人', '温暖的情感支持伙伴',
             '你是一个温暖、善解人意的情感支持机器人。你的目标是倾听用户的心声，给予共情和鼓励。你会用温和的语气回应，不评判、不说教。当用户表达负面情绪时，你首先表示理解和共鸣，然后温柔地提供支持和建议。',
             '', 1),
            ('preset-text-mud', '文字 MUD', '沉浸式文字冒险游戏',
             '你是一个文字冒险游戏的 DM（地下城主）。你负责构建一个引人入胜的奇幻世界，描述场景、NPC 和事件。玩家通过文字输入行动，你根据玩家的选择推进故事。保持叙事的一致性和沉浸感。每次回复包含：场景描述、可能的行动选项、当前状态（生命值、物品等）。',
             '', 1),
            ('preset-translator', '翻译助手', '专业多语言翻译',
             '你是一个专业翻译。用户发送任何语言的文本，你自动检测源语言并翻译为目标语言。如果用户发送中文，翻译为英文；如果用户发送英文或其他语言，翻译为中文。翻译要求：准确、自然、符合目标语言的表达习惯。如有专业术语，附加注释说明。',
             '', 1),
            ('preset-coding-assistant', '编程助手', '高级软件工程师',
             '你是一个高级软件工程师和编程助手。你精通多种编程语言和框架。回答编程问题时：1) 先理解问题本质 2) 给出清晰的代码示例 3) 解释关键逻辑 4) 指出潜在的坑和最佳实践。代码用 Markdown 代码块格式化，注释用中文。',
             '', 1),
            ('preset-writing-assistant', '写作助手', '专业写作顾问',
             '你是一个专业的写作助手。你可以帮助用户：1) 润色和改善文章的表达 2) 纠正语法和用词错误 3) 调整文章结构和逻辑 4) 根据要求撰写不同风格的文案。你会保持用户的原始意图，同时提升文字质量。对修改的地方，简要说明修改原因。',
             '', 1);
        ",
    )?;
    Ok(())
}

/// Seed preset voice profiles
pub fn seed_preset_voices(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        INSERT INTO voices (id, display_name, engine, engine_config, role_type, tags, is_preset)
        VALUES
            ('preset-voice-vivian', 'Vivian 中文女声', 'qwen3-tts',
             '{"endpoint":"http://127.0.0.1:8012","model":"mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit","voice":"Vivian","speed":1.16,"response_format":"mp3"}',
             'character', '["中文","女声","清晰","干练"]', 1),
            ('preset-voice-serena', 'Serena 中文女声', 'qwen3-tts',
             '{"endpoint":"http://127.0.0.1:8012","model":"mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit","voice":"Serena","speed":1.1,"response_format":"mp3"}',
             'character', '["中文","女声","温柔","陪伴"]', 1),
            ('preset-voice-narrator', '温暖叙述者', 'qwen3-tts',
             '{"endpoint":"http://127.0.0.1:8012","model":"mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit","voice":"Warm Chinese female narrator with clear articulation, steady energy, and a slightly brisk but still relaxed pace.","speed":1.12,"response_format":"mp3"}',
             'background', '["中文","女声","旁白","温暖","引导"]', 1)
        ON CONFLICT(id) DO UPDATE SET
            display_name = excluded.display_name,
            engine = excluded.engine,
            engine_config = excluded.engine_config,
            role_type = excluded.role_type,
            tags = excluded.tags,
            is_preset = excluded.is_preset,
            updated_at = datetime('now');
        "#,
    )?;
    Ok(())
}

/// Apply voice routing defaults for immutable preset scenarios.
pub fn apply_preset_scenario_voice_defaults(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        UPDATE scenarios
        SET voice_mapping = '{"assistant":"preset-voice-serena"}',
            tts_enabled = 1,
            auto_play = 0,
            updated_at = datetime('now')
        WHERE id = 'preset-emotional-bot' AND is_preset = 1;

        UPDATE scenarios
        SET voice_mapping = '{"assistant":"preset-voice-narrator"}',
            tts_enabled = 1,
            auto_play = 0,
            updated_at = datetime('now')
        WHERE id = 'preset-text-mud' AND is_preset = 1;

        UPDATE scenarios
        SET voice_mapping = '{"assistant":"preset-voice-vivian"}',
            tts_enabled = 1,
            auto_play = 0,
            updated_at = datetime('now')
        WHERE id = 'preset-translator' AND is_preset = 1;

        UPDATE scenarios
        SET voice_mapping = '{"assistant":"preset-voice-vivian"}',
            tts_enabled = 1,
            auto_play = 0,
            updated_at = datetime('now')
        WHERE id = 'preset-coding-assistant' AND is_preset = 1;

        UPDATE scenarios
        SET voice_mapping = '{"assistant":"preset-voice-narrator"}',
            tts_enabled = 1,
            auto_play = 0,
            updated_at = datetime('now')
        WHERE id = 'preset-writing-assistant' AND is_preset = 1;
        "#,
    )?;
    Ok(())
}

pub fn init_db(conn: &Connection) -> Result<()> {
    // Enable WAL mode and foreign keys first
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        ",
    )?;

    let version = get_schema_version(conn)?;

    // V0 → V1: Original schema (Phase 0+1)
    if version < 1 {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT 'New Chat',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK(role IN ('system','user','assistant')),
                content TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conversation
                ON messages(conversation_id, created_at);

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
            ",
        )?;
        set_schema_version(conn, 1)?;
    }

    // V1 → V2: Scenarios + conversations.scenario_id
    if version < 2 {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS scenarios (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                system_prompt TEXT NOT NULL DEFAULT '',
                icon TEXT NOT NULL DEFAULT '',
                is_preset INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_scenarios_preset
                ON scenarios(is_preset);
            ",
        )?;

        // Check if scenario_id column already exists (safety)
        let has_scenario_id: bool = conn
            .prepare("PRAGMA table_info(conversations)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .any(|name| name.map(|n| n == "scenario_id").unwrap_or(false));

        if !has_scenario_id {
            conn.execute_batch(
                "ALTER TABLE conversations ADD COLUMN scenario_id TEXT REFERENCES scenarios(id) ON DELETE SET NULL;",
            )?;
        }

        // Create index for filtering by scenario
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_conversations_scenario ON conversations(scenario_id);",
        )?;

        // Seed preset scenarios
        seed_presets(conn)?;

        set_schema_version(conn, 2)?;
    }

    // V2 → V3: Voice profiles + scenario TTS fields
    if version < 3 {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS voices (
                id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                engine TEXT NOT NULL DEFAULT 'qwen3-tts',
                engine_config TEXT NOT NULL DEFAULT '{}',
                role_type TEXT NOT NULL DEFAULT 'character' CHECK(role_type IN ('background','character')),
                tags TEXT NOT NULL DEFAULT '[]',
                is_preset INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            ",
        )?;

        // Add voice_mapping, tts_enabled, auto_play to scenarios
        let scenario_cols: Vec<String> = conn
            .prepare("PRAGMA table_info(scenarios)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();

        if !scenario_cols.contains(&"voice_mapping".to_string()) {
            conn.execute_batch(
                "ALTER TABLE scenarios ADD COLUMN voice_mapping TEXT NOT NULL DEFAULT '{}';",
            )?;
        }
        if !scenario_cols.contains(&"tts_enabled".to_string()) {
            conn.execute_batch(
                "ALTER TABLE scenarios ADD COLUMN tts_enabled INTEGER NOT NULL DEFAULT 0;",
            )?;
        }
        if !scenario_cols.contains(&"auto_play".to_string()) {
            conn.execute_batch(
                "ALTER TABLE scenarios ADD COLUMN auto_play INTEGER NOT NULL DEFAULT 0;",
            )?;
        }

        // Seed preset voices
        seed_preset_voices(conn)?;

        set_schema_version(conn, 3)?;
    }

    // V3 → V4: Context compression — is_pinned + default settings
    if version < 4 {
        // Add is_pinned column to messages
        let msg_cols: Vec<String> = conn
            .prepare("PRAGMA table_info(messages)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();

        if !msg_cols.contains(&"is_pinned".to_string()) {
            conn.execute_batch(
                "ALTER TABLE messages ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;",
            )?;
        }

        // Seed default context settings
        conn.execute_batch(
            "
            INSERT OR IGNORE INTO settings (key, value) VALUES ('context_hot_size', '20');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('context_max_messages', '50');
            ",
        )?;

        set_schema_version(conn, 4)?;
    }

    // V4 → V5: Usage tracking
    if version < 5 {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS usage_records (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                message_id TEXT,
                model TEXT NOT NULL,
                prompt_tokens INTEGER NOT NULL DEFAULT 0,
                completion_tokens INTEGER NOT NULL DEFAULT 0,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_usage_conversation
                ON usage_records(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_usage_created_at
                ON usage_records(created_at);
            CREATE INDEX IF NOT EXISTS idx_usage_model
                ON usage_records(model);
            ",
        )?;
        set_schema_version(conn, 5)?;
    }

    // V5 → V6: Remove scenario emoji icons from stored data
    if version < 6 {
        conn.execute("UPDATE scenarios SET icon = ''", [])?;
        set_schema_version(conn, 6)?;
    }

    // V6 → V7: Soft-delete conversations to preserve usage history
    if version < 7 {
        let conversation_cols: Vec<String> = conn
            .prepare("PRAGMA table_info(conversations)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();

        if !conversation_cols.contains(&"deleted_at".to_string()) {
            conn.execute_batch("ALTER TABLE conversations ADD COLUMN deleted_at TEXT;")?;
        }

        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_conversations_deleted_at ON conversations(deleted_at);",
        )?;

        set_schema_version(conn, 7)?;
    }

    // V7 → V8: Refresh preset TTS defaults for voices and scenario routing
    if version < 8 {
        seed_preset_voices(conn)?;
        apply_preset_scenario_voice_defaults(conn)?;
        set_schema_version(conn, 8)?;
    }

    // V8 → V9: OpenClaw Gateway instances + conversation OpenClaw fields
    if version < 9 {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS openclaw_instances (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                gateway_url TEXT NOT NULL,
                token TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            ",
        )?;

        let conversation_cols: Vec<String> = conn
            .prepare("PRAGMA table_info(conversations)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();

        if !conversation_cols.contains(&"openclaw_instance_id".to_string()) {
            conn.execute_batch(
                "ALTER TABLE conversations ADD COLUMN openclaw_instance_id TEXT REFERENCES openclaw_instances(id) ON DELETE SET NULL;",
            )?;
        }
        if !conversation_cols.contains(&"openclaw_agent_id".to_string()) {
            conn.execute_batch(
                "ALTER TABLE conversations ADD COLUMN openclaw_agent_id TEXT;",
            )?;
        }
        if !conversation_cols.contains(&"openclaw_session_key".to_string()) {
            conn.execute_batch(
                "ALTER TABLE conversations ADD COLUMN openclaw_session_key TEXT;",
            )?;
        }

        set_schema_version(conn, 9)?;
    }

    Ok(())
}
