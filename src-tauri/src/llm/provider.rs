use super::types::{ChatChunk, ChatMessage, ChatRequest, ChatResponse, StreamOptions, Usage};
use futures::StreamExt;
use reqwest::Client;
use tokio::sync::mpsc;

fn with_optional_bearer(
    request: reqwest::RequestBuilder,
    api_key: &str,
) -> reqwest::RequestBuilder {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        request
    } else {
        request.bearer_auth(trimmed)
    }
}

/// Result from streaming: content chunks + optional usage from the final chunk
pub enum StreamItem {
    Content(String),
    Usage(Usage),
}

/// Stream chat completions from an OpenAI-compatible endpoint.
/// Returns chunks of content text or usage info via a channel.
pub async fn stream_chat(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
    temperature: Option<f64>,
) -> Result<mpsc::Receiver<Result<StreamItem, String>>, String> {
    let client = Client::new();
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let request = ChatRequest {
        model: model.to_string(),
        messages,
        stream: true,
        temperature,
        stream_options: Some(StreamOptions {
            include_usage: true,
        }),
    };

    let response = with_optional_bearer(
        client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&request),
        api_key,
    )
    .send()
    .await
    .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, body));
    }

    let (tx, rx) = mpsc::channel(64);

    tokio::spawn(async move {
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    buffer.push_str(&text);

                    // Process complete SSE lines
                    while let Some(pos) = buffer.find('\n') {
                        let line = buffer[..pos].trim().to_string();
                        buffer = buffer[pos + 1..].to_string();

                        if line.is_empty() || line.starts_with(':') {
                            continue;
                        }

                        if let Some(data) = line.strip_prefix("data: ") {
                            if data.trim() == "[DONE]" {
                                return;
                            }

                            match serde_json::from_str::<ChatChunk>(data) {
                                Ok(chunk) => {
                                    // Check for usage in the chunk (usually the final one)
                                    if let Some(usage) = chunk.usage {
                                        let _ = tx.send(Ok(StreamItem::Usage(usage))).await;
                                    }
                                    for choice in &chunk.choices {
                                        if let Some(content) = &choice.delta.content {
                                            if !content.is_empty() {
                                                let _ = tx
                                                    .send(Ok(StreamItem::Content(content.clone())))
                                                    .await;
                                            }
                                        }
                                    }
                                }
                                Err(e) => {
                                    let _ = tx
                                        .send(Err(format!("Parse error: {} for data: {}", e, data)))
                                        .await;
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    let _ = tx.send(Err(format!("Stream error: {}", e))).await;
                    return;
                }
            }
        }
    });

    Ok(rx)
}

/// Non-streaming chat completion. Returns the full response text.
pub async fn chat_complete(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let client = Client::new();
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let request = ChatRequest {
        model: model.to_string(),
        messages,
        stream: false,
        temperature: Some(0.3),
        stream_options: None,
    };

    let response = with_optional_bearer(
        client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&request),
        api_key,
    )
    .send()
    .await
    .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, body));
    }

    let chat_response: ChatResponse = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    chat_response
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .ok_or_else(|| "No content in response".to_string())
}
