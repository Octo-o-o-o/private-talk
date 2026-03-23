use crate::db::DbState;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::time::Duration;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub api_type: String,
    pub base_url: String,
    pub api_key: String,
    pub models: Vec<String>,
    pub is_default: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderModelDiscovery {
    pub models: Vec<String>,
    pub discovered: bool,
    pub endpoint: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalProviderScanResult {
    pub framework: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub models: Vec<String>,
    pub detection: String,
}

#[derive(Default)]
struct ProcessHints {
    mlx: bool,
    vllm: bool,
    llama_cpp: bool,
    local_ai: bool,
}

struct LocalProbe<'a> {
    framework: &'a str,
    name: &'a str,
    base_url: &'a str,
    discovery_mode: &'a str,
    detection: String,
}

#[tauri::command]
pub fn list_providers(db: State<DbState>) -> Result<Vec<Provider>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, api_type, base_url, api_key, models, is_default, created_at FROM providers ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let models_json: String = row.get(5)?;
            let models: Vec<String> = serde_json::from_str(&models_json).unwrap_or_default();
            let is_default: i32 = row.get(6)?;
            Ok(Provider {
                id: row.get(0)?,
                name: row.get(1)?,
                api_type: row.get(2)?,
                base_url: row.get(3)?,
                api_key: row.get(4)?,
                models,
                is_default: is_default != 0,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_provider(
    db: State<DbState>,
    name: String,
    base_url: String,
    api_key: String,
    models: Vec<String>,
) -> Result<Provider, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let models_json = serde_json::to_string(&models).map_err(|e| e.to_string())?;

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM providers", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let is_default = count == 0;

    conn.execute(
        "INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_default, created_at) VALUES (?1, ?2, 'openai-compatible', ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, name, base_url, api_key, models_json, is_default as i32, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(Provider {
        id,
        name,
        api_type: "openai-compatible".to_string(),
        base_url,
        api_key,
        models,
        is_default,
        created_at: now,
    })
}

#[tauri::command]
pub fn update_provider(
    db: State<DbState>,
    id: String,
    name: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    models: Option<Vec<String>>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if let Some(name) = name {
        conn.execute(
            "UPDATE providers SET name = ?1 WHERE id = ?2",
            rusqlite::params![name, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(base_url) = base_url {
        conn.execute(
            "UPDATE providers SET base_url = ?1 WHERE id = ?2",
            rusqlite::params![base_url, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(api_key) = api_key {
        conn.execute(
            "UPDATE providers SET api_key = ?1 WHERE id = ?2",
            rusqlite::params![api_key, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(models) = models {
        let models_json = serde_json::to_string(&models).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE providers SET models = ?1 WHERE id = ?2",
            rusqlite::params![models_json, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_provider(db: State<DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM providers WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_default_provider(db: State<DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE providers SET is_default = 0", [])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE providers SET is_default = 1 WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn discover_provider_models(
    base_url: String,
    api_key: Option<String>,
    discovery_mode: String,
) -> Result<ProviderModelDiscovery, String> {
    let client = build_probe_client()?;

    let (endpoint, models) = match discovery_mode.as_str() {
        "ollama" => discover_ollama_models_internal(&client, &base_url).await?,
        "openai-compatible" => {
            let endpoint = format!("{}/models", base_url.trim_end_matches('/'));
            let models =
                discover_openai_models_internal(&client, &base_url, api_key.as_deref()).await?;
            (endpoint, models)
        }
        _ => return Err(format!("Unsupported discovery mode: {}", discovery_mode)),
    };

    Ok(ProviderModelDiscovery {
        discovered: true,
        endpoint,
        models,
    })
}

#[tauri::command]
pub async fn scan_local_providers() -> Result<Vec<LocalProviderScanResult>, String> {
    let client = build_probe_client()?;
    let hints = collect_process_hints();

    let mut results = Vec::new();
    let probes = build_local_probes(&hints);

    for probe in probes {
        let discovery = match probe.discovery_mode {
            "ollama" => discover_ollama_models_internal(&client, probe.base_url).await,
            "openai-compatible" => {
                let endpoint = format!("{}/models", probe.base_url.trim_end_matches('/'));
                discover_openai_models_internal(&client, probe.base_url, None)
                    .await
                    .map(|models| (endpoint, models))
            }
            _ => continue,
        };

        if let Ok((_, models)) = discovery {
            results.push(LocalProviderScanResult {
                framework: probe.framework.to_string(),
                name: probe.name.to_string(),
                base_url: probe.base_url.to_string(),
                api_key: String::new(),
                models,
                detection: probe.detection,
            });
        }
    }

    Ok(results)
}

fn build_probe_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

fn build_local_probes(hints: &ProcessHints) -> Vec<LocalProbe<'static>> {
    let mut probes = vec![
        LocalProbe {
            framework: "Ollama",
            name: "Ollama",
            base_url: "http://127.0.0.1:11434/v1",
            discovery_mode: "ollama",
            detection: "default localhost port 11434".to_string(),
        },
        LocalProbe {
            framework: "LM Studio",
            name: "LM Studio",
            base_url: "http://127.0.0.1:1234/v1",
            discovery_mode: "openai-compatible",
            detection: "default localhost port 1234".to_string(),
        },
    ];

    // Port 8000: commonly vLLM
    let (framework_8000, name_8000) = if hints.vllm {
        ("vLLM", "vLLM Local")
    } else {
        ("OpenAI-Compatible Local", "OpenAI-Compatible Local (8000)")
    };
    probes.push(LocalProbe {
        framework: framework_8000,
        name: name_8000,
        base_url: "http://127.0.0.1:8000/v1",
        discovery_mode: "openai-compatible",
        detection: build_detection("default localhost port 8000", hints.vllm, "vllm"),
    });

    // Port 8080: commonly MLX, llama.cpp, or LocalAI
    let (framework_8080, name_8080, process_8080) = if hints.mlx {
        ("MLX", "MLX Local", "mlx")
    } else if hints.llama_cpp {
        ("llama.cpp", "llama.cpp Local", "llama.cpp")
    } else if hints.local_ai {
        ("LocalAI", "LocalAI", "localai")
    } else {
        (
            "OpenAI-Compatible Local",
            "OpenAI-Compatible Local (8080)",
            "",
        )
    };
    probes.push(LocalProbe {
        framework: framework_8080,
        name: name_8080,
        base_url: "http://127.0.0.1:8080/v1",
        discovery_mode: "openai-compatible",
        detection: build_detection(
            "default localhost port 8080",
            !process_8080.is_empty(),
            process_8080,
        ),
    });

    // Port 8090: commonly MLX
    let (framework_8090, name_8090) = if hints.mlx {
        ("MLX", "MLX Local")
    } else {
        ("OpenAI-Compatible Local", "OpenAI-Compatible Local (8090)")
    };
    probes.push(LocalProbe {
        framework: framework_8090,
        name: name_8090,
        base_url: "http://127.0.0.1:8090/v1",
        discovery_mode: "openai-compatible",
        detection: build_detection("default localhost port 8090", hints.mlx, "mlx"),
    });

    probes
}

fn build_detection(base: &str, has_process_hint: bool, process_name: &str) -> String {
    if has_process_hint && !process_name.is_empty() {
        format!("{}, plus process hint '{}'", base, process_name)
    } else {
        base.to_string()
    }
}

async fn discover_openai_models_internal(
    client: &Client,
    base_url: &str,
    api_key: Option<&str>,
) -> Result<Vec<String>, String> {
    let endpoint = format!("{}/models", base_url.trim_end_matches('/'));
    let mut request = client.get(&endpoint);

    if let Some(api_key) = api_key.map(str::trim).filter(|value| !value.is_empty()) {
        request = request.bearer_auth(api_key);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Model discovery request failed for {}: {}", endpoint, e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Model discovery failed for {} with status {}: {}",
            endpoint, status, body
        ));
    }

    let payload: Value = response.json().await.map_err(|e| {
        format!(
            "Failed to parse model discovery response from {}: {}",
            endpoint, e
        )
    })?;

    let data = payload
        .get("data")
        .and_then(|value| value.as_array())
        .ok_or_else(|| {
            format!(
                "Model discovery response from {} did not contain data[]",
                endpoint
            )
        })?;

    let mut models = Vec::new();
    for item in data {
        if let Some(model_id) = item.get("id").and_then(|value| value.as_str()) {
            models.push(model_id.to_string());
        } else if let Some(model_id) = item.as_str() {
            models.push(model_id.to_string());
        }
    }

    Ok(normalize_model_ids(models))
}

async fn discover_ollama_models_internal(
    client: &Client,
    base_url: &str,
) -> Result<(String, Vec<String>), String> {
    let openai_endpoint = format!("{}/models", base_url.trim_end_matches('/'));
    if let Ok(models) = discover_openai_models_internal(client, base_url, None).await {
        return Ok((openai_endpoint, models));
    }

    let host_root = strip_known_suffix(base_url);
    let native_endpoint = format!("{}/api/tags", host_root);
    let response = client.get(&native_endpoint).send().await.map_err(|e| {
        format!(
            "Ollama discovery request failed for {}: {}",
            native_endpoint, e
        )
    })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Ollama discovery failed for {} with status {}: {}",
            native_endpoint, status, body
        ));
    }

    let payload: Value = response.json().await.map_err(|e| {
        format!(
            "Failed to parse Ollama discovery response from {}: {}",
            native_endpoint, e
        )
    })?;

    let models = payload
        .get("models")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get("model")
                        .and_then(|value| value.as_str())
                        .or_else(|| item.get("name").and_then(|value| value.as_str()))
                })
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok((native_endpoint, normalize_model_ids(models)))
}

fn normalize_model_ids(models: Vec<String>) -> Vec<String> {
    let mut unique = BTreeSet::new();
    for model in models {
        let trimmed = model.trim();
        if !trimmed.is_empty() {
            unique.insert(trimmed.to_string());
        }
    }
    unique.into_iter().collect()
}

fn strip_known_suffix(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if let Some(stripped) = trimmed.strip_suffix("/v1") {
        stripped.to_string()
    } else if let Some(stripped) = trimmed.strip_suffix("/api") {
        stripped.to_string()
    } else {
        trimmed.to_string()
    }
}

fn collect_process_hints() -> ProcessHints {
    #[cfg(target_family = "unix")]
    {
        let output = std::process::Command::new("ps")
            .args(["-axo", "command="])
            .output();

        if let Ok(output) = output {
            let commands = String::from_utf8_lossy(&output.stdout).to_lowercase();
            return ProcessHints {
                mlx: commands.contains("mlx_lm") || commands.contains("mlx-lm"),
                vllm: commands.contains("vllm"),
                llama_cpp: commands.contains("llama-server") || commands.contains("llama.cpp"),
                local_ai: commands.contains("localai"),
            };
        }
    }

    ProcessHints::default()
}
