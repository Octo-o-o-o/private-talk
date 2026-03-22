use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceEngineConfig {
    pub endpoint: String,
    pub model: String,
    pub voice: String,
    #[serde(default = "default_speed")]
    pub speed: f64,
    #[serde(default = "default_format")]
    pub response_format: String,
    /// Optional API key for authenticated TTS endpoints (OpenAI, etc.)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

fn default_speed() -> f64 {
    1.0
}

fn default_format() -> String {
    "mp3".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceSegment {
    pub role_name: String,
    pub text: String,
    pub voice_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TtsSpeechRequest {
    pub model: String,
    pub voice: String,
    pub input: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_format: Option<String>,
}
