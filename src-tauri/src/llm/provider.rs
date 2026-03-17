use super::types::{ChatChunk, ChatMessage, ChatRequest};
use futures::StreamExt;
use reqwest::Client;
use tokio::sync::mpsc;

/// Stream chat completions from an OpenAI-compatible endpoint.
/// Returns chunks of content text via a channel.
pub async fn stream_chat(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
    temperature: Option<f64>,
) -> Result<mpsc::Receiver<Result<String, String>>, String> {
    let client = Client::new();
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let request = ChatRequest {
        model: model.to_string(),
        messages,
        stream: true,
        temperature,
    };

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request)
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
                                    for choice in &chunk.choices {
                                        if let Some(content) = &choice.delta.content {
                                            if !content.is_empty() {
                                                let _ = tx.send(Ok(content.clone())).await;
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
