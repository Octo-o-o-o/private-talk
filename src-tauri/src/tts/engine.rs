use super::types::{TtsSpeechRequest, VoiceEngineConfig};
use reqwest::Client;

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

/// Synthesize speech using an OpenAI-compatible TTS endpoint.
/// Returns raw audio bytes (mp3/wav depending on config).
pub async fn synthesize(config: &VoiceEngineConfig, text: &str) -> Result<Vec<u8>, String> {
    let client = Client::new();
    let url = format!("{}/v1/audio/speech", config.endpoint.trim_end_matches('/'));

    let request = TtsSpeechRequest {
        model: config.model.clone(),
        voice: config.voice.clone(),
        input: text.to_string(),
        speed: Some(config.speed),
        response_format: Some(config.response_format.clone()),
    };

    let mut req_builder = client.post(&url).header("Content-Type", "application/json");

    // Attach API key for authenticated endpoints (OpenAI TTS, etc.)
    if let Some(ref api_key) = config.api_key {
        if !api_key.is_empty() {
            req_builder = req_builder.header("Authorization", format!("Bearer {}", api_key));
        }
    }

    let response = req_builder
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("TTS request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("TTS API error {}: {}", status, body));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read TTS response: {}", e))?;

    Ok(bytes.to_vec())
}

/// Transcribe audio using an OpenAI-compatible Whisper endpoint.
/// `audio_data` is raw audio bytes, `base_url` and `api_key` come from a provider.
pub async fn transcribe(
    base_url: &str,
    api_key: &str,
    audio_data: Vec<u8>,
    model: &str,
) -> Result<String, String> {
    let client = Client::new();
    let url = format!("{}/audio/transcriptions", base_url.trim_end_matches('/'));

    let part = reqwest::multipart::Part::bytes(audio_data)
        .file_name("audio.webm")
        .mime_str("audio/webm")
        .map_err(|e| format!("Failed to create multipart: {}", e))?;

    let form = reqwest::multipart::Form::new()
        .text("model", model.to_string())
        .part("file", part);

    let response = with_optional_bearer(client.post(&url).multipart(form), api_key)
        .send()
        .await
        .map_err(|e| format!("STT request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("STT API error {}: {}", status, body));
    }

    #[derive(serde::Deserialize)]
    struct TranscriptionResponse {
        text: String,
    }

    let result: TranscriptionResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse STT response: {}", e))?;

    Ok(result.text)
}
