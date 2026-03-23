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

/// Detect the Qwen3-TTS model variant from the model name.
enum Qwen3TtsMode {
    CustomVoice,
    VoiceDesign,
    VoiceClone,
    Other,
}

fn detect_mode(model: &str) -> Qwen3TtsMode {
    let lower = model.to_lowercase();
    if lower.contains("customvoice") {
        Qwen3TtsMode::CustomVoice
    } else if lower.contains("voicedesign") {
        Qwen3TtsMode::VoiceDesign
    } else if lower.contains("base") || lower.contains("clone") {
        Qwen3TtsMode::VoiceClone
    } else {
        Qwen3TtsMode::Other
    }
}

/// Synthesize speech using an OpenAI-compatible TTS endpoint.
/// Returns raw audio bytes (mp3/wav depending on config).
pub async fn synthesize(config: &VoiceEngineConfig, text: &str) -> Result<Vec<u8>, String> {
    let client = Client::new();
    let url = format!("{}/v1/audio/speech", config.endpoint.trim_end_matches('/'));

    let mode = detect_mode(&config.model);

    let (voice, instruct, ref_audio, ref_text) = match mode {
        Qwen3TtsMode::VoiceDesign => {
            // VoiceDesign: voice description goes into `instruct`
            (String::new(), Some(config.voice.clone()), None, None)
        }
        Qwen3TtsMode::VoiceClone => {
            // Base/Clone: use ref_audio + ref_text for voice cloning
            (
                String::new(),
                None,
                config.ref_audio.clone(),
                config.ref_text.clone(),
            )
        }
        Qwen3TtsMode::CustomVoice => {
            // CustomVoice: speaker name in `voice`, optional instruct not used here
            (config.voice.clone(), None, None, None)
        }
        Qwen3TtsMode::Other => {
            // Generic / OpenAI-compatible: just pass voice through
            (config.voice.clone(), None, None, None)
        }
    };

    let request = TtsSpeechRequest {
        model: config.model.clone(),
        voice,
        input: text.to_string(),
        speed: Some(config.speed),
        response_format: Some(config.response_format.clone()),
        instruct,
        ref_audio,
        ref_text,
    };

    let api_key = config.api_key.as_deref().unwrap_or("");
    let req_builder = client.post(&url).header("Content-Type", "application/json");

    let response = with_optional_bearer(req_builder, api_key)
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
    mime_type: Option<&str>,
) -> Result<String, String> {
    let client = Client::new();
    let url = format!("{}/audio/transcriptions", base_url.trim_end_matches('/'));

    let mime = mime_type.unwrap_or("audio/webm");
    let ext = match mime {
        "audio/mp4" => "mp4",
        "audio/aac" => "aac",
        "audio/ogg" | "audio/ogg;codecs=opus" => "ogg",
        "audio/wav" => "wav",
        _ => "webm",
    };

    let part = reqwest::multipart::Part::bytes(audio_data)
        .file_name(format!("audio.{}", ext))
        .mime_str(mime)
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
