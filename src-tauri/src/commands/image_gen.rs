use crate::attachments::{self, PreparedAttachment};
use crate::db::DbState;
use crate::image_gen;
use serde::Serialize;
use tauri::{Emitter, Manager, State};

#[derive(Clone, Serialize)]
pub struct ImageGenStatusPayload {
    pub conversation_id: String,
    pub phase: String,
    pub message: Option<String>,
}

/// Handle /img command within the send_message flow.
/// Called when user message starts with "/img ".
pub async fn handle_image_generation(
    app: tauri::AppHandle,
    db: &State<'_, DbState>,
    conversation_id: &str,
    content: &str,
    _user_msg_id: &str,
    prepared_attachments: &[PreparedAttachment],
) -> Result<(), String> {
    // 1. Read image_gen_config from settings
    let config = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let raw: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'image_gen_config'",
                [],
                |row| row.get(0),
            )
            .ok();
        raw.and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
    };

    let config = config.ok_or(
        "图片生成未配置，请在设置中配置。\nImage generation is not configured. Please set it up in Settings.",
    )?;
    let enabled = config
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !enabled {
        return Err(
            "图片生成已关闭，请在设置中启用。\nImage generation is disabled. Enable it in Settings."
                .to_string(),
        );
    }

    let provider_id = config
        .get("provider_id")
        .and_then(|v| v.as_str())
        .ok_or("图片生成服务商未配置。\nImage generation provider not configured.")?
        .to_string();
    if provider_id.is_empty() {
        return Err(
            "图片生成服务商未配置。\nImage generation provider not configured.".to_string(),
        );
    }
    let model = config
        .get("model")
        .and_then(|v| v.as_str())
        .ok_or("图片生成模型未配置。\nImage generation model not configured.")?
        .to_string();
    if model.is_empty() {
        return Err(
            "图片生成模型未配置。\nImage generation model not configured.".to_string(),
        );
    }
    let default_ratio = config
        .get("default_aspect_ratio")
        .and_then(|v| v.as_str())
        .unwrap_or("1:1")
        .to_string();
    let default_quality = config
        .get("default_quality")
        .and_then(|v| v.as_str())
        .unwrap_or("standard")
        .to_string();
    let max_n: u8 = config
        .get("max_images_per_request")
        .and_then(|v| v.as_u64())
        .unwrap_or(4) as u8;

    // 2. Parse /img command
    let mut request = image_gen::parse_img_command(content, &default_ratio, &default_quality)?;
    if let Some(n) = request.count {
        if n > max_n {
            request.count = Some(max_n);
        }
    }

    // 3. Load provider base_url and api_key
    let (base_url, api_key) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT base_url, api_key FROM providers WHERE id = ?1",
            rusqlite::params![provider_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|e| format!("图片生成服务商未找到。\nImage provider not found: {}", e))?
    };

    // 4. Read reference images from attachments (only first image is used by /images/edits)
    let image_attachments: Vec<_> = prepared_attachments
        .iter()
        .filter(|att| att.file_type == "image")
        .collect();
    if image_attachments.len() > 1 {
        eprintln!(
            "Image gen: {} image attachments provided, only the first will be used as reference",
            image_attachments.len()
        );
    }
    if let Some(att) = image_attachments.first() {
        let data = std::fs::read(&att.file_path)
            .map_err(|e| format!("Failed to read reference image: {}", e))?;
        request
            .reference_images
            .push(image_gen::ReferenceImage {
                data,
                mime_type: att.mime_type.clone(),
            });
    }

    // 5. Emit generating status
    let _ = app.emit(
        "image-gen-status",
        ImageGenStatusPayload {
            conversation_id: conversation_id.to_string(),
            phase: "generating".to_string(),
            message: None,
        },
    );

    // 6. Call the image generation API
    let result = if request.reference_images.is_empty() {
        image_gen::generate_images(&base_url, &api_key, &model, &request).await
    } else {
        image_gen::edit_images(&base_url, &api_key, &model, &request).await
    };

    let result = match result {
        Ok(r) => r,
        Err(e) => {
            let _ = app.emit(
                "image-gen-status",
                ImageGenStatusPayload {
                    conversation_id: conversation_id.to_string(),
                    phase: "failed".to_string(),
                    message: Some(e.clone()),
                },
            );
            return Err(e);
        }
    };

    // 7. Save results
    let _ = app.emit(
        "image-gen-status",
        ImageGenStatusPayload {
            conversation_id: conversation_id.to_string(),
            phase: "saving".to_string(),
            message: None,
        },
    );

    let n = result.images.len();
    let has_ref = !request.reference_images.is_empty();

    let assistant_msg_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let assistant_content = if has_ref {
        format!(
            "已基于参考图生成 {} 张图片。\nGenerated {} image(s) from reference.",
            n, n
        )
    } else {
        format!("已生成 {} 张图片。\nGenerated {} image(s).", n, n)
    };

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        // Save assistant message
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, 'assistant', ?3, ?4)",
            rusqlite::params![assistant_msg_id, conversation_id, assistant_content, now],
        )
        .map_err(|e| e.to_string())?;

        // Save each generated image as an attachment
        let metadata = serde_json::json!({
            "source": "generated",
            "generation": {
                "provider_id": provider_id,
                "model": model,
                "prompt": request.prompt,
                "revised_prompt": result.revised_prompt,
                "aspect_ratio": request.aspect_ratio,
                "quality": request.quality,
                "count": n,
                "background": request.background,
            }
        });

        for gen_image in &result.images {
            attachments::save_generated_image(
                &app_data_dir,
                &gen_image.data,
                &gen_image.mime_type,
                &assistant_msg_id,
                metadata.clone(),
                &conn,
            )?;
        }
    }

    // 8. Emit completion event (do NOT emit chat-stream-done — the frontend
    //    image-gen-status:done handler calls loadMessages which correctly
    //    loads the assistant message together with its image attachments)
    let _ = app.emit(
        "image-gen-status",
        ImageGenStatusPayload {
            conversation_id: conversation_id.to_string(),
            phase: "done".to_string(),
            message: None,
        },
    );

    Ok(())
}
