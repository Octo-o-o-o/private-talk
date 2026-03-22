use std::sync::atomic::{AtomicU64, Ordering};

use futures::{SinkExt, StreamExt};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::acp::types::*;

// ── Tauri event payloads ──

#[derive(Clone, serde::Serialize)]
struct StreamChunkPayload {
    conversation_id: String,
    content: String,
}

#[derive(Clone, serde::Serialize)]
struct StreamDonePayload {
    conversation_id: String,
    message_id: String,
    full_content: String,
}

// ── WebSocket-based ACP Client ──

pub struct WsAcpClient {
    /// Sender half of the WebSocket connection
    ws_tx: mpsc::Sender<String>,
    next_id: AtomicU64,
    /// Channel to receive parsed JSON-RPC messages from the WS reader task
    rx: mpsc::Receiver<JsonRpcMessage>,
}

impl WsAcpClient {
    /// Connect to an OpenClaw gateway via WebSocket.
    pub async fn connect(
        gateway_url: &str,
        token: &str,
        agent_id: &str,
        session_key: &str,
    ) -> Result<Self, String> {
        // Build the WebSocket URL with query params for auth
        let session_arg = format!("agent:{}:{}", agent_id, session_key);
        let mut url = gateway_url.to_string();

        // Add query parameters
        let separator = if url.contains('?') { '&' } else { '?' };
        url = format!("{}{}session={}", url, separator, urlencoded(&session_arg));
        if !token.is_empty() {
            url = format!("{}&token={}", url, urlencoded(token));
        }

        let (ws_stream, _) = tokio_tungstenite::connect_async(&url)
            .await
            .map_err(|e| format!("Failed to connect to OpenClaw gateway at {}: {}", gateway_url, e))?;

        let (mut write, mut read) = ws_stream.split();

        // Channel: caller -> WS writer task
        let (ws_tx, mut ws_rx) = mpsc::channel::<String>(64);
        // Channel: WS reader task -> caller
        let (msg_tx, msg_rx) = mpsc::channel::<JsonRpcMessage>(64);

        // Writer task: forwards outgoing messages to the WebSocket
        tokio::spawn(async move {
            while let Some(text) = ws_rx.recv().await {
                if write.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
            }
        });

        // Reader task: reads incoming WebSocket messages and parses JSON-RPC
        tokio::spawn(async move {
            while let Some(Ok(msg)) = read.next().await {
                let text = match msg {
                    Message::Text(t) => t.to_string(),
                    Message::Close(_) => break,
                    _ => continue,
                };
                if text.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<JsonRpcMessage>(&text) {
                    Ok(parsed) => {
                        if msg_tx.send(parsed).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => {
                        // Skip unparseable messages
                    }
                }
            }
        });

        Ok(Self {
            ws_tx,
            next_id: AtomicU64::new(1),
            rx: msg_rx,
        })
    }

    /// Send a JSON-RPC request and wait for the matching response.
    async fn request(&mut self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = JsonRpcRequest::new(id, method, params);
        let text = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        self.ws_tx
            .send(text)
            .await
            .map_err(|_| "WebSocket connection closed".to_string())?;

        // Read messages until we get the response for our id
        loop {
            let msg = self
                .rx
                .recv()
                .await
                .ok_or("WebSocket connection closed unexpectedly")?;

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
        let session: SessionNewResult =
            serde_json::from_value(result).map_err(|e| format!("Failed to parse session: {}", e))?;
        Ok(session.session_id)
    }

    /// Send a prompt and stream the response via Tauri events.
    pub async fn prompt(
        &mut self,
        acp_session_id: &str,
        content: &str,
        conversation_id: &str,
        message_id: &str,
        app: &AppHandle,
    ) -> Result<String, String> {
        let params = serde_json::to_value(SessionPromptParams {
            session_id: acp_session_id.to_string(),
            prompt: vec![ContentBlock::Text {
                text: content.to_string(),
            }],
        })
        .map_err(|e| e.to_string())?;

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = JsonRpcRequest::new(id, "session/prompt", Some(params));
        let text = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        self.ws_tx
            .send(text)
            .await
            .map_err(|_| "WebSocket connection closed".to_string())?;

        let mut full_content = String::new();

        loop {
            let msg = self
                .rx
                .recv()
                .await
                .ok_or_else(|| "WebSocket closed during streaming".to_string())?;

            if msg.is_notification() {
                if let Some(method) = &msg.method {
                    if method == "session/update" {
                        if let Some(params) = &msg.params {
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
                if let Some(err) = msg.error {
                    return Err(format!("ACP prompt error: {}", err.message));
                }
                break;
            }
        }

        let _ = app.emit(
            "chat-stream-done",
            StreamDonePayload {
                conversation_id: conversation_id.to_string(),
                message_id: message_id.to_string(),
                full_content: full_content.clone(),
            },
        );

        Ok(full_content)
    }

    /// Cancel current generation.
    pub async fn cancel(&mut self, acp_session_id: &str) -> Result<(), String> {
        let notification = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "session/cancel",
            "params": { "sessionId": acp_session_id }
        });
        let text = serde_json::to_string(&notification).map_err(|e| e.to_string())?;
        self.ws_tx
            .send(text)
            .await
            .map_err(|_| "WebSocket connection closed".to_string())?;
        Ok(())
    }

    /// Close the WebSocket connection.
    pub async fn kill(&mut self) {
        // Dropping ws_tx will cause the writer task to end,
        // which closes the WebSocket.
    }
}

/// Extract text delta from a session/update notification.
fn extract_text_delta(params: &Value) -> String {
    let update = match params.get("update") {
        Some(u) => u,
        None => return String::new(),
    };
    if update.get("sessionUpdate").and_then(|s| s.as_str()) != Some("agent_message_chunk") {
        return String::new();
    }
    if let Some(content) = update.get("content") {
        if content.get("type").and_then(|t| t.as_str()) == Some("text") {
            if let Some(text) = content.get("text").and_then(|t| t.as_str()) {
                return text.to_string();
            }
        }
    }
    String::new()
}

/// Simple percent-encoding for URL query parameters.
fn urlencoded(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(b as char);
            }
            _ => {
                result.push_str(&format!("%{:02X}", b));
            }
        }
    }
    result
}
