use crate::db::DbState;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::State;

const PBKDF2_ITERATIONS: u32 = 600_000;
const SALT_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;
const MAGIC: &[u8; 4] = b"PTBK";
const FILE_VERSION: u8 = 1;

const EXPORTABLE_SETTINGS: &[&str] = &[
    "ui_language",
    "assistant_preset",
    "assistant_language",
    "assistant_custom_prompt",
    "chat_provider_id",
    "chat_model",
    "context_max_messages",
    "stt_provider_id",
    "stt_model",
    "tts_provider_id",
    "tts_model",
    "tts_voice",
    "image_gen_config",
    "provider_model_registry",
];

#[derive(Debug, Serialize, Deserialize)]
struct ConfigPayload {
    version: u32,
    app: String,
    exported_at: String,
    providers: Vec<ProviderData>,
    assistants: Vec<AssistantData>,
    settings: Vec<SettingEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProviderData {
    name: String,
    api_type: String,
    base_url: String,
    api_key: String,
    models: Vec<String>,
    is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SettingEntry {
    key: String,
    value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AssistantData {
    id: String,
    name: String,
    description: String,
    system_prompt: String,
    icon: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct ExportConfigResult {
    pub file_name: String,
    pub data: Vec<u8>,
    pub providers: usize,
    pub assistants: usize,
    pub settings: usize,
}

#[derive(Debug, Serialize)]
pub struct ImportConfigResult {
    pub providers: usize,
    pub assistants: usize,
    pub settings: usize,
}

#[derive(Debug, Serialize)]
pub struct ValidateBackupResult {
    pub providers: usize,
    pub assistants: usize,
    pub settings: usize,
    pub has_local_config: bool,
}

fn derive_key(password: &str, salt: &[u8]) -> [u8; KEY_LEN] {
    let mut key = [0_u8; KEY_LEN];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    key
}

fn encrypt(plaintext: &[u8], password: &str) -> Result<Vec<u8>, String> {
    let mut salt = [0_u8; SALT_LEN];
    let mut nonce_bytes = [0_u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let key = derive_key(password, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| error.to_string())?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|error| error.to_string())?;

    let mut output = Vec::with_capacity(4 + 1 + SALT_LEN + NONCE_LEN + ciphertext.len());
    output.extend_from_slice(MAGIC);
    output.push(FILE_VERSION);
    output.extend_from_slice(&salt);
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

fn decrypt(data: &[u8], password: &str) -> Result<Vec<u8>, String> {
    let header_len = 4 + 1 + SALT_LEN + NONCE_LEN;
    if data.len() < header_len {
        return Err("Invalid backup file: too short.".to_string());
    }
    if &data[0..4] != MAGIC {
        return Err("Invalid backup file: bad magic header.".to_string());
    }
    if data[4] != FILE_VERSION {
        return Err(format!("Unsupported backup version: {}", data[4]));
    }

    let salt = &data[5..5 + SALT_LEN];
    let nonce_bytes = &data[5 + SALT_LEN..5 + SALT_LEN + NONCE_LEN];
    let ciphertext = &data[header_len..];

    let key = derive_key(password, salt);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| error.to_string())?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Decryption failed: wrong password or corrupted file.".to_string())
}

fn collect_providers(conn: &rusqlite::Connection) -> Result<Vec<ProviderData>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT name, api_type, base_url, api_key, models, is_default FROM providers ORDER BY created_at ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let models_raw: String = row.get(4)?;
            Ok(ProviderData {
                name: row.get(0)?,
                api_type: row.get(1)?,
                base_url: row.get(2)?,
                api_key: row.get(3)?,
                models: serde_json::from_str(&models_raw).unwrap_or_default(),
                is_default: row.get::<_, i64>(5)? != 0,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn collect_settings(conn: &rusqlite::Connection) -> Result<Vec<SettingEntry>, String> {
    let placeholders = EXPORTABLE_SETTINGS
        .iter()
        .enumerate()
        .map(|(index, _)| format!("?{}", index + 1))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!("SELECT key, value FROM settings WHERE key IN ({placeholders})");
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let params = EXPORTABLE_SETTINGS
        .iter()
        .map(|key| key as &dyn rusqlite::types::ToSql)
        .collect::<Vec<_>>();
    let rows = stmt
        .query_map(params.as_slice(), |row| {
            Ok(SettingEntry {
                key: row.get(0)?,
                value: row.get(1)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn collect_assistants(conn: &rusqlite::Connection) -> Result<Vec<AssistantData>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, system_prompt, icon, created_at, updated_at
             FROM assistants
             WHERE is_preset = 0
             ORDER BY created_at ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(AssistantData {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                system_prompt: row.get(3)?,
                icon: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn has_any_config(conn: &rusqlite::Connection) -> Result<bool, String> {
    let provider_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM providers", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let setting_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM settings WHERE key IN (
                'ui_language', 'assistant_preset', 'assistant_language', 'assistant_custom_prompt',
                'chat_provider_id', 'chat_model', 'context_max_messages', 'stt_provider_id',
                'stt_model', 'tts_provider_id', 'tts_model', 'tts_voice', 'image_gen_config',
                'provider_model_registry'
            )",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let assistant_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM assistants WHERE is_preset = 0",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(provider_count > 0 || assistant_count > 0 || setting_count > 0)
}

fn parse_backup(data: &[u8], password: &str) -> Result<ConfigPayload, String> {
    let plaintext = decrypt(data, password)?;
    let payload: ConfigPayload = serde_json::from_slice(&plaintext)
        .map_err(|error| format!("Invalid backup data: {error}"))?;
    if payload.app != "private-talk" {
        return Err("This backup file is not from Private Talk.".to_string());
    }
    Ok(payload)
}

#[tauri::command]
pub fn export_config_data(
    db: State<'_, DbState>,
    password: String,
) -> Result<ExportConfigResult, String> {
    if password.trim().is_empty() {
        return Err("Password cannot be empty.".to_string());
    }

    let conn = db.lock()?;
    let providers = collect_providers(&conn)?;
    let assistants = collect_assistants(&conn)?;
    let settings = collect_settings(&conn)?;
    let payload = ConfigPayload {
        version: 1,
        app: "private-talk".to_string(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        providers: providers.clone(),
        assistants: assistants.clone(),
        settings: settings.clone(),
    };
    let json = serde_json::to_vec_pretty(&payload).map_err(|error| error.to_string())?;
    let data = encrypt(&json, &password)?;
    let file_name = format!(
        "private-talk-backup-{}.ptbackup",
        chrono::Utc::now().format("%Y%m%d-%H%M%S")
    );

    Ok(ExportConfigResult {
        file_name,
        data,
        providers: providers.len(),
        assistants: assistants.len(),
        settings: settings.len(),
    })
}

#[tauri::command]
pub fn validate_backup_data(
    db: State<'_, DbState>,
    password: String,
    data: Vec<u8>,
) -> Result<ValidateBackupResult, String> {
    if password.trim().is_empty() {
        return Err("Password cannot be empty.".to_string());
    }

    let payload = parse_backup(&data, &password)?;
    let conn = db.lock()?;
    let has_local_config = has_any_config(&conn)?;
    Ok(ValidateBackupResult {
        providers: payload.providers.len(),
        assistants: payload.assistants.len(),
        settings: payload.settings.len(),
        has_local_config,
    })
}

#[tauri::command]
pub fn import_config_data(
    db: State<'_, DbState>,
    password: String,
    data: Vec<u8>,
    mode: String,
) -> Result<ImportConfigResult, String> {
    if password.trim().is_empty() {
        return Err("Password cannot be empty.".to_string());
    }

    let payload = parse_backup(&data, &password)?;
    let conn = db.lock()?;

    if mode == "replace" {
        conn.execute("DELETE FROM providers", [])
            .map_err(|error| error.to_string())?;
        conn.execute("DELETE FROM assistants WHERE is_preset = 0", [])
            .map_err(|error| error.to_string())?;
        for key in EXPORTABLE_SETTINGS {
            conn.execute(
                "DELETE FROM settings WHERE key = ?1",
                rusqlite::params![key],
            )
            .map_err(|error| error.to_string())?;
        }
    }

    let mut imported_providers = 0_usize;
    let mut imported_assistants = 0_usize;
    let mut imported_settings = 0_usize;

    for provider in &payload.providers {
        let id = uuid::Uuid::new_v4().to_string();
        let models = serde_json::to_string(&provider.models).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_default, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))",
            rusqlite::params![
                id,
                provider.name,
                provider.api_type,
                provider.base_url,
                provider.api_key,
                models,
                if provider.is_default { 1 } else { 0 },
            ],
        )
        .map_err(|error| error.to_string())?;
        imported_providers += 1;
    }

    for setting in &payload.settings {
        if EXPORTABLE_SETTINGS.contains(&setting.key.as_str()) {
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                rusqlite::params![setting.key, setting.value],
            )
            .map_err(|error| error.to_string())?;
            imported_settings += 1;
        }
    }

    for assistant in &payload.assistants {
        let id = if assistant.id.trim().is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            assistant.id.clone()
        };
        conn.execute(
            "INSERT OR REPLACE INTO assistants (id, name, description, system_prompt, icon, is_preset, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
            rusqlite::params![
                id,
                assistant.name,
                assistant.description,
                assistant.system_prompt,
                assistant.icon,
                assistant.created_at,
                assistant.updated_at,
            ],
        )
        .map_err(|error| error.to_string())?;
        imported_assistants += 1;
    }

    Ok(ImportConfigResult {
        providers: imported_providers,
        assistants: imported_assistants,
        settings: imported_settings,
    })
}

#[cfg(test)]
mod tests {
    use super::{decrypt, encrypt, FILE_VERSION, MAGIC, NONCE_LEN, SALT_LEN};

    #[test]
    fn encrypt_then_decrypt_roundtrip_recovers_plaintext() {
        let plaintext = b"{\"hello\":\"world\",\"n\":42}";
        let password = "correct horse battery staple";

        let cipher = encrypt(plaintext, password).expect("encrypt");
        let recovered = decrypt(&cipher, password).expect("decrypt");

        assert_eq!(recovered, plaintext);
    }

    #[test]
    fn encrypt_output_starts_with_magic_and_version_header() {
        let cipher = encrypt(b"payload", "pw").expect("encrypt");
        assert!(
            cipher.starts_with(MAGIC),
            "ciphertext must start with magic header"
        );
        assert_eq!(cipher[4], FILE_VERSION);
        assert!(
            cipher.len() > 4 + 1 + SALT_LEN + NONCE_LEN,
            "ciphertext must include salt + nonce + AEAD output"
        );
    }

    #[test]
    fn encrypt_produces_unique_salt_and_nonce_per_call() {
        let a = encrypt(b"same input", "same pw").expect("encrypt a");
        let b = encrypt(b"same input", "same pw").expect("encrypt b");
        assert_ne!(
            a, b,
            "encrypt must randomize salt + nonce so the same input yields different ciphertexts",
        );
    }

    #[test]
    fn decrypt_rejects_wrong_password_with_clear_error() {
        let cipher = encrypt(b"secret", "right-pw").expect("encrypt");
        let error = decrypt(&cipher, "wrong-pw").expect_err("must fail");
        assert!(
            error.contains("Decryption failed"),
            "error should mention decryption failure, got: {error}",
        );
    }

    #[test]
    fn decrypt_rejects_truncated_input() {
        let cipher = encrypt(b"secret", "pw").expect("encrypt");
        let truncated = &cipher[..10];
        let error = decrypt(truncated, "pw").expect_err("must fail on short input");
        assert!(error.contains("too short"), "got: {error}");
    }

    #[test]
    fn decrypt_rejects_bad_magic_header() {
        let mut cipher = encrypt(b"secret", "pw").expect("encrypt");
        cipher[0] = b'X';
        let error = decrypt(&cipher, "pw").expect_err("must fail on bad magic");
        assert!(error.contains("bad magic"), "got: {error}");
    }

    #[test]
    fn decrypt_rejects_unsupported_version() {
        let mut cipher = encrypt(b"secret", "pw").expect("encrypt");
        cipher[4] = FILE_VERSION + 99;
        let error = decrypt(&cipher, "pw").expect_err("must fail on bad version");
        assert!(error.contains("Unsupported backup version"), "got: {error}");
    }

    #[test]
    fn decrypt_rejects_tampered_ciphertext() {
        let mut cipher = encrypt(b"secret", "pw").expect("encrypt");
        let last_index = cipher.len() - 1;
        cipher[last_index] ^= 0xFF;
        let error = decrypt(&cipher, "pw").expect_err("AEAD tag must reject tampering");
        assert!(error.contains("Decryption failed"), "got: {error}");
    }
}
