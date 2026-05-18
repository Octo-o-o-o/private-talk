use super::types::{ChatChunk, ChatMessage, ChatRequest, StreamOptions, Usage};
use futures::StreamExt;
use reqwest::Client;
use tokio::sync::mpsc;

const CHANNEL_CAPACITY: usize = 64;

pub enum StreamItem {
    Content(String),
    Usage(Usage),
}

/// Stream chat completions from an OpenAI-compatible endpoint, emitting content
/// text chunks via the returned channel.
pub async fn stream_chat(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
    temperature: Option<f64>,
) -> Result<mpsc::Receiver<Result<StreamItem, String>>, String> {
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

    let response = Client::new()
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error {status}: {body}"));
    }

    let (tx, rx) = mpsc::channel(CHANNEL_CAPACITY);
    tokio::spawn(async move {
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk_result) = stream.next().await {
            let bytes = match chunk_result {
                Ok(bytes) => bytes,
                Err(e) => {
                    let _ = tx.send(Err(format!("Stream error: {e}"))).await;
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
                                if !content.is_empty() {
                                    if tx
                                        .send(Ok(StreamItem::Content(content.to_string())))
                                        .await
                                        .is_err()
                                    {
                                        return;
                                    }
                                }
                            }
                        }
                        if let Some(usage) = chunk.usage {
                            if tx.send(Ok(StreamItem::Usage(usage))).await.is_err() {
                                return;
                            }
                        }
                    }
                    Err(e) => {
                        let _ = tx
                            .send(Err(format!("Parse error: {e} for data: {data}")))
                            .await;
                    }
                }
            }
        }
    });

    Ok(rx)
}

#[cfg(test)]
mod tests {
    use super::{stream_chat, StreamItem};
    use crate::llm::types::{ChatContent, ChatMessage};
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn user_msg(text: &str) -> ChatMessage {
        ChatMessage {
            role: "user".to_string(),
            content: ChatContent::text(text),
        }
    }

    async fn drain(
        rx: &mut tokio::sync::mpsc::Receiver<Result<StreamItem, String>>,
    ) -> (String, Option<i64>, Vec<String>) {
        let mut content = String::new();
        let mut total_tokens: Option<i64> = None;
        let mut errors = Vec::new();
        while let Some(item) = rx.recv().await {
            match item {
                Ok(StreamItem::Content(chunk)) => content.push_str(&chunk),
                Ok(StreamItem::Usage(usage)) => total_tokens = Some(usage.total_tokens),
                Err(e) => errors.push(e),
            }
        }
        (content, total_tokens, errors)
    }

    fn sse_body(events: &[&str]) -> String {
        // Each SSE event is "data: <json>\n\n".
        let mut out = String::new();
        for ev in events {
            out.push_str("data: ");
            out.push_str(ev);
            out.push_str("\n\n");
        }
        out
    }

    #[tokio::test]
    async fn stream_chat_emits_content_chunks_in_order_until_done() {
        let server = MockServer::start().await;
        let body = sse_body(&[
            r#"{"choices":[{"delta":{"content":"Hello"}}]}"#,
            r#"{"choices":[{"delta":{"content":", "}}]}"#,
            r#"{"choices":[{"delta":{"content":"world!"}}]}"#,
            r#"{"choices":[{"delta":{}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}"#,
            r#"[DONE]"#,
        ]);
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .and(header("Authorization", "Bearer test-key"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "text/event-stream")
                    .set_body_string(body),
            )
            .mount(&server)
            .await;

        let mut rx = stream_chat(
            &server.uri(),
            "test-key",
            "gpt-4o",
            vec![user_msg("hi")],
            None,
        )
        .await
        .expect("request must succeed");

        let (content, total_tokens, errors) = drain(&mut rx).await;
        assert!(errors.is_empty(), "no parser errors expected: {errors:?}");
        assert_eq!(content, "Hello, world!");
        assert_eq!(total_tokens, Some(5));
    }

    #[tokio::test]
    async fn stream_chat_propagates_api_error_status_with_body() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(
                ResponseTemplate::new(503).set_body_string("upstream temporarily unavailable"),
            )
            .mount(&server)
            .await;

        let result = stream_chat(
            &server.uri(),
            "key",
            "gpt-4o",
            vec![user_msg("hi")],
            None,
        )
        .await;

        let err = result.expect_err("HTTP error must propagate");
        assert!(err.contains("503"), "error must include status: {err}");
        assert!(
            err.contains("upstream temporarily unavailable"),
            "error must include body: {err}",
        );
    }

    #[tokio::test]
    async fn stream_chat_ignores_empty_lines_and_comments_and_done_marker() {
        let server = MockServer::start().await;
        // Spec: empty lines and lines starting with ':' (SSE comments) must
        // be ignored. [DONE] terminates the stream.
        let body = String::from(
            "\n\
             : keepalive\n\
             data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n\
             \n\
             :another comment\n\
             data: {\"choices\":[{\"delta\":{\"content\":\"b\"}}]}\n\
             \n\
             data: [DONE]\n\
             data: {\"choices\":[{\"delta\":{\"content\":\"never\"}}]}\n\
             \n",
        );
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        let mut rx = stream_chat(
            &server.uri(),
            "k",
            "gpt-4o",
            vec![user_msg("x")],
            None,
        )
        .await
        .expect("ok");

        let (content, _usage, errors) = drain(&mut rx).await;
        assert_eq!(content, "ab");
        assert!(errors.is_empty(), "no errors expected: {errors:?}");
    }

    #[tokio::test]
    async fn stream_chat_skips_lines_that_are_not_data_prefixed() {
        let server = MockServer::start().await;
        let body = String::from(
            "event: ping\n\
             data: {\"choices\":[{\"delta\":{\"content\":\"only-data\"}}]}\n\
             id: 42\n\
             data: [DONE]\n",
        );
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        let mut rx = stream_chat(&server.uri(), "k", "m", vec![user_msg("x")], None)
            .await
            .expect("ok");

        let (content, _usage, errors) = drain(&mut rx).await;
        assert_eq!(content, "only-data");
        assert!(errors.is_empty());
    }

    #[tokio::test]
    async fn stream_chat_emits_parse_error_for_malformed_json_payload() {
        let server = MockServer::start().await;
        let body = String::from(
            "data: {not valid json}\n\
             data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\
             data: [DONE]\n",
        );
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        let mut rx = stream_chat(&server.uri(), "k", "m", vec![user_msg("x")], None)
            .await
            .expect("ok");

        let (content, _usage, errors) = drain(&mut rx).await;
        // Parser must surface the error but continue past it to the next
        // valid event — content delivery should not stop on a single bad line.
        assert_eq!(content, "ok", "well-formed event after the bad one must still arrive");
        assert!(
            errors.iter().any(|e| e.contains("Parse error")),
            "expected a Parse error to be reported, got: {errors:?}",
        );
    }

    #[tokio::test]
    async fn stream_chat_trims_trailing_slash_in_base_url() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_string(sse_body(&["[DONE]"])))
            .mount(&server)
            .await;

        // Caller may or may not include the trailing slash; both must hit the
        // same endpoint without double slashes.
        let with_slash = format!("{}/", server.uri());
        let mut rx = stream_chat(&with_slash, "k", "m", vec![user_msg("x")], None)
            .await
            .expect("ok");
        let (content, _usage, errors) = drain(&mut rx).await;
        assert!(content.is_empty());
        assert!(errors.is_empty(), "got: {errors:?}");
    }
}
