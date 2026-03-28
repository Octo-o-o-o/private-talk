use crate::db::DbState;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::{AppHandle, Manager, State};

const PBKDF2_ITERATIONS: u32 = 600_000;
const SALT_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

// ── Exported data structures ────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct ConfigPayload {
    version: u32,
    app: String,
    exported_at: String,
    providers: Vec<ProviderData>,
    voices: Vec<VoiceData>,
    assistants: Vec<AssistantData>,
    openclaw_instances: Vec<OpenClawData>,
    settings: Vec<SettingEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ProviderData {
    name: String,
    api_type: String,
    base_url: String,
    api_key: String,
    models: Vec<String>,
    is_default: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct VoiceData {
    display_name: String,
    display_name_en: String,
    engine: String,
    engine_config: serde_json::Value,
    role_type: String,
    tags: Vec<String>,
    tags_en: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AssistantData {
    name: String,
    name_en: String,
    description: String,
    description_en: String,
    system_prompt: String,
    icon: String,
    voice_mapping: serde_json::Value,
    tts_enabled: bool,
    auto_play: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenClawData {
    name: String,
    gateway_url: String,
    token: String,
    agents_cache: String,
    is_remote: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct SettingEntry {
    key: String,
    value: String,
}

// ── Encrypted file envelope ─────────────────────────────────────────────
// Format: "PTBK" (4 bytes magic) + version u8 + salt (32) + nonce (12) + ciphertext

const MAGIC: &[u8; 4] = b"PTBK";
const FILE_VERSION: u8 = 1;

fn derive_key(password: &str, salt: &[u8]) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    key
}

fn encrypt(plaintext: &[u8], password: &str) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let key = derive_key(password, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, plaintext).map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(4 + 1 + SALT_LEN + NONCE_LEN + ciphertext.len());
    out.extend_from_slice(MAGIC);
    out.push(FILE_VERSION);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

fn decrypt(data: &[u8], password: &str) -> Result<Vec<u8>, String> {
    let header_len = 4 + 1 + SALT_LEN + NONCE_LEN;
    if data.len() < header_len {
        return Err("Invalid backup file: too short".into());
    }
    if &data[0..4] != MAGIC {
        return Err("Invalid backup file: bad magic header".into());
    }
    let version = data[4];
    if version != FILE_VERSION {
        return Err(format!("Unsupported backup version: {version}"));
    }

    let salt = &data[5..5 + SALT_LEN];
    let nonce_bytes = &data[5 + SALT_LEN..5 + SALT_LEN + NONCE_LEN];
    let ciphertext = &data[header_len..];

    let key = derive_key(password, salt);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Decryption failed: wrong password or corrupted file".to_string())
}

// ── Settings keys safe to export (exclude PIN, sensitive internal state) ─

const EXPORTABLE_SETTINGS: &[&str] = &[
    "ui_language",
    "ui_zoom",
    "ui_theme_mode",
    "context_hot_size",
    "context_max_messages",
    "stt_provider_id",
    "stt_model",
];

// ── Result types ────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ExportResult {
    pub providers: usize,
    pub voices: usize,
    pub assistants: usize,
    pub openclaw_instances: usize,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub providers: usize,
    pub voices: usize,
    pub assistants: usize,
    pub openclaw_instances: usize,
    pub settings: usize,
}

#[derive(Debug, Serialize)]
pub struct ValidateBackupResult {
    pub providers: usize,
    pub voices: usize,
    pub assistants: usize,
    pub openclaw_instances: usize,
    pub settings: usize,
    pub has_local_config: bool,
}

// ── Commands ────────────────────────────────────────────────────────────

/// Export config to a file. The frontend is responsible for showing the
/// file-save dialog and passing the chosen path here.
#[tauri::command]
pub fn export_config(
    db: State<'_, DbState>,
    password: String,
    file_path: String,
) -> Result<ExportResult, String> {
    if password.is_empty() {
        return Err("Password cannot be empty".into());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let providers = collect_providers(&conn)?;
    let voices = collect_voices(&conn)?;
    let assistants = collect_assistants(&conn)?;
    let openclaw_instances = collect_openclaw(&conn)?;
    let settings = collect_settings(&conn)?;

    let result = ExportResult {
        providers: providers.len(),
        voices: voices.len(),
        assistants: assistants.len(),
        openclaw_instances: openclaw_instances.len(),
    };

    let payload = ConfigPayload {
        version: 1,
        app: "private-talk".to_string(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        providers,
        voices,
        assistants,
        openclaw_instances,
        settings,
    };

    let json = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    let encrypted = encrypt(json.as_bytes(), &password)?;

    std::fs::write(&file_path, &encrypted).map_err(|e| e.to_string())?;

    Ok(result)
}

/// Cache backup bytes (read by the frontend) into the app's data directory.
/// Returns the stable cached file path for subsequent validate / import calls.
#[tauri::command]
pub fn cache_backup_data(app: AppHandle, data: Vec<u8>) -> Result<String, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    let cached = cache_dir.join("pending_import.ptbackup");
    std::fs::write(&cached, &data).map_err(|e| e.to_string())?;

    cached
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Non-UTF8 cache path".into())
}

/// Validate a backup file: decrypt with password and return summary + whether local config exists.
#[tauri::command]
pub fn validate_backup(
    db: State<'_, DbState>,
    password: String,
    file_path: String,
) -> Result<ValidateBackupResult, String> {
    if password.is_empty() {
        return Err("Password cannot be empty".into());
    }

    let data = std::fs::read(&file_path).map_err(|e| e.to_string())?;
    let plaintext = decrypt(&data, &password)?;
    let payload: ConfigPayload =
        serde_json::from_slice(&plaintext).map_err(|e| format!("Invalid backup data: {e}"))?;

    if payload.app != "private-talk" {
        return Err("This backup file is not from Private Talk".into());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let has_local_config = has_any_config(&conn)?;

    Ok(ValidateBackupResult {
        providers: payload.providers.len(),
        voices: payload.voices.len(),
        assistants: payload.assistants.len(),
        openclaw_instances: payload.openclaw_instances.len(),
        settings: payload.settings.len(),
        has_local_config,
    })
}

/// Import config from a file. The frontend is responsible for showing the
/// file-open dialog and passing the chosen path here.
/// `mode` can be "merge" (append) or "replace" (delete existing then import).
#[tauri::command]
pub fn import_config(
    db: State<'_, DbState>,
    password: String,
    file_path: String,
    mode: String,
) -> Result<ImportResult, String> {
    if password.is_empty() {
        return Err("Password cannot be empty".into());
    }

    let data = std::fs::read(&file_path).map_err(|e| e.to_string())?;
    let plaintext = decrypt(&data, &password)?;
    let payload: ConfigPayload =
        serde_json::from_slice(&plaintext).map_err(|e| format!("Invalid backup data: {e}"))?;

    if payload.app != "private-talk" {
        return Err("This backup file is not from Private Talk".into());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // If replace mode, delete existing user data first
    if mode == "replace" {
        conn.execute("DELETE FROM providers", []).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM voices WHERE is_preset = 0", []).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM scenarios WHERE is_preset = 0", []).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM openclaw_instances", []).map_err(|e| e.to_string())?;
        for key in EXPORTABLE_SETTINGS {
            conn.execute("DELETE FROM settings WHERE key = ?1", rusqlite::params![key])
                .map_err(|e| e.to_string())?;
        }
    }

    let mut imported_providers = 0usize;
    let mut imported_voices = 0usize;
    let mut imported_assistants = 0usize;
    let mut imported_openclaw = 0usize;
    let mut imported_settings = 0usize;

    // Import providers
    for p in &payload.providers {
        let id = crate::db::new_id();
        let models_json = serde_json::to_string(&p.models).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_default, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))",
            rusqlite::params![id, p.name, p.api_type, p.base_url, p.api_key, models_json, p.is_default],
        )
        .map_err(|e| e.to_string())?;
        imported_providers += 1;
    }

    // Import voices (non-preset)
    for v in &payload.voices {
        let id = crate::db::new_id();
        let config_json =
            serde_json::to_string(&v.engine_config).unwrap_or_else(|_| "{}".to_string());
        let tags_json = serde_json::to_string(&v.tags).unwrap_or_else(|_| "[]".to_string());
        let tags_en_json =
            serde_json::to_string(&v.tags_en).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO voices (id, display_name, display_name_en, engine, engine_config, role_type, tags, tags_en, is_preset, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, datetime('now'), datetime('now'))",
            rusqlite::params![
                id,
                v.display_name,
                v.display_name_en,
                v.engine,
                config_json,
                v.role_type,
                tags_json,
                tags_en_json,
            ],
        )
        .map_err(|e| e.to_string())?;
        imported_voices += 1;
    }

    // Import assistants (non-preset)
    for a in &payload.assistants {
        let id = crate::db::new_id();
        let mapping_json =
            serde_json::to_string(&a.voice_mapping).unwrap_or_else(|_| "{}".to_string());
        conn.execute(
            "INSERT INTO scenarios (id, name, name_en, description, description_en, system_prompt, icon, is_preset, voice_mapping, tts_enabled, auto_play, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10, datetime('now'), datetime('now'))",
            rusqlite::params![
                id,
                a.name,
                a.name_en,
                a.description,
                a.description_en,
                a.system_prompt,
                a.icon,
                mapping_json,
                a.tts_enabled,
                a.auto_play,
            ],
        )
        .map_err(|e| e.to_string())?;
        imported_assistants += 1;
    }

    // Import OpenClaw instances
    for o in &payload.openclaw_instances {
        let id = crate::db::new_id();
        conn.execute(
            "INSERT INTO openclaw_instances (id, name, gateway_url, token, agents_cache, is_remote, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'), datetime('now'))",
            rusqlite::params![id, o.name, o.gateway_url, o.token, o.agents_cache, o.is_remote],
        )
        .map_err(|e| e.to_string())?;
        imported_openclaw += 1;
    }

    // Import settings (upsert)
    for s in &payload.settings {
        if EXPORTABLE_SETTINGS.contains(&s.key.as_str()) {
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                rusqlite::params![s.key, s.value],
            )
            .map_err(|e| e.to_string())?;
            imported_settings += 1;
        }
    }

    Ok(ImportResult {
        providers: imported_providers,
        voices: imported_voices,
        assistants: imported_assistants,
        openclaw_instances: imported_openclaw,
        settings: imported_settings,
    })
}

// ── DB helpers ──────────────────────────────────────────────────────────

fn has_any_config(conn: &rusqlite::Connection) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT (SELECT COUNT(*) FROM providers) + \
             (SELECT COUNT(*) FROM voices WHERE is_preset = 0) + \
             (SELECT COUNT(*) FROM scenarios WHERE is_preset = 0) + \
             (SELECT COUNT(*) FROM openclaw_instances)",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

// ── DB collection helpers ───────────────────────────────────────────────

fn collect_providers(conn: &rusqlite::Connection) -> Result<Vec<ProviderData>, String> {
    let mut stmt = conn
        .prepare("SELECT name, api_type, base_url, api_key, models, is_default FROM providers ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let models_str: String = row.get(4)?;
            let models: Vec<String> =
                serde_json::from_str(&models_str).unwrap_or_default();
            Ok(ProviderData {
                name: row.get(0)?,
                api_type: row.get(1)?,
                base_url: row.get(2)?,
                api_key: row.get(3)?,
                models,
                is_default: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn collect_voices(conn: &rusqlite::Connection) -> Result<Vec<VoiceData>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT display_name, display_name_en, engine, engine_config, role_type, tags, tags_en
             FROM voices WHERE is_preset = 0 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let config_str: String = row.get(3)?;
            let tags_str: String = row.get(5)?;
            let tags_en_str: String = row.get(6)?;
            Ok(VoiceData {
                display_name: row.get(0)?,
                display_name_en: row.get(1)?,
                engine: row.get(2)?,
                engine_config: serde_json::from_str(&config_str).unwrap_or(serde_json::Value::Object(Default::default())),
                role_type: row.get(4)?,
                tags: serde_json::from_str(&tags_str).unwrap_or_default(),
                tags_en: serde_json::from_str(&tags_en_str).unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn collect_assistants(conn: &rusqlite::Connection) -> Result<Vec<AssistantData>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT name, name_en, description, description_en, system_prompt, icon, voice_mapping, tts_enabled, auto_play
             FROM scenarios WHERE is_preset = 0 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let mapping_str: String = row.get(6)?;
            Ok(AssistantData {
                name: row.get(0)?,
                name_en: row.get(1)?,
                description: row.get(2)?,
                description_en: row.get(3)?,
                system_prompt: row.get(4)?,
                icon: row.get(5)?,
                voice_mapping: serde_json::from_str(&mapping_str).unwrap_or(serde_json::Value::Object(Default::default())),
                tts_enabled: row.get(7)?,
                auto_play: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn collect_openclaw(conn: &rusqlite::Connection) -> Result<Vec<OpenClawData>, String> {
    // Only export remote instances — local ones use ws://127.0.0.1 which
    // won't work on another device.
    let mut stmt = conn
        .prepare("SELECT name, gateway_url, token, agents_cache, is_remote FROM openclaw_instances WHERE is_remote = 1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(OpenClawData {
                name: row.get(0)?,
                gateway_url: row.get(1)?,
                token: row.get(2)?,
                agents_cache: row.get(3)?,
                is_remote: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn collect_settings(conn: &rusqlite::Connection) -> Result<Vec<SettingEntry>, String> {
    let placeholders: Vec<String> = EXPORTABLE_SETTINGS
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect();
    let sql = format!(
        "SELECT key, value FROM settings WHERE key IN ({})",
        placeholders.join(",")
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params: Vec<&dyn rusqlite::types::ToSql> = EXPORTABLE_SETTINGS
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();
    let rows = stmt
        .query_map(params.as_slice(), |row| {
            Ok(SettingEntry {
                key: row.get(0)?,
                value: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}
