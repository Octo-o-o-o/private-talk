use crate::db::DbState;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rusqlite::{params, OptionalExtension};
use tauri::State;

#[tauri::command]
pub async fn stt_transcribe(
    db: State<'_, DbState>,
    audio_base64: String,
    provider_id: String,
    mime_type: Option<String>,
) -> Result<String, String> {
    let (base_url, api_key, stt_model) = {
        let conn = db.lock()?;
        let (base_url, api_key) = conn
            .query_row(
                "SELECT base_url, api_key FROM providers WHERE id = ?1",
                params![provider_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .map_err(|e| format!("Provider not found: {}", e))?;

        let stt_model = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'stt_model'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "whisper-1".to_string());

        (base_url, api_key, stt_model)
    };

    let audio_data = BASE64
        .decode(audio_base64)
        .map_err(|e| format!("Invalid base64 audio: {}", e))?;

    let mime = mime_type.unwrap_or_else(|| "audio/webm".to_string());
    let extension = match mime.as_str() {
        "audio/mp4" => "mp4",
        "audio/aac" => "aac",
        "audio/ogg" | "audio/ogg;codecs=opus" => "ogg",
        "audio/wav" => "wav",
        _ => "webm",
    };

    let part = reqwest::multipart::Part::bytes(audio_data)
        .file_name(format!("audio.{}", extension))
        .mime_str(&mime)
        .map_err(|e| format!("Failed to create multipart payload: {}", e))?;

    let form = reqwest::multipart::Form::new()
        .text("model", stt_model)
        .part("file", part);

    let client = reqwest::Client::new();
    let url = format!("{}/audio/transcriptions", base_url.trim_end_matches('/'));

    let mut request = client.post(url).multipart(form);
    if !api_key.trim().is_empty() {
        request = request.bearer_auth(api_key.trim());
    }

    let response = request
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

    let payload: TranscriptionResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse STT response: {}", e))?;

    Ok(payload.text)
}
