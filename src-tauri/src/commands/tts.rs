use crate::db::DbState;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::Client;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct TtsResult {
    pub audio_base64: String,
    pub content_type: String,
}

#[tauri::command]
pub async fn tts_synthesize(
    db: State<'_, DbState>,
    text: String,
    provider_id: String,
    model: String,
    voice: String,
    response_format: Option<String>,
) -> Result<TtsResult, String> {
    let (base_url, api_key) = {
        let conn = db.lock()?;
        conn.query_row(
            "SELECT base_url, api_key FROM providers WHERE id = ?1",
            rusqlite::params![provider_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|error| format!("TTS provider not found: {error}"))?
    };

    let response_format = response_format.unwrap_or_else(|| "mp3".to_string());
    let url = format!("{}/audio/speech", base_url.trim_end_matches('/'));
    let response = Client::new()
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&serde_json::json!({
            "model": model,
            "voice": voice,
            "input": text,
            "response_format": response_format,
        }))
        .send()
        .await
        .map_err(|error| format!("TTS request failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("TTS API error ({status}): {body}"));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("audio/mpeg")
        .to_string();
    let audio_bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Failed to read TTS audio: {error}"))?;

    Ok(TtsResult {
        audio_base64: BASE64.encode(audio_bytes),
        content_type,
    })
}
