use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, Mutex};

use crate::acp::types::*;
use crate::llm::types::{StreamChunkPayload, StreamDonePayload, StreamErrorPayload};

// ── AcpClient ──

pub struct AcpClient {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    next_id: AtomicU64,
    /// Channel to receive parsed messages from the stdout reader task
    rx: mpsc::Receiver<JsonRpcMessage>,
}

impl AcpClient {
    /// Spawn `openclaw acp` and connect stdin/stdout.
    pub async fn start(
        gateway_url: &str,
        token: &str,
        agent_id: &str,
        session_key: &str,
    ) -> Result<Self, String> {
        let session_arg = format!("agent:{}:{}", agent_id, session_key);

        let mut cmd = Command::new("openclaw");
        cmd.env("PATH", crate::commands::openclaw::enriched_path());
        cmd.arg("acp");
        if !gateway_url.is_empty() {
            cmd.arg("--url").arg(gateway_url);
        }
        if !token.is_empty() {
            cmd.arg("--token").arg(token);
        }
        cmd.arg("--session").arg(&session_arg);

        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::null());

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "Failed to spawn 'openclaw acp'. Is openclaw installed? Error: {}",
                e
            )
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or("Failed to capture openclaw stdin")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture openclaw stdout")?;

        // Spawn stdout reader task
        let (tx, rx) = mpsc::channel::<JsonRpcMessage>(64);
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<JsonRpcMessage>(&line) {
                    Ok(msg) => {
                        if tx.send(msg).await.is_err() {
                            break; // receiver dropped
                        }
                    }
                    Err(_) => {
                        // Skip unparseable lines (debug output etc.)
                    }
                }
            }
        });

        Ok(Self {
            child,
            stdin: BufWriter::new(stdin),
            next_id: AtomicU64::new(1),
            rx,
        })
    }

    /// Send a JSON-RPC request and wait for the matching response.
    async fn request(&mut self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = JsonRpcRequest::new(id, method, params);
        let mut line = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("Failed to write to openclaw stdin: {}", e))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("Failed to flush openclaw stdin: {}", e))?;

        // Read messages until we get the response for our id
        loop {
            let msg = self
                .rx
                .recv()
                .await
                .ok_or("openclaw acp process exited unexpectedly")?;

            if msg.is_response() && msg.id == Some(id) {
                if let Some(err) = msg.error {
                    return Err(format!("ACP error: {}", err.message));
                }
                return Ok(msg.result.unwrap_or(Value::Null));
            }
            // Skip notifications that arrive before the response
        }
    }

    /// Send initialize handshake.
    pub async fn initialize(&mut self) -> Result<(), String> {
        let params = serde_json::to_value(InitializeParams {
            protocol_version: 1,
            client_info: ClientInfo {
                name: "private-talk".to_string(),
                version: "1.0.0".to_string(),
            },
            client_capabilities: ClientCapabilities {},
        })
        .map_err(|e| e.to_string())?;

        self.request("initialize", Some(params)).await?;
        Ok(())
    }

    /// Create a new ACP session.
    pub async fn new_session(&mut self) -> Result<String, String> {
        let cwd = std::env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("/"))
            .to_string_lossy()
            .to_string();
        let result = self
            .request(
                "session/new",
                Some(serde_json::json!({
                    "cwd": cwd,
                    "mcpServers": []
                })),
            )
            .await?;
        let session: SessionNewResult = serde_json::from_value(result)
            .map_err(|e| format!("Failed to parse session: {}", e))?;
        Ok(session.session_id)
    }

    /// Send a prompt and stream the response via Tauri events.
    /// This function blocks until the prompt response (final result) arrives.
    pub async fn prompt(
        &mut self,
        acp_session_id: &str,
        content_blocks: Vec<ContentBlock>,
        conversation_id: &str,
        message_id: &str,
        app: &AppHandle,
    ) -> Result<String, String> {
        let params = serde_json::to_value(SessionPromptParams {
            session_id: acp_session_id.to_string(),
            prompt: content_blocks,
        })
        .map_err(|e| e.to_string())?;

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = JsonRpcRequest::new(id, "session/prompt", Some(params));
        let mut line = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("Failed to write prompt: {}", e))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("Failed to flush prompt: {}", e))?;

        let mut full_content = String::new();

        // Read notifications + final response
        let mut had_error = false;
        loop {
            let msg = match self.rx.recv().await {
                Some(msg) => msg,
                None => {
                    // Process died mid-stream
                    had_error = true;
                    let _ = app.emit(
                        "chat-stream-error",
                        StreamErrorPayload {
                            conversation_id: conversation_id.to_string(),
                            error: "openclaw acp process exited during streaming".to_string(),
                        },
                    );
                    break;
                }
            };

            if msg.is_notification() {
                if let Some(method) = &msg.method {
                    if method == "session/update" {
                        if let Some(params) = &msg.params {
                            // ACP sends incremental deltas as agent_message_chunk notifications.
                            // Each chunk contains only the new text fragment.
                            let delta = extract_text_delta(params);
                            if !delta.is_empty() {
                                let _ = app.emit(
                                    "chat-stream-chunk",
                                    StreamChunkPayload {
                                        conversation_id: conversation_id.to_string(),
                                        content: delta.clone(),
                                    },
                                );
                                full_content.push_str(&delta);
                            }
                        }
                    }
                }
            } else if msg.is_response() && msg.id == Some(id) {
                // Final response to the prompt
                if let Some(err) = msg.error {
                    had_error = true;
                    let _ = app.emit(
                        "chat-stream-error",
                        StreamErrorPayload {
                            conversation_id: conversation_id.to_string(),
                            error: format!("ACP prompt error: {}", err.message),
                        },
                    );
                    break;
                }
                break;
            }
        }

        // Emit done event (with partial content if error occurred mid-stream)
        if !had_error || !full_content.is_empty() {
            let _ = app.emit(
                "chat-stream-done",
                StreamDonePayload {
                    conversation_id: conversation_id.to_string(),
                    message_id: message_id.to_string(),
                    full_content: full_content.clone(),
                },
            );
        }

        if had_error && full_content.is_empty() {
            return Err("ACP streaming failed".to_string());
        }

        Ok(full_content)
    }

    /// Cancel current generation.
    pub async fn cancel(&mut self, acp_session_id: &str) -> Result<(), String> {
        // session/cancel is a notification (no id, no response expected)
        let notification = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "session/cancel",
            "params": { "sessionId": acp_session_id }
        });
        let mut line = serde_json::to_string(&notification).map_err(|e| e.to_string())?;
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("Failed to send cancel: {}", e))?;
        self.stdin.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Kill the subprocess.
    pub async fn kill(&mut self) {
        let _ = self.child.kill().await;
    }
}

impl Drop for AcpClient {
    fn drop(&mut self) {
        // Best-effort kill on drop
        let _ = self.child.start_kill();
    }
}

/// Extract text delta from a session/update notification.
/// ACP agent_message_chunk format:
/// `{ "update": { "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": "delta" } } }`
fn extract_text_delta(params: &Value) -> String {
    let update = params
        .get("update")
        .filter(|u| u.get("sessionUpdate").and_then(|s| s.as_str()) == Some("agent_message_chunk"));

    update
        .and_then(|u| u.get("content"))
        .filter(|c| c.get("type").and_then(|t| t.as_str()) == Some("text"))
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string()
}

// ── Global ACP state ──

/// Each entry is behind its own Arc<Mutex> so we can:
/// 1. Get a clone of the Arc from the global map (brief global lock)
/// 2. Lock the per-entry mutex for the duration of prompt() (no global lock held)
/// 3. Allow stop_openclaw_generation to access the entry concurrently
pub struct AcpState {
    pub clients: Mutex<HashMap<String, Arc<Mutex<AcpClientEntry>>>>,
}

pub struct AcpClientEntry {
    pub client: AcpClient,
    pub acp_session_id: String,
}

impl AcpState {
    pub fn new() -> Self {
        Self {
            clients: Mutex::new(HashMap::new()),
        }
    }

    /// Kill all active ACP processes (called on app exit).
    pub async fn kill_all(&self) {
        let mut clients = self.clients.lock().await;
        for entry_arc in clients.values() {
            let mut entry = entry_arc.lock().await;
            entry.client.kill().await;
        }
        clients.clear();
    }
}
