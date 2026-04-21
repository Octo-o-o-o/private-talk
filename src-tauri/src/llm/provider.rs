use super::types::{ChatChunk, ChatMessage, ChatRequest};
use futures::StreamExt;
use reqwest::Client;
use tokio::sync::mpsc;

const CHANNEL_CAPACITY: usize = 64;

/// Stream chat completions from an OpenAI-compatible endpoint, emitting content
/// text chunks via the returned channel.
pub async fn stream_chat(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
    temperature: Option<f64>,
) -> Result<mpsc::Receiver<Result<String, String>>, String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let request = ChatRequest {
        model: model.to_string(),
        messages,
        stream: true,
        temperature,
    };

    let response = Client::new()
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

    let (tx, rx) = mpsc::channel(CHANNEL_CAPACITY);
    tokio::spawn(async move {
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk_result) = stream.next().await {
            let bytes = match chunk_result {
                Ok(bytes) => bytes,
                Err(e) => {
                    let _ = tx.send(Err(format!("Stream error: {}", e))).await;
                    return;
                }
            };

            buffer.push_str(&String::from_utf8_lossy(&bytes));
            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].trim().to_string();
                buffer.drain(..=pos);

                if line.is_empty() || line.starts_with(':') {
                    continue;
                }
                let Some(data) = line.strip_prefix("data: ") else {
                    continue;
                };
                if data.trim() == "[DONE]" {
                    return;
                }

                match serde_json::from_str::<ChatChunk>(data) {
                    Ok(chunk) => {
                        for choice in &chunk.choices {
                            if let Some(content) = choice.delta.content.as_deref() {
                                if !content.is_empty()
                                    && tx.send(Ok(content.to_string())).await.is_err()
                                {
                                    return;
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
    });

    Ok(rx)
}
