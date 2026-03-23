use crate::db::DbState;
use crate::tts::{engine, parser, types::VoiceEngineConfig};
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

#[derive(Clone, Serialize)]
pub struct TtsResult {
    pub audio_base64: String,
    pub content_type: String,
}

#[derive(Clone, Serialize)]
pub struct VoiceSegmentResult {
    pub role_name: String,
    pub text: String,
    pub voice_id: Option<String>,
}

/// Synthesize speech for a given voice and text.
/// Returns base64-encoded audio data.
#[tauri::command]
pub async fn tts_synthesize(
    db: State<'_, DbState>,
    voice_id: String,
    text: String,
) -> Result<TtsResult, String> {
    // Load voice config from DB
    let config: VoiceEngineConfig = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let config_str: String = conn
            .query_row(
                "SELECT engine_config FROM voices WHERE id = ?1",
                rusqlite::params![voice_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Voice not found: {}", e))?;
        serde_json::from_str(&config_str).map_err(|e| format!("Invalid voice config: {}", e))?
    };

    let audio_bytes = engine::synthesize(&config, &text).await?;
    let audio_base64 = BASE64.encode(&audio_bytes);

    let content_type = match config.response_format.as_str() {
        "wav" => "audio/wav",
        "opus" => "audio/opus",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        _ => "audio/mpeg",
    };

    Ok(TtsResult {
        audio_base64,
        content_type: content_type.to_string(),
    })
}

/// Parse message text into voice segments based on scenario's voice_mapping.
#[tauri::command]
pub fn parse_voice_segments(
    db: State<DbState>,
    text: String,
    scenario_id: Option<String>,
) -> Result<Vec<VoiceSegmentResult>, String> {
    let voice_mapping: HashMap<String, Option<String>> = if let Some(sid) = scenario_id {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mapping_str: String = conn
            .query_row(
                "SELECT voice_mapping FROM scenarios WHERE id = ?1",
                rusqlite::params![sid],
                |row| row.get(0),
            )
            .map_err(|e| format!("Scenario not found: {}", e))?;
        serde_json::from_str(&mapping_str).unwrap_or_default()
    } else {
        HashMap::new()
    };

    let segments = parser::parse_voice_segments(&text, &voice_mapping);
    Ok(segments
        .into_iter()
        .map(|s| VoiceSegmentResult {
            role_name: s.role_name,
            text: s.text,
            voice_id: s.voice_id,
        })
        .collect())
}

/// Transcribe audio using an OpenAI-compatible Whisper endpoint.
/// Uses a provider's base_url and api_key.
#[tauri::command]
pub async fn stt_transcribe(
    db: State<'_, DbState>,
    audio_base64: String,
    provider_id: String,
    mime_type: Option<String>,
) -> Result<String, String> {
    let (base_url, api_key, stt_model) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let (bu, ak) = conn
            .query_row(
                "SELECT base_url, api_key FROM providers WHERE id = ?1",
                rusqlite::params![provider_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .map_err(|e| format!("Provider not found: {}", e))?;

        // Read configurable STT model from settings, default whisper-1
        let model = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'stt_model'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap_or_else(|_| "whisper-1".to_string());

        (bu, ak, model)
    };

    let audio_data = BASE64
        .decode(&audio_base64)
        .map_err(|e| format!("Invalid base64 audio: {}", e))?;

    engine::transcribe(&base_url, &api_key, audio_data, &stt_model, mime_type.as_deref()).await
}
