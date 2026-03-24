use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use crate::acp::client::{AcpClientEntry, AcpState};
use crate::db::DbState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
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

/// Build a PATH string that includes common user-level binary locations.
/// macOS GUI apps launched from Finder/Spotlight only get a minimal PATH
/// (/usr/bin:/bin:/usr/sbin:/sbin), missing ~/.local/bin, homebrew paths, etc.
pub fn enriched_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let home = dirs::home_dir().unwrap_or_default();
    let extra_dirs = [
        home.join(".local/bin"),
        home.join("bin"),
        home.join(".cargo/bin"),
        std::path::PathBuf::from("/usr/local/bin"),
        std::path::PathBuf::from("/opt/homebrew/bin"),
    ];
    let mut parts: Vec<String> = extra_dirs
        .iter()
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    parts.push(current);
    parts.join(":")
}

/// Create a `tokio::process::Command` for `openclaw` with an enriched PATH.
fn openclaw_command() -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("openclaw");
    cmd.env("PATH", enriched_path());
    cmd
}

const DEFAULT_LOCAL_GATEWAY_PORT: u16 = 18789;

#[derive(Debug, Clone)]
struct LocalOpenClawProfile {
    gateway_url: String,
    gateway_token: Option<String>,
    chat_completions_enabled: bool,
    agents: Vec<OpenClawAgent>,
}

fn openclaw_state_dir() -> PathBuf {
    if let Ok(path) = std::env::var("OPENCLAW_STATE_DIR") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return expand_home_path(trimmed);
        }
    }

    dirs::home_dir().unwrap_or_default().join(".openclaw")
}

fn openclaw_config_path() -> PathBuf {
    if let Ok(path) = std::env::var("OPENCLAW_CONFIG_PATH") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return expand_home_path(trimmed);
        }
    }

    openclaw_state_dir().join("openclaw.json")
}

fn expand_home_path(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn parse_jsonish_str(content: &str) -> Result<Value, String> {
    serde_json::from_str(content)
        .or_else(|_| json5::from_str(content))
        .map_err(|e| e.to_string())
}

async fn read_jsonish_file(path: &Path) -> Result<Value, String> {
    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    parse_jsonish_str(&content).map_err(|e| format!("Failed to parse {}: {}", path.display(), e))
}

fn value_at_path<'a>(root: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = root;
    for segment in path {
        current = current.get(*segment)?;
    }
    Some(current)
}

fn string_at_path(root: &Value, path: &[&str]) -> Option<String> {
    value_at_path(root, path)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
}

fn bool_at_path(root: &Value, path: &[&str]) -> Option<bool> {
    value_at_path(root, path).and_then(Value::as_bool)
}

fn port_at_path(root: &Value, path: &[&str]) -> Option<u16> {
    value_at_path(root, path)
        .and_then(Value::as_u64)
        .and_then(|port| u16::try_from(port).ok())
}

fn model_from_value(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(model)) => {
            let trimmed = model.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Some(Value::Object(_)) => value
            .and_then(|model| model.get("primary"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string),
        _ => None,
    }
}

fn agents_from_local_config(root: &Value) -> Vec<OpenClawAgent> {
    let default_model = model_from_value(value_at_path(root, &["agents", "defaults", "model"]));

    value_at_path(root, &["agents", "list"])
        .and_then(Value::as_array)
        .map(|agents| {
            agents
                .iter()
                .filter_map(|agent| {
                    let id = agent.get("id")?.as_str()?.trim();
                    if id.is_empty() {
                        return None;
                    }

                    let name = agent
                        .get("name")
                        .and_then(Value::as_str)
                        .or_else(|| agent.pointer("/identity/name").and_then(Value::as_str))
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .unwrap_or(id)
                        .to_string();

                    let model = model_from_value(agent.get("model"))
                        .or_else(|| default_model.clone())
                        .unwrap_or_default();

                    Some(OpenClawAgent {
                        id: id.to_string(),
                        name,
                        model,
                        is_default: agent
                            .get("default")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                        emoji: agent
                            .pointer("/identity/emoji")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(ToString::to_string),
                        avatar: agent
                            .pointer("/identity/avatar")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(ToString::to_string),
                        description: agent
                            .pointer("/identity/description")
                            .or_else(|| agent.get("description"))
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(ToString::to_string),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

async fn resolve_secret_input_string(root: &Value, input: &Value) -> Option<String> {
    match input {
        Value::String(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Object(map) => {
            let source = map.get("source")?.as_str()?.trim();
            let id = map.get("id")?.as_str()?.trim().trim_start_matches('/');
            if id.is_empty() {
                return None;
            }

            match source {
                "env" => std::env::var(id)
                    .ok()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty()),
                "file" => {
                    let provider = map.get("provider")?.as_str()?.trim();
                    resolve_file_secret_value(root, provider, id).await
                }
                _ => None,
            }
        }
        _ => None,
    }
}

async fn resolve_file_secret_value(
    root: &Value,
    provider: &str,
    secret_id: &str,
) -> Option<String> {
    let provider_cfg = value_at_path(root, &["secrets", "providers", provider, "secrets"])?;
    let source = provider_cfg.get("source")?.as_str()?.trim();
    if source != "file" {
        return None;
    }

    let path = expand_home_path(provider_cfg.get("path")?.as_str()?);
    let mode = provider_cfg
        .get("mode")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("json");
    if mode != "json" {
        return None;
    }

    let secrets = read_jsonish_file(&path).await.ok()?;
    secrets
        .get(secret_id)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

async fn load_local_openclaw_profile() -> Result<LocalOpenClawProfile, String> {
    let config_path = openclaw_config_path();
    if config_path.exists() {
        let root = read_jsonish_file(&config_path).await?;
        let port = port_at_path(&root, &["gateway", "port"]).unwrap_or(DEFAULT_LOCAL_GATEWAY_PORT);
        let gateway_token = match value_at_path(&root, &["gateway", "auth", "token"]) {
            Some(value) => resolve_secret_input_string(&root, value).await,
            None => std::env::var("OPENCLAW_GATEWAY_TOKEN")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
        };

        return Ok(LocalOpenClawProfile {
            gateway_url: format!("ws://127.0.0.1:{}", port),
            gateway_token,
            chat_completions_enabled: bool_at_path(
                &root,
                &["gateway", "http", "endpoints", "chatCompletions", "enabled"],
            )
            .unwrap_or(false),
            agents: agents_from_local_config(&root),
        });
    }

    let legacy_config_path = openclaw_state_dir().join("config.json");
    if legacy_config_path.exists() {
        let legacy = read_jsonish_file(&legacy_config_path).await?;
        return Ok(LocalOpenClawProfile {
            gateway_url: string_at_path(&legacy, &["gateway_url"])
                .unwrap_or_else(|| format!("ws://127.0.0.1:{}", DEFAULT_LOCAL_GATEWAY_PORT)),
            gateway_token: string_at_path(&legacy, &["token"]).or_else(|| {
                std::env::var("OPENCLAW_GATEWAY_TOKEN")
                    .ok()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
            }),
            chat_completions_enabled: false,
            agents: Vec::new(),
        });
    }

    Err("Local OpenClaw config not found".to_string())
}

fn gateway_url_is_loopback(gateway_url: &str) -> bool {
    reqwest::Url::parse(gateway_url)
        .ok()
        .and_then(|url| url.host_str().map(|host| host.to_string()))
        .map(|host| host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1")
        .unwrap_or(false)
}

fn gateway_urls_match(lhs: &str, rhs: &str) -> bool {
    let (Ok(lhs), Ok(rhs)) = (reqwest::Url::parse(lhs), reqwest::Url::parse(rhs)) else {
        return false;
    };

    let lhs_host = lhs.host_str().unwrap_or_default();
    let rhs_host = rhs.host_str().unwrap_or_default();
    let lhs_port = lhs.port_or_known_default();
    let rhs_port = rhs.port_or_known_default();

    lhs_port == rhs_port
        && (lhs_host.eq_ignore_ascii_case(rhs_host)
            || (gateway_url_is_loopback(lhs.as_str()) && gateway_url_is_loopback(rhs.as_str())))
}

async fn load_matching_local_openclaw_profile(gateway_url: &str) -> Option<LocalOpenClawProfile> {
    if !gateway_url_is_loopback(gateway_url) {
        return None;
    }

    let profile = load_local_openclaw_profile().await.ok()?;
    if gateway_urls_match(gateway_url, &profile.gateway_url) {
        Some(profile)
    } else {
        None
    }
}

fn persist_instance_hints(
    db: &DbState,
    instance_id: &str,
    token: Option<&str>,
    agents: Option<&[OpenClawAgent]>,
) -> Result<(), String> {
    let token = token
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let agents_json = match agents.filter(|agents| !agents.is_empty()) {
        Some(agents) => Some(serde_json::to_string(agents).map_err(|e| e.to_string())?),
        None => None,
    };

    if token.is_none() && agents_json.is_none() {
        return Ok(());
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    match (token, agents_json) {
        (Some(token), Some(agents_json)) => {
            conn.execute(
                "UPDATE openclaw_instances
                 SET token = CASE WHEN trim(token) = '' THEN ?1 ELSE token END,
                     agents_cache = ?2,
                     updated_at = ?3
                 WHERE id = ?4",
                rusqlite::params![token, agents_json, now, instance_id],
            )
            .map_err(|e| e.to_string())?;
        }
        (Some(token), None) => {
            conn.execute(
                "UPDATE openclaw_instances
                 SET token = CASE WHEN trim(token) = '' THEN ?1 ELSE token END,
                     updated_at = ?2
                 WHERE id = ?3",
                rusqlite::params![token, now, instance_id],
            )
            .map_err(|e| e.to_string())?;
        }
        (None, Some(agents_json)) => {
            conn.execute(
                "UPDATE openclaw_instances SET agents_cache = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![agents_json, now, instance_id],
            )
            .map_err(|e| e.to_string())?;
        }
        (None, None) => {}
    }

    Ok(())
}

fn load_cached_agents(db: &DbState, instance_id: &str) -> Result<Vec<OpenClawAgent>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let cache: String = conn
        .query_row(
            "SELECT agents_cache FROM openclaw_instances WHERE id = ?1",
            rusqlite::params![instance_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "[]".to_string());

    Ok(serde_json::from_str(&cache).unwrap_or_default())
}

async fn gateway_is_reachable(gateway_url: &str) -> bool {
    let gateway_http = gateway_url
        .replace("ws://", "http://")
        .replace("wss://", "https://");
    let health_url = format!("{}/health", gateway_http.trim_end_matches('/'));

    if let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    {
        client
            .get(&health_url)
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false)
    } else {
        false
    }
}

fn is_cli_missing_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("no such file or directory")
        || lower.contains("not found")
        || lower.contains("cannot find")
        || lower.contains("is openclaw installed")
}

fn rewrite_http_fallback_error(error: String) -> String {
    if error.contains("API error 404") || error.contains("404 Not Found") {
        return "OpenClaw Gateway 的 HTTP Chat Completions 端点未启用。请在 openclaw.json 中开启 gateway.http.endpoints.chatCompletions.enabled，或让 Private Talk 继续使用 openclaw CLI / ACP。".to_string();
    }

    if error.contains("401") || error.contains("403") {
        return "OpenClaw Gateway HTTP 回退鉴权失败。请确认本地实例已保存 gateway token，或重新扫描/添加本地 OpenClaw。".to_string();
    }

    error
}

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
    pub is_remote: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn list_openclaw_instances(db: State<DbState>) -> Result<Vec<OpenClawInstance>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, gateway_url, token, agents_cache, is_remote, created_at, updated_at FROM openclaw_instances ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(OpenClawInstance {
                id: row.get(0)?,
                name: row.get(1)?,
                gateway_url: row.get(2)?,
                token: row.get(3)?,
                agents_cache: row.get(4)?,
                is_remote: row.get::<_, i32>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
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
    is_remote: Option<bool>,
    agents_cache: Option<String>,
) -> Result<OpenClawInstance, String> {
    let skip_cli = skip_cli_check.unwrap_or(false);
    // Mobile devices cannot host a local OpenClaw process — always treat as remote.
    #[cfg(mobile)]
    let is_remote = true;
    #[cfg(desktop)]
    let is_remote = is_remote.unwrap_or(skip_cli);

    if !skip_cli {
        // Validate that the openclaw CLI is available
        let cli_check = openclaw_command().arg("--version").output().await;

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

    // Only use local profile for non-remote instances
    let local_profile = if is_remote {
        None
    } else {
        load_matching_local_openclaw_profile(&gateway_url).await
    };
    let effective_token = if token.trim().is_empty() {
        local_profile
            .as_ref()
            .and_then(|profile| profile.gateway_token.clone())
            .unwrap_or_default()
    } else {
        token.trim().to_string()
    };
    let agents_json = match agents_cache.filter(|cache| !cache.trim().is_empty()) {
        Some(cache) => cache,
        None => local_profile
            .as_ref()
            .filter(|profile| !profile.agents.is_empty())
            .and_then(|profile| serde_json::to_string(&profile.agents).ok())
            .unwrap_or_else(|| "[]".to_string()),
    };
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO openclaw_instances (id, name, gateway_url, token, agents_cache, is_remote, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, name, gateway_url, effective_token, agents_json, is_remote as i32, now, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(OpenClawInstance {
        id,
        name,
        gateway_url,
        token: effective_token,
        agents_cache: agents_json,
        is_remote,
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
    let conv_ids: Vec<String> = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id FROM conversations WHERE openclaw_instance_id = ?1 AND deleted_at IS NULL")
            .map_err(|e| e.to_string())?;
        let ids = stmt
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

/// On mobile there is no local OpenClaw CLI or config directory, so return an
/// empty result immediately.  The real detection only runs on desktop.
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

    #[cfg(mobile)]
    {
        return Ok(detection);
    }

    #[cfg(desktop)]
    {
        // 1. Check CLI availability
        if let Ok(output) = openclaw_command().arg("--version").output().await {
            if output.status.success() {
                detection.cli_available = true;
                detection.cli_version =
                    Some(String::from_utf8_lossy(&output.stdout).trim().to_string());
            }
        }

        // 2. Load local config (new openclaw.json first, then legacy config.json)
        let state_dir = openclaw_state_dir();
        detection.config_dir_exists = state_dir.exists();
        if let Ok(profile) = load_local_openclaw_profile().await {
            detection.gateway_url = Some(profile.gateway_url);
            detection.gateway_token = profile.gateway_token;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

fn extract_agents_json_slice(cleaned_output: &str) -> Result<&str, String> {
    let json_start = cleaned_output
        .match_indices("\n[")
        .find_map(|(i, _)| {
            let after = &cleaned_output[i + 2..];
            let first_non_ws = after.trim_start().chars().next();
            if matches!(first_non_ws, Some('{') | Some(']')) {
                Some(i + 1)
            } else {
                None
            }
        })
        .or_else(|| {
            if cleaned_output.starts_with('[') {
                let first_non_ws = cleaned_output[1..].trim_start().chars().next();
                if matches!(first_non_ws, Some('{') | Some(']')) {
                    Some(0)
                } else {
                    None
                }
            } else {
                None
            }
        })
        .ok_or_else(|| {
            format!(
                "No JSON array found in openclaw output: {}",
                cleaned_output.chars().take(200).collect::<String>()
            )
        })?;

    Ok(&cleaned_output[json_start..])
}

#[tauri::command]
pub async fn list_openclaw_agents(
    db: State<'_, DbState>,
    gateway_url: String,
    token: String,
    instance_id: Option<String>,
) -> Result<Vec<OpenClawAgent>, String> {
    // Check if this is a remote instance — skip local profile merging for remote instances
    let is_remote = instance_id
        .as_deref()
        .map(|iid| {
            let conn = db.0.lock().ok()?;
            conn.query_row(
                "SELECT is_remote FROM openclaw_instances WHERE id = ?1",
                rusqlite::params![iid],
                |row| row.get::<_, i32>(0),
            )
            .ok()
            .map(|v| v != 0)
        })
        .flatten()
        .unwrap_or(false);

    let local_profile = if is_remote {
        None
    } else {
        load_matching_local_openclaw_profile(&gateway_url).await
    };
    let effective_token = if token.trim().is_empty() {
        local_profile
            .as_ref()
            .and_then(|profile| profile.gateway_token.clone())
            .unwrap_or_default()
    } else {
        token.trim().to_string()
    };

    if let (Some(iid), Some(profile)) = (instance_id.as_deref(), local_profile.as_ref()) {
        let _ = persist_instance_hints(
            &db,
            iid,
            profile.gateway_token.as_deref(),
            Some(&profile.agents),
        );
    }

    let cli_result = list_agents_via_cli(&gateway_url, &effective_token).await;
    if let Ok(agents) = cli_result {
        if !is_remote {
            if let Some(iid) = instance_id.as_deref() {
                persist_instance_hints(&db, iid, Some(effective_token.as_str()), Some(&agents))?;
            }
        }
        return Ok(agents);
    }
    let cli_error = cli_result.unwrap_err();

    if let Some(profile) = local_profile.as_ref() {
        if !profile.agents.is_empty() {
            if let Some(iid) = instance_id.as_deref() {
                persist_instance_hints(
                    &db,
                    iid,
                    profile.gateway_token.as_deref(),
                    Some(&profile.agents),
                )?;
            }
            return Ok(profile.agents.clone());
        }
    }

    if let Some(iid) = instance_id.as_deref() {
        let agents = load_cached_agents(&db, iid)?;
        if !agents.is_empty() {
            return Ok(agents);
        }
    }

    let gateway_reachable = gateway_is_reachable(&gateway_url).await;

    if is_cli_missing_error(&cli_error) {
        if gateway_reachable {
            return Err("openclaw CLI 未找到，且当前实例没有可用的本地配置或缓存可回退。请安装 openclaw CLI，或重新添加本地 OpenClaw 以写入 token 和 agent cache。".to_string());
        }
        return Err("无法连接：openclaw CLI 未找到且 Gateway 未响应。请确认 Gateway 正在运行，或重新添加该实例。".to_string());
    }

    if gateway_reachable {
        Err(format!(
            "无法通过 openclaw CLI 获取 Agent：{}。Gateway 可达，但本地配置与缓存回退都没有可用结果。",
            cli_error
        ))
    } else {
        Err(format!(
            "无法通过 openclaw CLI 获取 Agent：{}。同时 Gateway 未响应。",
            cli_error
        ))
    }
}

/// List agents using the local `openclaw` CLI.
async fn list_agents_via_cli(gateway_url: &str, token: &str) -> Result<Vec<OpenClawAgent>, String> {
    let mut cmd = openclaw_command();
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
    let json_slice = extract_agents_json_slice(&cleaned)?;
    let raw_agents: Vec<RawOpenClawAgent> = serde_json::from_str(json_slice)
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
    let (gateway_url, token, is_remote) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT gateway_url, token, is_remote FROM openclaw_instances WHERE id = ?1",
            rusqlite::params![instance_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i32>(2)? != 0,
                ))
            },
        )
        .map_err(|e| format!("OpenClaw instance not found: {}", e))?
    };
    // Skip local profile merging for remote instances to avoid connecting to wrong gateway
    let local_profile = if is_remote {
        None
    } else {
        load_matching_local_openclaw_profile(&gateway_url).await
    };
    let effective_token = if token.trim().is_empty() {
        local_profile
            .as_ref()
            .and_then(|profile| profile.gateway_token.clone())
            .unwrap_or_default()
    } else {
        token.trim().to_string()
    };
    if let Some(profile) = local_profile.as_ref() {
        let _ = persist_instance_hints(
            &db,
            &instance_id,
            profile.gateway_token.as_deref(),
            Some(&profile.agents),
        );
    }

    // Try ACP (local CLI) first; if it fails, use HTTP API
    let has_acp = acp_state
        .clients
        .lock()
        .await
        .contains_key(&conversation_id);
    let cli_available = has_acp || cli_is_available().await;

    if cli_available {
        send_via_acp(
            &app,
            &db,
            &acp_state,
            &conversation_id,
            &content,
            &prepared_attachments,
            &gateway_url,
            &effective_token,
            &agent_id,
            &session_key,
        )
        .await
    } else {
        if effective_token.is_empty() {
            return Err("本地 OpenClaw HTTP 回退缺少 gateway token。请重新扫描/添加本地 OpenClaw，或安装 openclaw CLI 以继续走 ACP。".to_string());
        }
        if let Some(profile) = local_profile.as_ref() {
            if !profile.chat_completions_enabled {
                return Err("本地 OpenClaw 未启用 HTTP Chat Completions 回退端点（gateway.http.endpoints.chatCompletions.enabled = true），且当前无法使用 openclaw CLI。请启用该端点，或修复本机 openclaw CLI。".to_string());
            }
        }
        send_via_http(
            &app,
            &db,
            &conversation_id,
            &content,
            &prepared_attachments,
            &gateway_url,
            &effective_token,
            &agent_id,
            &session_key,
        )
        .await
    }
}

/// Check if openclaw CLI is available (cached for app session).
async fn cli_is_available() -> bool {
    if let Some(&cached) = CLI_AVAILABLE_CACHE.get() {
        return cached;
    }
    let available = openclaw_command()
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
        blocks.push(ContentBlock::Text {
            text: content.to_string(),
        });
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
                if let Ok(file_content) = crate::attachments::read_text_file_content(&att.file_path)
                {
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
        blocks.push(ContentBlock::Text {
            text: String::new(),
        });
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

            let mut client =
                crate::acp::client::AcpClient::start(gateway_url, token, agent_id, session_key)
                    .await
                    .map_err(|e| {
                        emit_error(&e);
                        e
                    })?;

            client.initialize().await.map_err(|e| {
                emit_error(&e);
                e
            })?;
            let acp_session_id = client.new_session().await.map_err(|e| {
                emit_error(&e);
                e
            })?;

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
            .prompt(
                &session_id,
                content_blocks,
                conversation_id,
                &assistant_msg_id,
                app,
            )
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
    let base_url = format!("{}/v1", base_url.trim_end_matches('/'));
    let model = format!("agent:{}", agent_id);

    // Build message history from DB
    let mut messages: Vec<ChatMessage> = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT role, content FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC")
            .map_err(|e| e.to_string())?;
        let msgs = stmt
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
                        if let Ok((b64, mime)) =
                            crate::attachments::read_image_as_base64(&att.file_path)
                        {
                            parts.push(ChatContentPart::ImageUrl {
                                image_url: ImageUrlDetail {
                                    url: format!("data:{};base64,{}", mime, b64),
                                    detail: Some("auto".to_string()),
                                },
                            });
                        }
                    }
                    "text_file" => {
                        if let Ok(file_content) =
                            crate::attachments::read_text_file_content(&att.file_path)
                        {
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

    let extra_headers = vec![(
        "x-openclaw-session-key".to_string(),
        session_key.to_string(),
    )];

    let mut rx = stream_chat_with_headers(
        &base_url,
        token,
        &model,
        messages,
        None,
        Some(extra_headers),
    )
    .await
    .map_err(rewrite_http_fallback_error)?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_agents_json_slice_skips_plugin_logs() {
        let output = r#"[plugins] memory-lancedb: plugin registered
[plugins] control-plane: loaded
[
  {
    "id": "main",
    "name": "Alice",
    "model": "anthropic/claude-opus-4-6",
    "isDefault": true
  }
]"#;

        let slice = extract_agents_json_slice(output).expect("json slice");
        let parsed: Vec<RawOpenClawAgent> = serde_json::from_str(slice).expect("agents json");

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "main");
        assert_eq!(parsed[0].name, "Alice");
        assert!(parsed[0].is_default);
    }

    #[test]
    fn agents_from_local_config_uses_identity_fields() {
        let config = serde_json::json!({
            "agents": {
                "defaults": {
                    "model": {
                        "primary": "anthropic/claude-sonnet-4-6"
                    }
                },
                "list": [
                    {
                        "id": "main",
                        "default": true,
                        "identity": {
                            "name": "Alice",
                            "avatar": "https://example.com/alice.png",
                            "emoji": "🦀",
                            "description": "Primary agent"
                        }
                    }
                ]
            }
        });

        let agents = agents_from_local_config(&config);
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].id, "main");
        assert_eq!(agents[0].name, "Alice");
        assert_eq!(agents[0].model, "anthropic/claude-sonnet-4-6");
        assert!(agents[0].is_default);
        assert_eq!(
            agents[0].avatar.as_deref(),
            Some("https://example.com/alice.png")
        );
        assert_eq!(agents[0].emoji.as_deref(), Some("🦀"));
        assert_eq!(agents[0].description.as_deref(), Some("Primary agent"));
    }
}
