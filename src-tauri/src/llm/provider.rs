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
    stream_chat_with_headers(base_url, api_key, model, messages, temperature, None).await
}

/// Stream chat completions with optional extra headers (e.g. x-openclaw-session-key).
pub async fn stream_chat_with_headers(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
    temperature: Option<f64>,
    extra_headers: Option<Vec<(String, String)>>,
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

    let mut req_builder = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&request);

    if let Some(headers) = extra_headers {
        for (key, value) in headers {
            req_builder = req_builder.header(key, value);
        }
    }

    let response = with_optional_bearer(req_builder, api_key)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::types::ChatContent;
    use reqwest::header::AUTHORIZATION;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn sample_messages() -> Vec<ChatMessage> {
        vec![ChatMessage {
            role: "user".to_string(),
            content: ChatContent::text("Hello"),
        }]
    }

    async fn spawn_test_server(response_body: String) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = vec![0_u8; 8192];
            let read = socket.read(&mut buffer).await.unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]).to_string();
            socket.write_all(response_body.as_bytes()).await.unwrap();
            socket.shutdown().await.unwrap();
            request
        });

        (format!("http://{}", addr), handle)
    }

    #[test]
    fn with_optional_bearer_skips_blank_api_keys() {
        let request = with_optional_bearer(
            Client::new().post("http://127.0.0.1/test"),
            "   ",
        )
        .build()
        .unwrap();

        assert!(request.headers().get(AUTHORIZATION).is_none());
    }

    #[test]
    fn with_optional_bearer_trims_and_sets_authorization() {
        let request = with_optional_bearer(
            Client::new().post("http://127.0.0.1/test"),
            "  sk-test  ",
        )
        .build()
        .unwrap();

        assert_eq!(
            request.headers().get(AUTHORIZATION).unwrap(),
            "Bearer sk-test"
        );
    }

    #[tokio::test]
    async fn chat_complete_sends_authorization_and_parses_response() {
        let response_json = r#"{"choices":[{"message":{"content":"Hello back"}}]}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            response_json.len(),
            response_json
        );
        let (base_url, request_handle) = spawn_test_server(response).await;

        let result = chat_complete(&base_url, " sk-test ", "gpt-test", sample_messages())
            .await
            .unwrap();
        let request = request_handle.await.unwrap().to_lowercase();

        assert_eq!(result, "Hello back");
        assert!(request.contains("post /chat/completions http/1.1"));
        assert!(request.contains("authorization: bearer sk-test"));
        assert!(request.contains("content-type: application/json"));
    }

    #[tokio::test]
    async fn chat_complete_returns_an_error_when_content_is_missing() {
        let response_json = r#"{"choices":[{"message":{"content":null}}]}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            response_json.len(),
            response_json
        );
        let (base_url, _) = spawn_test_server(response).await;

        let error = chat_complete(&base_url, "sk-test", "gpt-test", sample_messages())
            .await
            .unwrap_err();

        assert_eq!(error, "No content in response");
    }

    #[tokio::test]
    async fn stream_chat_with_headers_emits_content_and_usage() {
        let sse = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n",
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3}}\n\n",
            "data: [DONE]\n\n"
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            sse.len(),
            sse
        );
        let (base_url, request_handle) = spawn_test_server(response).await;

        let mut receiver = stream_chat_with_headers(
            &base_url,
            "",
            "gpt-test",
            sample_messages(),
            Some(0.3),
            Some(vec![("x-openclaw-session-key".to_string(), "session-1".to_string())]),
        )
        .await
        .unwrap();

        let first = receiver.recv().await.unwrap().unwrap();
        let second = receiver.recv().await.unwrap().unwrap();
        let request = request_handle.await.unwrap().to_lowercase();

        match first {
            StreamItem::Content(content) => assert_eq!(content, "Hello"),
            StreamItem::Usage(_) => panic!("expected content chunk first"),
        }

        match second {
            StreamItem::Usage(usage) => {
                assert_eq!(usage.prompt_tokens, 1);
                assert_eq!(usage.completion_tokens, 2);
                assert_eq!(usage.total_tokens, 3);
            }
            StreamItem::Content(_) => panic!("expected usage chunk second"),
        }

        assert!(request.contains("x-openclaw-session-key: session-1"));
        assert!(!request.contains("authorization:"));
    }

    #[tokio::test]
    async fn stream_chat_reports_sse_parse_errors() {
        let sse = concat!("data: not-json\n\n", "data: [DONE]\n\n");
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            sse.len(),
            sse
        );
        let (base_url, _) = spawn_test_server(response).await;

        let mut receiver = stream_chat(&base_url, "sk-test", "gpt-test", sample_messages(), None)
            .await
            .unwrap();
        let item = receiver.recv().await.unwrap();

        match item {
            Err(error) => assert!(error.contains("Parse error:")),
            Ok(_) => panic!("expected parse error from malformed SSE chunk"),
        }
    }
}
