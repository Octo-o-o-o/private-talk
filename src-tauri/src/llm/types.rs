use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: ChatContent,
}

/// Message content: either plain text or multipart (text + images).
/// Uses `#[serde(untagged)]` so plain text serializes as `"content": "text"`
/// and multipart serializes as `"content": [...]`, matching OpenAI API format.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ChatContent {
    Text(String),
    Multipart(Vec<ChatContentPart>),
}

impl ChatContent {
    /// Create a simple text content.
    pub fn text(s: impl Into<String>) -> Self {
        ChatContent::Text(s.into())
    }

    /// Get the text content (first text part for multipart).
    pub fn as_text(&self) -> &str {
        match self {
            ChatContent::Text(s) => s,
            ChatContent::Multipart(parts) => parts
                .iter()
                .find_map(|part| match part {
                    ChatContentPart::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .unwrap_or(""),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ChatContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: ImageUrlDetail },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageUrlDetail {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StreamOptions {
    pub include_usage: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_options: Option<StreamOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Usage {
    #[serde(default)]
    pub prompt_tokens: i64,
    #[serde(default)]
    pub completion_tokens: i64,
    #[serde(default)]
    pub total_tokens: i64,
}

#[derive(Debug, Deserialize)]
pub struct ChatChunk {
    pub choices: Vec<ChunkChoice>,
    #[serde(default)]
    pub usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
pub struct ChunkChoice {
    pub delta: Delta,
    #[serde(default)]
    #[allow(dead_code)]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Delta {
    pub content: Option<String>,
}

// Non-streaming response types
#[derive(Debug, Deserialize)]
pub struct ChatResponse {
    pub choices: Vec<ResponseChoice>,
    #[serde(default)]
    #[allow(dead_code)]
    pub usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
pub struct ResponseChoice {
    pub message: ResponseMessage,
}

#[derive(Debug, Deserialize)]
pub struct ResponseMessage {
    pub content: Option<String>,
}
