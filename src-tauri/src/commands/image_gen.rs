use crate::db::{now_timestamp, DbState};
use crate::image_generation::{self, GeneratedImage};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageGenConfig {
    pub enabled: bool,
    pub provider_id: String,
    pub model: String,
    pub default_aspect_ratio: String,
    pub default_quality: String,
    pub default_background: String,
    pub max_images_per_request: u8,
}

#[derive(Debug, Clone, Serialize)]
pub struct GeneratedAssistantMessage {
    pub id: String,
    pub conversation_id: String,
    pub content: String,
    pub created_at: String,
}

fn default_config() -> ImageGenConfig {
    ImageGenConfig {
        enabled: false,
        provider_id: String::new(),
        model: String::new(),
        default_aspect_ratio: "1:1".to_string(),
        default_quality: "standard".to_string(),
        default_background: "auto".to_string(),
        max_images_per_request: 4,
    }
}

fn load_image_config(conn: &rusqlite::Connection) -> Result<ImageGenConfig, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'image_gen_config'",
            [],
            |row| row.get(0),
        )
        .ok();

    if let Some(value) = raw {
        let parsed = serde_json::from_str::<ImageGenConfig>(&value)
            .map_err(|error| format!("Invalid image generation config: {error}"))?;
        Ok(parsed)
    } else {
        Ok(default_config())
    }
}

fn file_extension(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "png",
    }
}

fn local_image_uri(path: &str) -> String {
    format!("localb64://{}", URL_SAFE_NO_PAD.encode(path.as_bytes()))
}

fn save_generated_image(
    output_dir: &std::path::Path,
    image: &GeneratedImage,
) -> Result<String, String> {
    std::fs::create_dir_all(output_dir).map_err(|error| error.to_string())?;
    let file_path = output_dir.join(format!(
        "{}.{}",
        uuid::Uuid::new_v4(),
        file_extension(&image.mime_type)
    ));
    std::fs::write(&file_path, &image.data).map_err(|error| error.to_string())?;
    file_path
        .to_str()
        .map(ToString::to_string)
        .ok_or_else(|| "Generated image path is not valid UTF-8.".to_string())
}

#[tauri::command]
pub async fn generate_image_message(
    app: tauri::AppHandle,
    db: State<'_, DbState>,
    conversation_id: String,
    content: String,
    user_display_content: Option<String>,
    reference_image_base64: Option<String>,
    reference_mime_type: Option<String>,
) -> Result<GeneratedAssistantMessage, String> {
    let now = now_timestamp();

    let (config, base_url, api_key) = {
        let conn = db.lock()?;
        let config = load_image_config(&conn)?;
        if !config.enabled {
            return Err(
                "图片生成当前未启用，请先在设置里配置。\nImage generation is not enabled yet. Configure it in Settings first."
                    .to_string(),
            );
        }
        if config.provider_id.trim().is_empty() || config.model.trim().is_empty() {
            return Err(
                "图片生成服务商或模型未配置。\nImage generation provider or model is not configured."
                    .to_string(),
            );
        }

        let provider = conn
            .query_row(
                "SELECT base_url, api_key FROM providers WHERE id = ?1",
                params![config.provider_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .map_err(|error| format!("Image provider not found: {error}"))?;
        (config, provider.0, provider.1)
    };

    let mut request = image_generation::parse_img_command(
        &content,
        &config.default_aspect_ratio,
        &config.default_quality,
        &config.default_background,
    )?;

    if let Some(reference_b64) = reference_image_base64 {
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(reference_b64)
            .map_err(|error| format!("Invalid reference image data: {error}"))?;
        request
            .reference_images
            .push(image_generation::ReferenceImage {
                data: decoded,
                mime_type: reference_mime_type.unwrap_or_else(|| "image/png".to_string()),
            });
    }

    if let Some(count) = request.count {
        if count > config.max_images_per_request {
            request.count = Some(config.max_images_per_request.max(1));
        }
    }

    {
        let conn = db.lock()?;
        let user_message_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, 'user', ?3, ?4)",
            params![
                user_message_id,
                conversation_id,
                user_display_content.unwrap_or_else(|| content.clone()),
                now,
            ],
        )
        .map_err(|error| error.to_string())?;
        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![now, conversation_id],
        )
        .map_err(|error| error.to_string())?;
    }

    let result = if request.reference_images.is_empty() {
        image_generation::generate_images(&base_url, &api_key, &config.model, &request).await
    } else {
        image_generation::edit_images(&base_url, &api_key, &config.model, &request).await
    }?;

    let output_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("generated-images")
        .join(&conversation_id);

    let mut markdown_images = Vec::new();
    for (index, image) in result.images.iter().enumerate() {
        let file_path = save_generated_image(&output_dir, image)?;
        markdown_images.push(format!(
            "![Generated image {}]({})",
            index + 1,
            local_image_uri(&file_path)
        ));
    }

    let mut assistant_lines = vec![if request.reference_images.is_empty() {
        format!("Generated {} image(s).", markdown_images.len())
    } else {
        format!(
            "Generated {} image(s) from the reference image.",
            markdown_images.len()
        )
    }];

    if let Some(revised_prompt) = result.revised_prompt {
        let trimmed = revised_prompt.trim();
        if !trimmed.is_empty() {
            assistant_lines.push(format!("Revised prompt: {trimmed}"));
        }
    }

    assistant_lines.push(String::new());
    assistant_lines.extend(markdown_images);

    let assistant_message = GeneratedAssistantMessage {
        id: uuid::Uuid::new_v4().to_string(),
        conversation_id: conversation_id.clone(),
        content: assistant_lines.join("\n"),
        created_at: now_timestamp(),
    };

    {
        let conn = db.lock()?;
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, 'assistant', ?3, ?4)",
            params![
                assistant_message.id,
                assistant_message.conversation_id,
                assistant_message.content,
                assistant_message.created_at,
            ],
        )
        .map_err(|error| error.to_string())?;
        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![
                assistant_message.created_at,
                assistant_message.conversation_id
            ],
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(assistant_message)
}
