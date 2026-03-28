use rusqlite::{Connection, Result};

/// Get current schema version from PRAGMA user_version.
fn get_schema_version(conn: &Connection) -> Result<i32> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
}

/// Check whether a column already exists in a table (for safe ALTER TABLE migrations).
fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let exists = conn
        .prepare(&format!("PRAGMA table_info({})", table))?
        .query_map([], |row| row.get::<_, String>(1))?
        .any(|name| name.map(|n| n == column).unwrap_or(false));
    Ok(exists)
}

/// Set schema version.
fn set_schema_version(conn: &Connection, version: i32) -> Result<()> {
    conn.execute_batch(&format!("PRAGMA user_version = {}", version))?;
    Ok(())
}

fn backfill_order_column(
    conn: &Connection,
    table: &str,
    sort_column: &str,
    order_column: &str,
) -> Result<()> {
    let sql = format!(
        "SELECT rowid FROM {} ORDER BY {} ASC, rowid ASC",
        table, sort_column
    );
    let mut stmt = conn.prepare(&sql)?;
    let rowids: Vec<i64> = stmt
        .query_map([], |row| row.get::<_, i64>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    let update_sql = format!(
        "UPDATE {} SET {} = ?1 WHERE rowid = ?2",
        table, order_column
    );
    let mut update_stmt = conn.prepare(&update_sql)?;
    for (index, rowid) in rowids.into_iter().enumerate() {
        update_stmt.execute(rusqlite::params![(index as i64) + 1, rowid])?;
    }

    Ok(())
}

fn backfill_message_order(conn: &Connection) -> Result<()> {
    backfill_order_column(conn, "messages", "created_at", "message_order")
}

fn backfill_conversation_updated_order(conn: &Connection) -> Result<()> {
    backfill_order_column(conn, "conversations", "updated_at", "updated_at_order")
}

/// Seed preset scenarios (called in v2 migration and after reset)
pub fn seed_presets(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        INSERT INTO scenarios (id, name, name_en, description, description_en, system_prompt, icon, is_preset)
        VALUES
            ('preset-emotional-bot', '情感机器人', 'Emotional Bot', '温暖的情感支持伙伴', 'A warm emotional support companion',
             '你是一个温暖、善解人意的情感支持机器人。你的目标是倾听用户的心声，给予共情和鼓励。你会用温和的语气回应，不评判、不说教。当用户表达负面情绪时，你首先表示理解和共鸣，然后温柔地提供支持和建议。',
             '', 1),
            ('preset-text-mud', '文字 MUD', 'Text MUD', '沉浸式文字冒险游戏', 'Immersive text adventure game',
             '你是一个文字冒险游戏的 DM（地下城主）。你负责构建一个引人入胜的奇幻世界，描述场景、NPC 和事件。玩家通过文字输入行动，你根据玩家的选择推进故事。保持叙事的一致性和沉浸感。每次回复包含：场景描述、可能的行动选项、当前状态（生命值、物品等）。',
             '', 1),
            ('preset-translator', '翻译助手', 'Translator', '专业多语言翻译', 'Professional multilingual translator',
             '你是一个专业翻译。用户发送任何语言的文本，你自动检测源语言并翻译为目标语言。如果用户发送中文，翻译为英文；如果用户发送英文或其他语言，翻译为中文。翻译要求：准确、自然、符合目标语言的表达习惯。如有专业术语，附加注释说明。',
             '', 1),
            ('preset-coding-assistant', '编程助手', 'Coding Assistant', '高级软件工程师', 'Senior software engineer',
             '你是一个高级软件工程师和编程助手。你精通多种编程语言和框架。回答编程问题时：1) 先理解问题本质 2) 给出清晰的代码示例 3) 解释关键逻辑 4) 指出潜在的坑和最佳实践。代码用 Markdown 代码块格式化，注释用中文。',
             '', 1),
            ('preset-writing-assistant', '写作助手', 'Writing Assistant', '专业写作顾问', 'Professional writing consultant',
             '你是一个专业的写作助手。你可以帮助用户：1) 润色和改善文章的表达 2) 纠正语法和用词错误 3) 调整文章结构和逻辑 4) 根据要求撰写不同风格的文案。你会保持用户的原始意图，同时提升文字质量。对修改的地方，简要说明修改原因。',
             '', 1)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            name_en = excluded.name_en,
            description = excluded.description,
            description_en = excluded.description_en,
            system_prompt = excluded.system_prompt,
            icon = excluded.icon,
            is_preset = excluded.is_preset,
            updated_at = datetime('now');
        ",
    )?;
    Ok(())
}

/// Seed preset image-generation scenarios (called in v16 migration)
pub fn seed_image_gen_presets(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        INSERT INTO scenarios (id, name, name_en, description, description_en, system_prompt, icon, is_preset)
        VALUES
            ('preset-img-text2img', '文本生图', 'Text to Image',
             '根据文字描述生成图片', 'Generate images from text descriptions',
             '你是一个专业的图片生成助手。用户会给你描述想要的图片，你帮助他们生成。\n\n使用方法：直接输入图片描述即可。你可以用以下参数控制生成：\n--ratio 16:9 / 9:16 / 1:1 / 4:3 / 3:4（画面比例）\n--quality hd / standard（画质）\n--count 1-4（生成数量）\n--bg auto / transparent / opaque（背景）\n\n示例：一只橘猫在阳光下打盹 --ratio 16:9 --quality hd',
             '', 1),
            ('preset-img-img2img', '以图生图', 'Image to Image',
             '基于参考图片生成新图片', 'Generate new images based on reference images',
             '你是一个图片编辑助手。用户会上传一张参考图片，并描述想要的修改或变化，你帮助他们基于参考图生成新图片。\n\n使用方法：\n1. 点击附件按钮上传参考图片\n2. 输入你想要的修改描述\n\n示例：将背景改为星空 / 添加水彩画风格 / 把猫换成狗',
             '', 1),
            ('preset-img-avatar', '头像生成', 'Avatar Generator',
             '生成个性化头像和角色立绘', 'Generate personalized avatars and character art',
             '你是一个头像和角色设计助手。你擅长根据用户描述生成各种风格的头像、角色立绘和个人形象图。\n\n推荐参数：--ratio 1:1 --quality hd\n\n可以尝试的风格：赛博朋克、水彩、油画、像素风、动漫、3D渲染、极简线条等。\n\n示例：一个戴墨镜的赛博朋克风格女孩头像 --quality hd',
             '', 1),
            ('preset-img-poster', '海报设计', 'Poster Design',
             '生成创意海报和宣传图', 'Generate creative posters and promotional graphics',
             '你是一个海报和平面设计助手。你擅长根据用户需求生成各类海报、宣传图、封面等设计作品。\n\n推荐参数：--ratio 9:16（竖版海报）或 16:9（横幅）\n\n可以描述：主题、风格、配色、文字内容、目标受众等。\n\n示例：极简风格的音乐节海报，深蓝色调，有星空元素 --ratio 9:16 --quality hd',
             '', 1),
            ('preset-img-logo', 'Logo 设计', 'Logo Design',
             '生成品牌标志和图标', 'Generate brand logos and icons',
             '你是一个 Logo 和图标设计助手。你擅长根据用户的品牌理念生成简洁有力的标志设计。\n\n推荐参数：--ratio 1:1 --quality hd --bg transparent\n\n描述时可以包含：品牌名称、行业领域、风格偏好（极简/复古/科技感等）、配色偏好。\n\n示例：一个科技公司的极简 Logo，名称 NovaTech，蓝色调 --bg transparent --quality hd',
             '', 1)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            name_en = excluded.name_en,
            description = excluded.description,
            description_en = excluded.description_en,
            system_prompt = excluded.system_prompt,
            icon = excluded.icon,
            is_preset = excluded.is_preset,
            updated_at = datetime('now');
        ",
    )?;
    Ok(())
}

/// Seed preset voice profiles
pub fn seed_preset_voices(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        INSERT INTO voices (id, display_name, display_name_en, engine, engine_config, role_type, tags, tags_en, is_preset)
        VALUES
            -- ── Female voices ──
            ('preset-voice-vivian', 'Vivian · 知性女声', 'Vivian · Clear Female', 'qwen3-tts',
             '{"endpoint":"http://127.0.0.1:8012","model":"mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit","voice":"Vivian","speed":1.16,"response_format":"mp3"}',
             'character', '["女声","清晰","干练"]', '["Female","Clear","Professional"]', 1),
            ('preset-voice-serena', 'Serena · 温柔女声', 'Serena · Gentle Female', 'qwen3-tts',
             '{"endpoint":"http://127.0.0.1:8012","model":"mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit","voice":"Serena","speed":1.1,"response_format":"mp3"}',
             'character', '["女声","温柔","治愈"]', '["Female","Gentle","Soothing"]', 1),
            ('preset-voice-narrator-f', 'Aria · 温暖旁白', 'Aria · Warm Narrator', 'qwen3-tts',
             '{"endpoint":"http://127.0.0.1:8012","model":"mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit","voice":"Warm Chinese female narrator with clear articulation, steady energy, and a slightly brisk but still relaxed pace.","speed":1.12,"response_format":"mp3"}',
             'background', '["女声","旁白","温暖"]', '["Female","Narrator","Warm"]', 1),
            -- ── Male voices ──
            ('preset-voice-ethan', 'Ethan · 沉稳男声', 'Ethan · Deep Male', 'qwen3-tts',
             '{"endpoint":"http://127.0.0.1:8012","model":"mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit","voice":"Ethan","speed":1.1,"response_format":"mp3"}',
             'character', '["男声","沉稳","磁性"]', '["Male","Steady","Deep"]', 1),
            ('preset-voice-lucas', 'Lucas · 阳光男声', 'Lucas · Friendly Male', 'qwen3-tts',
             '{"endpoint":"http://127.0.0.1:8012","model":"mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit","voice":"Lucas","speed":1.15,"response_format":"mp3"}',
             'character', '["男声","阳光","活力"]', '["Male","Friendly","Energetic"]', 1),
            ('preset-voice-narrator-m', 'Marcus · 磁性旁白', 'Marcus · Deep Narrator', 'qwen3-tts',
             '{"endpoint":"http://127.0.0.1:8012","model":"mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit","voice":"A deep, resonant Chinese male narrator with calm authority, smooth delivery, and a warm baritone that draws listeners in.","speed":1.08,"response_format":"mp3"}',
             'background', '["男声","旁白","磁性"]', '["Male","Narrator","Deep"]', 1)
        ON CONFLICT(id) DO UPDATE SET
            display_name = excluded.display_name,
            display_name_en = excluded.display_name_en,
            engine = excluded.engine,
            engine_config = excluded.engine_config,
            role_type = excluded.role_type,
            tags = excluded.tags,
            tags_en = excluded.tags_en,
            is_preset = excluded.is_preset,
            updated_at = datetime('now');
        "#,
    )?;

    // Clean up old narrator ID that was renamed
    conn.execute_batch("DELETE FROM voices WHERE id = 'preset-voice-narrator' AND is_preset = 1;")?;

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
        SET voice_mapping = '{"assistant":"preset-voice-narrator-f"}',
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
        SET voice_mapping = '{"assistant":"preset-voice-ethan"}',
            tts_enabled = 1,
            auto_play = 0,
            updated_at = datetime('now')
        WHERE id = 'preset-coding-assistant' AND is_preset = 1;

        UPDATE scenarios
        SET voice_mapping = '{"assistant":"preset-voice-narrator-f"}',
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

        if !has_column(conn, "conversations", "scenario_id")? {
            conn.execute_batch(
                "ALTER TABLE conversations ADD COLUMN scenario_id TEXT REFERENCES scenarios(id) ON DELETE SET NULL;",
            )?;
        }

        // Create index for filtering by scenario
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_conversations_scenario ON conversations(scenario_id);",
        )?;

        // Presets will be seeded in V14 with bilingual columns
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
        if !has_column(conn, "scenarios", "voice_mapping")? {
            conn.execute_batch(
                "ALTER TABLE scenarios ADD COLUMN voice_mapping TEXT NOT NULL DEFAULT '{}';",
            )?;
        }
        if !has_column(conn, "scenarios", "tts_enabled")? {
            conn.execute_batch(
                "ALTER TABLE scenarios ADD COLUMN tts_enabled INTEGER NOT NULL DEFAULT 0;",
            )?;
        }
        if !has_column(conn, "scenarios", "auto_play")? {
            conn.execute_batch(
                "ALTER TABLE scenarios ADD COLUMN auto_play INTEGER NOT NULL DEFAULT 0;",
            )?;
        }

        // Preset voices will be seeded in V14 with bilingual columns
        set_schema_version(conn, 3)?;
    }

    // V3 → V4: Context compression — is_pinned + default settings
    if version < 4 {
        if !has_column(conn, "messages", "is_pinned")? {
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
        if !has_column(conn, "conversations", "deleted_at")? {
            conn.execute_batch("ALTER TABLE conversations ADD COLUMN deleted_at TEXT;")?;
        }

        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_conversations_deleted_at ON conversations(deleted_at);",
        )?;

        set_schema_version(conn, 7)?;
    }

    // V7 → V8: Refresh preset TTS defaults (deferred to V14 for bilingual column compat)
    if version < 8 {
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

        if !has_column(conn, "conversations", "openclaw_instance_id")? {
            conn.execute_batch(
                "ALTER TABLE conversations ADD COLUMN openclaw_instance_id TEXT REFERENCES openclaw_instances(id) ON DELETE SET NULL;",
            )?;
        }
        if !has_column(conn, "conversations", "openclaw_agent_id")? {
            conn.execute_batch("ALTER TABLE conversations ADD COLUMN openclaw_agent_id TEXT;")?;
        }
        if !has_column(conn, "conversations", "openclaw_session_key")? {
            conn.execute_batch("ALTER TABLE conversations ADD COLUMN openclaw_session_key TEXT;")?;
        }

        set_schema_version(conn, 9)?;
    }

    // ── V10: Add agents_cache to openclaw_instances ──
    if version < 10 {
        if !has_column(conn, "openclaw_instances", "agents_cache")? {
            conn.execute_batch(
                "ALTER TABLE openclaw_instances ADD COLUMN agents_cache TEXT NOT NULL DEFAULT '[]';",
            )?;
        }

        set_schema_version(conn, 10)?;
    }

    // V10 → V11: Attachments table for multimedia messages
    if version < 11 {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS attachments (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                file_type TEXT NOT NULL CHECK(file_type IN ('image', 'text_file', 'audio')),
                file_name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                metadata TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_attachments_message
                ON attachments(message_id);
            ",
        )?;
        set_schema_version(conn, 11)?;
    }

    // V11 → V12: Conversation summaries table + clean up old summary messages
    if version < 12 {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS conversation_summaries (
                conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
                summary TEXT NOT NULL,
                covered_until_message_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- Clean up old summary messages stored as system messages
            DELETE FROM messages WHERE role = 'system' AND content LIKE '[上下文摘要]%';
            ",
        )?;
        set_schema_version(conn, 12)?;
    }

    // V12 → V13: Refresh preset voices (deferred to V14 for bilingual column compat)
    if version < 13 {
        set_schema_version(conn, 13)?;
    }

    // V13 → V14: Bilingual fields for voice and scenario presets
    if version < 14 {
        if !has_column(conn, "voices", "display_name_en")? {
            conn.execute_batch(
                "ALTER TABLE voices ADD COLUMN display_name_en TEXT NOT NULL DEFAULT '';",
            )?;
        }
        if !has_column(conn, "voices", "tags_en")? {
            conn.execute_batch(
                "ALTER TABLE voices ADD COLUMN tags_en TEXT NOT NULL DEFAULT '[]';",
            )?;
        }
        if !has_column(conn, "scenarios", "name_en")? {
            conn.execute_batch(
                "ALTER TABLE scenarios ADD COLUMN name_en TEXT NOT NULL DEFAULT '';",
            )?;
        }
        if !has_column(conn, "scenarios", "description_en")? {
            conn.execute_batch(
                "ALTER TABLE scenarios ADD COLUMN description_en TEXT NOT NULL DEFAULT '';",
            )?;
        }

        // Re-seed presets to populate the new bilingual columns
        seed_preset_voices(conn)?;
        seed_presets(conn)?;

        set_schema_version(conn, 14)?;
    }

    // ── V15: Add is_remote to openclaw_instances ──
    if version < 15 {
        if !has_column(conn, "openclaw_instances", "is_remote")? {
            conn.execute_batch(
                "ALTER TABLE openclaw_instances ADD COLUMN is_remote INTEGER NOT NULL DEFAULT 0;",
            )?;
        }

        set_schema_version(conn, 15)?;
    }

    // ── V16: Seed image-generation preset assistants ──
    if version < 16 {
        seed_image_gen_presets(conn)?;
        set_schema_version(conn, 16)?;
    }

    // ── V17: Stable message/conversation ordering independent of second-level timestamps ──
    if version < 17 {
        if !has_column(conn, "messages", "message_order")? {
            conn.execute_batch(
                "ALTER TABLE messages ADD COLUMN message_order INTEGER NOT NULL DEFAULT 0;",
            )?;
        }
        if !has_column(conn, "conversations", "updated_at_order")? {
            conn.execute_batch(
                "ALTER TABLE conversations ADD COLUMN updated_at_order INTEGER NOT NULL DEFAULT 0;",
            )?;
        }

        backfill_message_order(conn)?;
        backfill_conversation_updated_order(conn)?;

        conn.execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_messages_conversation_order
                ON messages(conversation_id, message_order);

            CREATE INDEX IF NOT EXISTS idx_conversations_updated_order
                ON conversations(deleted_at, updated_at_order DESC);

            CREATE TRIGGER IF NOT EXISTS trg_messages_assign_order
            AFTER INSERT ON messages
            FOR EACH ROW
            WHEN NEW.message_order = 0
            BEGIN
                UPDATE messages
                SET message_order = (
                    SELECT COALESCE(MAX(message_order), 0) + 1
                    FROM messages
                    WHERE conversation_id = NEW.conversation_id
                      AND rowid != NEW.rowid
                )
                WHERE rowid = NEW.rowid;
            END;

            CREATE TRIGGER IF NOT EXISTS trg_conversations_assign_updated_order_insert
            AFTER INSERT ON conversations
            FOR EACH ROW
            WHEN NEW.updated_at_order = 0
            BEGIN
                UPDATE conversations
                SET updated_at_order = (
                    SELECT COALESCE(MAX(updated_at_order), 0) + 1
                    FROM conversations
                    WHERE rowid != NEW.rowid
                )
                WHERE rowid = NEW.rowid;
            END;

            CREATE TRIGGER IF NOT EXISTS trg_conversations_bump_updated_order
            AFTER UPDATE OF updated_at ON conversations
            FOR EACH ROW
            WHEN NEW.updated_at_order = OLD.updated_at_order
            BEGIN
                UPDATE conversations
                SET updated_at_order = (
                    SELECT COALESCE(MAX(updated_at_order), 0) + 1
                    FROM conversations
                    WHERE rowid != NEW.rowid
                )
                WHERE rowid = NEW.rowid;
            END;
            ",
        )?;

        set_schema_version(conn, 17)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::init_db;
    use rusqlite::Connection;

    #[test]
    fn message_order_trigger_assigns_stable_sequence() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();

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

        let ordered_ids: Vec<String> = conn
            .prepare(
                "SELECT id FROM messages WHERE conversation_id = 'conv1' ORDER BY message_order ASC",
            )
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(ordered_ids, vec!["msg1", "msg2", "msg3"]);
    }

    #[test]
    fn conversation_updated_order_trigger_tracks_latest_update() {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();

        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('conv1', 'One', '2024-01-01 00:00:00', '2024-01-01 00:00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('conv2', 'Two', '2024-01-01 00:00:00', '2024-01-01 00:00:00')",
            [],
        )
        .unwrap();

        conn.execute(
            "UPDATE conversations SET updated_at = '2024-01-01 00:00:00' WHERE id = 'conv1'",
            [],
        )
        .unwrap();

        let ordered_ids: Vec<String> = conn
            .prepare(
                "SELECT id FROM conversations WHERE deleted_at IS NULL ORDER BY updated_at_order DESC",
            )
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(ordered_ids, vec!["conv1", "conv2"]);
    }
}
