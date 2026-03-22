use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use crate::acp::client::{AcpClientEntry, AcpState};
use crate::db::DbState;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use tokio::sync::Mutex;

/// Per-conversation stop flags for HTTP streaming.
/// Each conversation gets its own AtomicBool so stopping one doesn't affect others.
fn http_stop_flags() -> &'static std::sync::Mutex<HashMap<String, Arc<AtomicBool>>> {
    static FLAGS: OnceLock<std::sync::Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    FLAGS.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

/// Get or create a stop flag for a specific conversation.
fn get_stop_flag(conversation_id: &str) -> Arc<AtomicBool> {
    let mut flags = http_stop_flags().lock().unwrap();
    flags
        .entry(conversation_id.to_string())
        .or_insert_with(|| Arc::new(AtomicBool::new(false)))
        .clone()
}

/// Cached CLI availability check (checked once per app session).
static CLI_AVAILABLE_CACHE: OnceLock<bool> = OnceLock::new();

// ── Tauri event payloads (same shape as chat.rs) ──

#[derive(Clone, Serialize)]
struct StreamChunkPayload {
    conversation_id: String,
    content: String,
}

#[derive(Clone, Serialize)]
struct StreamDonePayload {
    conversation_id: String,
    message_id: String,
    full_content: String,
}

#[derive(Clone, Serialize)]
struct StreamErrorPayload {
    conversation_id: String,
    error: String,
}

// ── OpenClaw Instance CRUD ──

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenClawInstance {
    pub id: String,
    pub name: String,
    pub gateway_url: String,
    pub token: String,
    pub agents_cache: String,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn list_openclaw_instances(db: State<DbState>) -> Result<Vec<OpenClawInstance>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, gateway_url, token, agents_cache, created_at, updated_at FROM openclaw_instances ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(OpenClawInstance {
                id: row.get(0)?,
                name: row.get(1)?,
                gateway_url: row.get(2)?,
                token: row.get(3)?,
                agents_cache: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut instances = Vec::new();
    for row in rows {
        instances.push(row.map_err(|e| e.to_string())?);
    }
    Ok(instances)
}

/// Issue #5 fix: validate openclaw CLI is available before creating instance.
/// `skip_cli_check`: set true when adding a remote instance via connection string
/// (the user's machine may not have the CLI installed).
#[tauri::command]
pub async fn create_openclaw_instance(
    db: State<'_, DbState>,
    name: String,
    gateway_url: String,
    token: String,
    skip_cli_check: Option<bool>,
    agents_cache: Option<String>,
) -> Result<OpenClawInstance, String> {
    if !skip_cli_check.unwrap_or(false) {
        // Validate that the openclaw CLI is available
        let cli_check = tokio::process::Command::new("openclaw")
            .arg("--version")
            .output()
            .await;

        match cli_check {
            Ok(output) if output.status.success() => {}
            Ok(_) => {
                return Err(
                    "openclaw CLI found but returned an error. Please check your installation."
                        .to_string(),
                );
            }
            Err(_) => {
                return Err(
                    "openclaw CLI not found. Please install openclaw first: https://openclaw.dev"
                        .to_string(),
                );
            }
        }
    }

    let agents_json = agents_cache.unwrap_or_else(|| "[]".to_string());
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO openclaw_instances (id, name, gateway_url, token, agents_cache, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, name, gateway_url, token, agents_json, now, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(OpenClawInstance {
        id,
        name,
        gateway_url,
        token,
        agents_cache: agents_json,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_openclaw_instance(
    db: State<DbState>,
    id: String,
    name: String,
    gateway_url: String,
    token: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "UPDATE openclaw_instances SET name = ?1, gateway_url = ?2, token = ?3, updated_at = ?4 WHERE id = ?5",
        rusqlite::params![name, gateway_url, token, now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_openclaw_instance(
    db: State<'_, DbState>,
    acp_state: State<'_, AcpState>,
    id: String,
) -> Result<(), String> {
    // Collect conversation IDs using this instance (drop DB lock before async)
    let conv_ids = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id FROM conversations WHERE openclaw_instance_id = ?1 AND deleted_at IS NULL")
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt
            .query_map(rusqlite::params![id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        ids
    };

    // Kill any ACP processes using this instance
    {
        let mut clients = acp_state.clients.lock().await;
        for conv_id in &conv_ids {
            if let Some(entry_arc) = clients.remove(conv_id) {
                let mut entry = entry_arc.lock().await;
                entry.client.kill().await;
            }
        }
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM openclaw_instances WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Local OpenClaw Detection ──

#[derive(Debug, Serialize)]
pub struct LocalOpenClawDetection {
    pub cli_available: bool,
    pub cli_version: Option<String>,
    pub config_dir_exists: bool,
    pub gateway_url: Option<String>,
    pub gateway_token: Option<String>,
    pub gateway_running: bool,
}

#[tauri::command]
pub async fn detect_local_openclaw() -> Result<LocalOpenClawDetection, String> {
    let mut detection = LocalOpenClawDetection {
        cli_available: false,
        cli_version: None,
        config_dir_exists: false,
        gateway_url: None,
        gateway_token: None,
        gateway_running: false,
    };

    // 1. Check CLI availability
    if let Ok(output) = tokio::process::Command::new("openclaw")
        .arg("--version")
        .output()
        .await
    {
        if output.status.success() {
            detection.cli_available = true;
            detection.cli_version =
                Some(String::from_utf8_lossy(&output.stdout).trim().to_string());
        }
    }

    // 2. Check config directory
    if let Some(home) = dirs::home_dir() {
        let config_dir = home.join(".openclaw");
        detection.config_dir_exists = config_dir.exists();

        // Try to read gateway config
        let config_file = config_dir.join("config.json");
        if config_file.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&config_file).await {
                if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(url) = config.get("gateway_url").and_then(|v| v.as_str()) {
                        detection.gateway_url = Some(url.to_string());
                    }
                    if let Some(token) = config.get("token").and_then(|v| v.as_str()) {
                        detection.gateway_token = Some(token.to_string());
                    }
                }
            }
        }
    }

    // 3. Check environment variable for token
    if detection.gateway_token.is_none() {
        if let Ok(token) = std::env::var("OPENCLAW_GATEWAY_TOKEN") {
            if !token.is_empty() {
                detection.gateway_token = Some(token);
            }
        }
    }

    // 4. Default gateway URL if not found in config
    let gateway_url = detection
        .gateway_url
        .clone()
        .unwrap_or_else(|| "ws://127.0.0.1:18789".to_string());
    detection.gateway_url = Some(gateway_url.clone());

    // 5. Health check — try HTTP on same host/port
    let health_url = gateway_url
        .replace("ws://", "http://")
        .replace("wss://", "https://");
    let health_url = format!("{}/health", health_url.trim_end_matches('/'));

    if let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    {
        if let Ok(resp) = client.get(&health_url).send().await {
            detection.gateway_running = resp.status().is_success();
        }
    }

    Ok(detection)
}

// ── Connection String ──

/// Payload inside a `ptalk:` connection string.
#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectionStringPayload {
    #[serde(default)]
    pub v: u32,
    pub url: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub agents: Option<Vec<ConnectionStringAgent>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionStringAgent {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub model: String,
    #[serde(default, rename = "isDefault")]
    pub is_default: bool,
}

/// Parse a `ptalk:<base64>` connection string and return the decoded payload.
#[tauri::command]
pub fn parse_connection_string(input: String) -> Result<ConnectionStringPayload, String> {
    let input = input.trim();
    if input.len() > 4096 {
        return Err("Connection string is too long".to_string());
    }

    let b64 = input
        .strip_prefix("ptalk:")
        .ok_or("Invalid connection string: must start with 'ptalk:'")?;

    use base64::Engine;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(b64)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    let payload: ConnectionStringPayload =
        serde_json::from_slice(&bytes).map_err(|e| format!("Failed to parse JSON: {}", e))?;

    if payload.url.is_empty() {
        return Err("Connection string missing 'url' field".to_string());
    }
    if !payload.url.starts_with("ws://") && !payload.url.starts_with("wss://") {
        return Err("Connection string 'url' must use ws:// or wss://".to_string());
    }

    Ok(payload)
}

// ── Helpers ──

/// Strip ANSI escape sequences (e.g. \x1b[35m) from a string.
fn strip_ansi_codes(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // Skip the '[' and then all digits/semicolons until a letter
            if let Some('[') = chars.next() {
                loop {
                    match chars.next() {
                        Some(c) if c.is_ascii_alphabetic() => break,
                        Some(_) => continue,
                        None => break,
                    }
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}

// ── Agent Listing ──

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenClawAgent {
    pub id: String,
    pub name: String,
    pub model: String,
    pub is_default: bool,
    pub emoji: Option<String>,
    pub avatar: Option<String>,
    pub description: Option<String>,
}

/// Raw JSON shape from `openclaw agents list --json`
#[derive(Debug, Deserialize)]
struct RawOpenClawAgent {
    id: String,
    name: String,
    #[serde(default)]
    model: String,
    #[serde(default, rename = "isDefault")]
    is_default: bool,
    #[serde(default)]
    workspace: Option<String>,
}

/// Parse IDENTITY.md to extract avatar, emoji, and description fields.
fn parse_identity_md(content: &str) -> (Option<String>, Option<String>, Option<String>) {
    let mut avatar = None;
    let mut emoji = None;
    let mut description = None;
    for line in content.lines() {
        let trimmed = line.trim().trim_start_matches("- ");
        if let Some(val) = trimmed.strip_prefix("**Avatar:**") {
            let v = val.trim();
            if !v.is_empty() {
                avatar = Some(v.to_string());
            }
        } else if let Some(val) = trimmed.strip_prefix("**Emoji:**") {
            let v = val.trim();
            if !v.is_empty() {
                emoji = Some(v.to_string());
            }
        } else if let Some(val) = trimmed.strip_prefix("**Description:**") {
            let v = val.trim();
            if !v.is_empty() {
                description = Some(v.to_string());
            }
        }
    }
    (avatar, emoji, description)
}

#[tauri::command]
pub async fn list_openclaw_agents(
    db: State<'_, DbState>,
    gateway_url: String,
    token: String,
    instance_id: Option<String>,
) -> Result<Vec<OpenClawAgent>, String> {
    // Try CLI first
    if let Ok(agents) = list_agents_via_cli(&gateway_url, &token).await {
        // Update cache in DB if we have an instance_id
        if let Some(ref iid) = instance_id {
            if let Ok(json) = serde_json::to_string(&agents) {
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                let _ = conn.execute(
                    "UPDATE openclaw_instances SET agents_cache = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![json, chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(), iid],
                );
            }
        }
        return Ok(agents);
    }

    // CLI not available — return cached agents from instance
    if let Some(ref iid) = instance_id {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let cache: String = conn
            .query_row(
                "SELECT agents_cache FROM openclaw_instances WHERE id = ?1",
                rusqlite::params![iid],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "[]".to_string());
        let agents: Vec<OpenClawAgent> = serde_json::from_str(&cache).unwrap_or_default();
        if !agents.is_empty() {
            return Ok(agents);
        }
    }

    Err("Unable to list agents: openclaw CLI not available and no cached agents found. Re-generate the connection string on the remote server to include agents.".to_string())
}

/// List agents using the local `openclaw` CLI.
async fn list_agents_via_cli(
    gateway_url: &str,
    token: &str,
) -> Result<Vec<OpenClawAgent>, String> {
    let mut cmd = tokio::process::Command::new("openclaw");
    cmd.arg("agents").arg("list");
    if !gateway_url.is_empty() {
        cmd.arg("--url").arg(gateway_url);
    }
    if !token.is_empty() {
        cmd.arg("--token").arg(token);
    }
    cmd.arg("--json");

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run 'openclaw agents list': {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("openclaw agents list failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let cleaned = strip_ansi_codes(&stdout);
    let json_start = cleaned.find("\n[").map(|i| i + 1)
        .or_else(|| if cleaned.starts_with('[') { Some(0) } else { None })
        .ok_or_else(|| {
            format!("No JSON array found in openclaw output: {}", cleaned.chars().take(200).collect::<String>())
        })?;
    let raw_agents: Vec<RawOpenClawAgent> = serde_json::from_str(&cleaned[json_start..])
        .map_err(|e| format!("Failed to parse agents list: {}", e))?;

    let mut agents = Vec::with_capacity(raw_agents.len());
    for raw in raw_agents {
        let (avatar, emoji, description) = if let Some(ref ws) = raw.workspace {
            let identity_path = std::path::Path::new(ws).join("IDENTITY.md");
            match tokio::fs::read_to_string(&identity_path).await {
                Ok(content) => parse_identity_md(&content),
                Err(_) => (None, None, None),
            }
        } else {
            (None, None, None)
        };
        agents.push(OpenClawAgent {
            id: raw.id,
            name: raw.name,
            model: raw.model,
            is_default: raw.is_default,
            emoji,
            avatar,
            description,
        });
    }
    Ok(agents)
}

// ── OpenClaw Chat ──

#[tauri::command]
pub async fn send_openclaw_message(
    app: tauri::AppHandle,
    db: State<'_, DbState>,
    acp_state: State<'_, AcpState>,
    conversation_id: String,
    content: String,
    user_msg_id: String,
    attachment_ids: Option<Vec<String>>,
) -> Result<(), String> {
    // Parse prepared attachments from JSON strings
    let prepared_attachments: Vec<crate::attachments::PreparedAttachment> = attachment_ids
        .as_ref()
        .map(|ids| {
            ids.iter()
                .filter_map(|json| serde_json::from_str(json).ok())
                .collect()
        })
        .unwrap_or_default();

    // Save user message (ID provided by frontend for consistency)
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // Load conversation OpenClaw fields
    let (instance_id, agent_id, session_key) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, 'user', ?3, ?4)",
            rusqlite::params![user_msg_id, conversation_id, content, now],
        )
        .map_err(|e| e.to_string())?;

        // Link attachments to this message
        for att in &prepared_attachments {
            crate::attachments::save_attachment(&conn, att, &user_msg_id)?;
        }

        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, conversation_id],
        )
        .map_err(|e| e.to_string())?;

        let row: (Option<String>, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT openclaw_instance_id, openclaw_agent_id, openclaw_session_key FROM conversations WHERE id = ?1",
                rusqlite::params![conversation_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|e| format!("Conversation not found: {}", e))?;
        row
    };

    let instance_id = instance_id.ok_or("Conversation has no OpenClaw instance")?;
    let agent_id = agent_id.ok_or("Conversation has no OpenClaw agent")?;
    let session_key = session_key.ok_or("Conversation has no OpenClaw session key")?;

    // Load instance info
    let (gateway_url, token) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT gateway_url, token FROM openclaw_instances WHERE id = ?1",
            rusqlite::params![instance_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|e| format!("OpenClaw instance not found: {}", e))?
    };

    // Try ACP (local CLI) first; if it fails, use HTTP API
    let has_acp = acp_state.clients.lock().await.contains_key(&conversation_id);
    let cli_available = has_acp || cli_is_available().await;

    if cli_available {
        send_via_acp(
            &app, &db, &acp_state,
            &conversation_id, &content, &prepared_attachments,
            &gateway_url, &token, &agent_id, &session_key,
        )
        .await
    } else {
        send_via_http(
            &app, &db,
            &conversation_id, &content, &prepared_attachments,
            &gateway_url, &token, &agent_id, &session_key,
        )
        .await
    }
}

/// Check if openclaw CLI is available (cached for app session).
async fn cli_is_available() -> bool {
    if let Some(&cached) = CLI_AVAILABLE_CACHE.get() {
        return cached;
    }
    let available = tokio::process::Command::new("openclaw")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false);
    let _ = CLI_AVAILABLE_CACHE.set(available);
    available
}

/// Build ACP content blocks from text + attachments.
fn build_acp_content_blocks(
    content: &str,
    attachments: &[crate::attachments::PreparedAttachment],
) -> Vec<crate::acp::types::ContentBlock> {
    use crate::acp::types::{ContentBlock, EmbeddedResource};

    let mut blocks = Vec::new();
    if !content.is_empty() {
        blocks.push(ContentBlock::Text { text: content.to_string() });
    }

    for att in attachments {
        match att.file_type.as_str() {
            "image" => {
                if let Ok((b64, mime)) = crate::attachments::read_image_as_base64(&att.file_path) {
                    blocks.push(ContentBlock::Image {
                        data: b64,
                        mime_type: mime,
                    });
                }
            }
            "text_file" => {
                if let Ok(file_content) = crate::attachments::read_text_file_content(&att.file_path) {
                    blocks.push(ContentBlock::Resource {
                        resource: EmbeddedResource {
                            uri: format!("file://{}", att.file_name),
                            mime_type: Some(att.mime_type.clone()),
                            text: Some(file_content),
                            blob: None,
                        },
                    });
                }
            }
            _ => {}
        }
    }

    if blocks.is_empty() {
        blocks.push(ContentBlock::Text { text: String::new() });
    }

    blocks
}

/// Send via ACP subprocess (local CLI).
async fn send_via_acp(
    app: &tauri::AppHandle,
    db: &State<'_, DbState>,
    acp_state: &State<'_, AcpState>,
    conversation_id: &str,
    content: &str,
    prepared_attachments: &[crate::attachments::PreparedAttachment],
    gateway_url: &str,
    token: &str,
    agent_id: &str,
    session_key: &str,
) -> Result<(), String> {
    let emit_error = |e: &str| {
        let _ = app.emit(
            "chat-stream-error",
            StreamErrorPayload {
                conversation_id: conversation_id.to_string(),
                error: e.to_string(),
            },
        );
    };

    let entry_arc = {
        let clients = acp_state.clients.lock().await;
        if let Some(existing) = clients.get(conversation_id) {
            existing.clone()
        } else {
            drop(clients);

            let mut client = crate::acp::client::AcpClient::start(
                gateway_url, token, agent_id, session_key,
            )
            .await
            .map_err(|e| { emit_error(&e); e })?;

            client.initialize().await.map_err(|e| { emit_error(&e); e })?;
            let acp_session_id = client.new_session().await.map_err(|e| { emit_error(&e); e })?;

            let new_entry = Arc::new(Mutex::new(AcpClientEntry {
                client,
                acp_session_id,
            }));

            let mut clients = acp_state.clients.lock().await;
            clients
                .entry(conversation_id.to_string())
                .or_insert_with(|| new_entry.clone());
            clients.get(conversation_id).unwrap().clone()
        }
    };

    // Build content blocks: text + attachments
    let content_blocks = build_acp_content_blocks(content, prepared_attachments);

    let assistant_msg_id = uuid::Uuid::new_v4().to_string();
    let result = {
        let mut entry = entry_arc.lock().await;
        let session_id = entry.acp_session_id.clone();
        entry
            .client
            .prompt(&session_id, content_blocks, conversation_id, &assistant_msg_id, app)
            .await
    };

    // prompt() now handles error events internally (emits chat-stream-error/done).
    // Save content to DB on success or partial content on error.
    let full_content = match result {
        Ok(content) => content,
        Err(e) => {
            // prompt() already emitted events; just propagate
            return Err(e);
        }
    };

    if !full_content.is_empty() {
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, 'assistant', ?3, ?4)",
            rusqlite::params![assistant_msg_id, conversation_id, full_content, now],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Send via OpenAI-compatible HTTP API (no CLI needed).
async fn send_via_http(
    app: &tauri::AppHandle,
    db: &State<'_, DbState>,
    conversation_id: &str,
    _content: &str,
    prepared_attachments: &[crate::attachments::PreparedAttachment],
    gateway_url: &str,
    token: &str,
    agent_id: &str,
    session_key: &str,
) -> Result<(), String> {
    use crate::llm::provider::{stream_chat_with_headers, StreamItem};
    use crate::llm::types::{ChatContent, ChatContentPart, ChatMessage, ImageUrlDetail};

    let stop_flag = get_stop_flag(conversation_id);
    stop_flag.store(false, Ordering::SeqCst);

    // Convert ws:// to http:// for the REST API
    let base_url = gateway_url
        .replace("ws://", "http://")
        .replace("wss://", "https://");
    let model = format!("agent:{}", agent_id);

    // Build message history from DB
    let mut messages = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT role, content FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC")
            .map_err(|e| e.to_string())?;
        let msgs: Vec<ChatMessage> = stmt
            .query_map(rusqlite::params![conversation_id], |row| {
                Ok(ChatMessage {
                    role: row.get(0)?,
                    content: ChatContent::text(row.get::<_, String>(1)?),
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        msgs
    };

    // Inject attachment content into the last user message (same logic as chat.rs)
    if !prepared_attachments.is_empty() {
        if let Some(last_user) = messages.iter_mut().rev().find(|m| m.role == "user") {
            let text = last_user.content.as_text().to_string();
            let mut parts: Vec<ChatContentPart> = vec![ChatContentPart::Text { text }];

            for att in prepared_attachments {
                match att.file_type.as_str() {
                    "image" => {
                        if let Ok((b64, mime)) = crate::attachments::read_image_as_base64(&att.file_path) {
                            parts.push(ChatContentPart::ImageUrl {
                                image_url: ImageUrlDetail {
                                    url: format!("data:{};base64,{}", mime, b64),
                                    detail: Some("auto".to_string()),
                                },
                            });
                        }
                    }
                    "text_file" => {
                        if let Ok(file_content) = crate::attachments::read_text_file_content(&att.file_path) {
                            parts.push(ChatContentPart::Text {
                                text: format!(
                                    "--- File: {} ---\n{}\n--- End of file ---",
                                    att.file_name, file_content
                                ),
                            });
                        }
                    }
                    _ => {}
                }
            }

            last_user.content = ChatContent::Multipart(parts);
        }
    }

    let extra_headers = vec![
        ("x-openclaw-session-key".to_string(), session_key.to_string()),
    ];

    let mut rx = stream_chat_with_headers(
        &base_url, token, &model, messages, None, Some(extra_headers),
    )
    .await
    .map_err(|e| {
        // Don't emit chat-stream-error here — the invoke error
        // propagates to the frontend catch block, avoiding double-error.
        e
    })?;

    let assistant_msg_id = uuid::Uuid::new_v4().to_string();
    let mut full_content = String::new();
    let mut had_error = false;

    while let Some(chunk) = rx.recv().await {
        if stop_flag.load(Ordering::SeqCst) {
            break;
        }
        match chunk {
            Ok(item) => match item {
                StreamItem::Content(text) => {
                    full_content.push_str(&text);
                    let _ = app.emit(
                        "chat-stream-chunk",
                        StreamChunkPayload {
                            conversation_id: conversation_id.to_string(),
                            content: text,
                        },
                    );
                }
                StreamItem::Usage(_) => {}
            },
            Err(e) => {
                had_error = true;
                let _ = app.emit(
                    "chat-stream-error",
                    StreamErrorPayload {
                        conversation_id: conversation_id.to_string(),
                        error: e,
                    },
                );
                break;
            }
        }
    }

    if !had_error || !full_content.is_empty() {
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, 'assistant', ?3, ?4)",
            rusqlite::params![assistant_msg_id, conversation_id, full_content, now],
        )
        .map_err(|e| e.to_string())?;

        let _ = app.emit(
            "chat-stream-done",
            StreamDonePayload {
                conversation_id: conversation_id.to_string(),
                message_id: assistant_msg_id,
                full_content,
            },
        );
    }

    // Clean up stop flag to avoid memory leak
    if let Ok(mut flags) = http_stop_flags().lock() {
        flags.remove(conversation_id);
    }

    Ok(())
}

#[tauri::command]
pub async fn stop_openclaw_generation(
    acp_state: State<'_, AcpState>,
    conversation_id: String,
) -> Result<(), String> {
    // Set HTTP stop flag for this specific conversation
    get_stop_flag(&conversation_id).store(true, Ordering::SeqCst);

    // Also try ACP cancel (for conversations using CLI subprocess)
    let entry_arc = {
        let clients = acp_state.clients.lock().await;
        clients.get(&conversation_id).cloned()
    };
    if let Some(entry_arc) = entry_arc {
        let mut entry = entry_arc.lock().await;
        let session_id = entry.acp_session_id.clone();
        entry.client.cancel(&session_id).await?;
    }
    Ok(())
}

/// Kill ACP process for a conversation (called when deleting a conversation).
pub async fn kill_acp_for_conversation(acp_state: &AcpState, conversation_id: &str) {
    let entry_arc = {
        let mut clients = acp_state.clients.lock().await;
        clients.remove(conversation_id)
    };
    if let Some(entry_arc) = entry_arc {
        let mut entry = entry_arc.lock().await;
        entry.client.kill().await;
    }
}
