use base64::Engine;
use image::ImageFormat;
use reqwest::multipart;
use serde::{Deserialize, Serialize};

// ── Types ──────────────────────────────────────────────────────────────

/// Unified image generation request parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageGenerationRequest {
    pub prompt: String,
    pub aspect_ratio: Option<String>,
    pub quality: Option<String>,
    pub count: Option<u8>,
    pub background: Option<String>,
    #[serde(skip)]
    pub reference_images: Vec<ReferenceImage>,
}

#[derive(Debug, Clone)]
pub struct ReferenceImage {
    pub data: Vec<u8>,
    pub mime_type: String,
}

/// A single generated image.
pub struct GeneratedImage {
    pub data: Vec<u8>,
    pub mime_type: String,
}

/// Result of an image generation call.
pub struct ImageGenerationResult {
    pub images: Vec<GeneratedImage>,
    pub revised_prompt: Option<String>,
}

// ── Provider detection ────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ProviderKind {
    /// OpenAI: standard /images/generations + /images/edits (multipart)
    OpenAI,
    /// Grok/xAI: /images/generations with aspect_ratio, /images/edits with JSON body
    Grok,
    /// Gemini: uses native generateContent API for image generation
    Gemini,
    /// OpenRouter: image gen only via /chat/completions with modalities
    OpenRouter,
    /// SiliconFlow: /images/generations with image_size/batch_size, `images[]` response
    SiliconFlow,
    /// Local models (sd.cpp, LocalAI): minimal /images/generations, raw bytes response
    Local,
    /// Generic OpenAI-compatible (Zhipu, Volcengine, etc.): standard /images/generations
    Standard,
}

/// Detect provider from base_url.
pub fn detect_provider(base_url: &str) -> ProviderKind {
    let url = base_url.to_lowercase();
    if url.contains("api.openai.com") {
        ProviderKind::OpenAI
    } else if url.contains("api.x.ai") {
        ProviderKind::Grok
    } else if url.contains("generativelanguage.googleapis.com") || url.contains("gemini") {
        ProviderKind::Gemini
    } else if url.contains("openrouter.ai") {
        ProviderKind::OpenRouter
    } else if url.contains("siliconflow") {
        ProviderKind::SiliconFlow
    } else if url.contains("localhost") || url.contains("127.0.0.1") || url.contains("0.0.0.0") {
        ProviderKind::Local
    } else {
        ProviderKind::Standard
    }
}

/// Detect models that need special (non-/images/*) handling.
/// Gemini uses native generateContent API; OpenRouter uses chat completions.
pub fn is_chat_image_model(base_url: &str, model: &str) -> bool {
    let provider = detect_provider(base_url);
    match provider {
        ProviderKind::Gemini => true,
        ProviderKind::OpenRouter => true,
        _ => model.starts_with("gemini-") && model.contains("image"),
    }
}

/// Check if a provider supports /images/edits for image-to-image.
#[allow(dead_code)]
pub fn supports_image_edits(base_url: &str) -> bool {
    match detect_provider(base_url) {
        ProviderKind::OpenAI | ProviderKind::Grok => true,
        _ => false,
    }
}

// ── Parameter mapping ──────────────────────────────────────────────────

/// Map aspect_ratio to size string based on model.
fn map_size(aspect_ratio: &str, model: &str) -> String {
    let is_dalle3 = model.contains("dall-e-3");
    let is_openai = is_dalle3 || model.starts_with("gpt-image");
    let is_local = detect_provider("") == ProviderKind::Local
        || model.to_lowercase().contains("stablediffusion")
        || model.to_lowercase().contains("z-image")
        || model.to_lowercase().contains("stable-diffusion")
        || model.to_lowercase().contains("sdxl");

    match aspect_ratio {
        "16:9" => {
            if is_dalle3 {
                "1792x1024"
            } else if is_openai {
                "1536x1024"
            } else if is_local {
                "1024x576"
            } else {
                "1536x1024"
            }
        }
        "9:16" => {
            if is_dalle3 {
                "1024x1792"
            } else if is_openai {
                "1024x1536"
            } else if is_local {
                "576x1024"
            } else {
                "1024x1536"
            }
        }
        "4:3" => {
            if is_openai {
                "1024x1024"
            } else {
                "1024x768"
            }
        }
        "3:4" => {
            if is_openai {
                "1024x1024"
            } else {
                "768x1024"
            }
        }
        _ => "1024x1024",
    }
    .to_string()
}

/// Map unified quality value to provider-specific quality string.
fn map_quality(quality: &str, model: &str) -> Option<String> {
    let is_dalle3 = model.contains("dall-e-3");
    let is_openai = is_dalle3 || model.starts_with("gpt-image");

    if is_openai {
        Some(
            match quality {
                "hd" => {
                    if is_dalle3 { "hd" } else { "high" }
                }
                _ => {
                    if is_dalle3 { "standard" } else { "medium" }
                }
            }
            .to_string(),
        )
    } else {
        None
    }
}

/// Convert image bytes to PNG if not already PNG.
/// Gemini's API rejects non-PNG images with "Unhandled generated data mime type".
fn ensure_png(data: &[u8], mime_type: &str) -> Result<(Vec<u8>, String), String> {
    if mime_type == "image/png" {
        return Ok((data.to_vec(), "image/png".to_string()));
    }
    let img = image::load_from_memory(data)
        .map_err(|e| format!("Failed to decode reference image: {}", e))?;
    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, ImageFormat::Png)
        .map_err(|e| format!("Failed to convert image to PNG: {}", e))?;
    Ok((buf.into_inner(), "image/png".to_string()))
}

// ── API calls ──────────────────────────────────────────────────────────

/// Main entry point for text-to-image generation (no reference images).
/// Routes to the correct API based on provider.
pub async fn generate_images(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: &ImageGenerationRequest,
) -> Result<ImageGenerationResult, String> {
    let provider = detect_provider(base_url);

    match provider {
        ProviderKind::Grok => generate_grok(base_url, api_key, model, request).await,
        ProviderKind::SiliconFlow => generate_siliconflow(base_url, api_key, model, request).await,
        _ => generate_openai_compat(base_url, api_key, model, request, provider).await,
    }
}

/// Main entry point for image-to-image editing (with reference images).
/// Routes to the correct API based on provider.
pub async fn edit_images(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: &ImageGenerationRequest,
) -> Result<ImageGenerationResult, String> {
    let provider = detect_provider(base_url);

    match provider {
        ProviderKind::OpenAI => edit_openai(base_url, api_key, model, request).await,
        ProviderKind::Grok => edit_grok(base_url, api_key, model, request).await,
        // Providers that don't support /images/edits — fall back to text-only generation
        _ => generate_images(base_url, api_key, model, request).await,
    }
}

/// Dispatch for chat/native-based image generation.
/// Gemini uses native generateContent API; OpenRouter uses chat completions.
pub async fn generate_via_chat(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: &ImageGenerationRequest,
) -> Result<ImageGenerationResult, String> {
    let provider = detect_provider(base_url);
    match provider {
        ProviderKind::Gemini => generate_gemini_native(base_url, api_key, model, request).await,
        _ => generate_openrouter_chat(base_url, api_key, model, request).await,
    }
}

/// Gemini native generateContent API — bypasses the flaky OpenAI compat layer.
/// URL: POST /v1beta/models/{model}:generateContent?key={api_key}
async fn generate_gemini_native(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: &ImageGenerationRequest,
) -> Result<ImageGenerationResult, String> {
    // Derive the native API base from the OpenAI-compat base_url
    // e.g. "https://generativelanguage.googleapis.com/v1beta/openai"
    //    → "https://generativelanguage.googleapis.com/v1beta"
    let native_base = base_url
        .trim_end_matches('/')
        .trim_end_matches("/openai")
        .trim_end_matches('/');
    let url = format!(
        "{}/models/{}:generateContent?key={}",
        native_base, model, api_key
    );

    // Build content parts
    let mut parts = Vec::new();

    // Add reference images (as inline_data)
    for ref_img in &request.reference_images {
        let (png_data, mime) = ensure_png(&ref_img.data, &ref_img.mime_type)?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&png_data);
        parts.push(serde_json::json!({
            "inline_data": {
                "mime_type": mime,
                "data": b64
            }
        }));
    }

    // Add text prompt
    parts.push(serde_json::json!({ "text": request.prompt }));

    let body = serde_json::json!({
        "contents": [
            {
                "parts": parts
            }
        ],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"]
        }
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .timeout(std::time::Duration::from_secs(120))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini image generation request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "Gemini image generation API error ({}): {}",
            status, text
        ));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;

    // Log response structure for debugging (truncate large base64 data)
    if let Some(obj) = json.as_object() {
        let keys: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
        eprintln!("[image_gen] Gemini native response keys: {:?}", keys);
    }

    parse_gemini_native_response(&json)
}

/// Parse Gemini native generateContent response.
/// Response: candidates[0].content.parts[] containing {text} and {inline_data: {mime_type, data}}.
fn parse_gemini_native_response(
    json: &serde_json::Value,
) -> Result<ImageGenerationResult, String> {
    // Check for prompt-level blocks
    if let Some(feedback) = json.get("promptFeedback") {
        if let Some(reason) = feedback.get("blockReason").and_then(|r| r.as_str()) {
            return Err(format!(
                "Gemini blocked the request ({}). Try a different prompt.",
                reason
            ));
        }
    }

    let candidates = json
        .get("candidates")
        .and_then(|c| c.as_array())
        .ok_or_else(|| {
            if let Some(err) = json.get("error") {
                format!("Gemini API error: {}", err)
            } else {
                // Dump response keys for diagnostics
                let keys: Vec<&str> = json
                    .as_object()
                    .map(|o| o.keys().map(|k| k.as_str()).collect())
                    .unwrap_or_default();
                format!(
                    "Gemini response missing 'candidates'. Response keys: [{}]",
                    keys.join(", ")
                )
            }
        })?;

    let candidate = candidates.first().ok_or("Gemini returned empty candidates")?;

    // Check for candidate-level safety blocks
    if let Some(reason) = candidate.get("finishReason").and_then(|r| r.as_str()) {
        if reason.contains("SAFETY") || reason == "RECITATION" || reason == "BLOCKLIST" {
            return Err(format!(
                "Gemini image generation blocked (finishReason: {}). Try a different prompt.",
                reason
            ));
        }
    }

    let parts = candidate
        .get("content")
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.as_array())
        .ok_or_else(|| {
            // Show candidate structure for debugging
            let finish_reason = candidate
                .get("finishReason")
                .and_then(|r| r.as_str())
                .unwrap_or("unknown");
            format!(
                "Gemini response has no content parts (finishReason: {})",
                finish_reason
            )
        })?;

    let mut images = Vec::new();
    let mut text_content = String::new();

    for part in parts {
        if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
            text_content.push_str(text);
        }
        // Gemini native API uses camelCase: inlineData, mimeType
        let inline_data = part.get("inlineData").or_else(|| part.get("inline_data"));
        if let Some(idata) = inline_data {
            let mime = idata
                .get("mimeType")
                .or_else(|| idata.get("mime_type"))
                .and_then(|m| m.as_str())
                .unwrap_or("image/png");
            if let Some(b64) = idata.get("data").and_then(|d| d.as_str()) {
                if let Ok(data) = base64::engine::general_purpose::STANDARD.decode(b64) {
                    images.push(GeneratedImage {
                        data,
                        mime_type: mime.to_string(),
                    });
                }
            }
        }
    }

    if images.is_empty() {
        // Log part types for debugging
        let part_types: Vec<String> = parts
            .iter()
            .map(|p| {
                p.as_object()
                    .map(|o| o.keys().cloned().collect::<Vec<_>>().join(","))
                    .unwrap_or_else(|| "?".to_string())
            })
            .collect();
        return Err(format!(
            "No images in Gemini response. Part types: [{}]. Text: {}",
            part_types.join("; "),
            if text_content.len() > 300 {
                format!("{}...", &text_content[..300])
            } else if text_content.is_empty() {
                "(empty)".to_string()
            } else {
                text_content
            }
        ));
    }

    Ok(ImageGenerationResult {
        images,
        revised_prompt: if text_content.is_empty() {
            None
        } else {
            Some(text_content)
        },
    })
}

/// OpenRouter / generic chat completions image generation.
async fn generate_openrouter_chat(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: &ImageGenerationRequest,
) -> Result<ImageGenerationResult, String> {
    let url = format!(
        "{}/chat/completions",
        base_url.trim_end_matches('/')
    );

    let mut parts = Vec::new();

    for ref_img in &request.reference_images {
        let b64 = base64::engine::general_purpose::STANDARD.encode(&ref_img.data);
        let data_url = format!("data:{};base64,{}", ref_img.mime_type, b64);
        parts.push(serde_json::json!({
            "type": "image_url",
            "image_url": { "url": data_url }
        }));
    }

    parts.push(serde_json::json!({
        "type": "text",
        "text": request.prompt
    }));

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": parts
            }
        ],
        "modalities": ["text", "image"],
        "max_tokens": 4096
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .timeout(std::time::Duration::from_secs(120))
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Chat image generation request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "Chat image generation API error ({}): {}",
            status, text
        ));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse chat response: {}", e))?;

    parse_chat_image_response(&json).await
}

// ── Provider-specific implementations ─────────────────────────────────

/// OpenAI-compatible /images/generations (OpenAI, Zhipu, Volcengine, local models).
async fn generate_openai_compat(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: &ImageGenerationRequest,
    provider: ProviderKind,
) -> Result<ImageGenerationResult, String> {
    let url = format!(
        "{}/images/generations",
        base_url.trim_end_matches('/')
    );

    let ratio = request.aspect_ratio.as_deref().unwrap_or("1:1");
    let quality = request.quality.as_deref().unwrap_or("standard");
    let n = request.count.unwrap_or(1).max(1).min(4);

    let is_dalle3 = model.contains("dall-e-3");
    let is_openai = is_dalle3 || model.starts_with("gpt-image");

    let mut body = serde_json::json!({
        "prompt": request.prompt,
        "model": model,
        "n": n,
        "size": map_size(ratio, model),
    });

    if let Some(q) = map_quality(quality, model) {
        body["quality"] = serde_json::json!(q);
    }

    if is_openai {
        if is_dalle3 {
            body["response_format"] = serde_json::json!("b64_json");
        } else {
            body["output_format"] = serde_json::json!("png");
        }
        if let Some(bg) = &request.background {
            body["background"] = serde_json::json!(bg);
        }
    }

    let timeout_secs = if provider == ProviderKind::Local { 600 } else { 120 };

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Image generation request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "Image generation API error ({}): {}",
            status, text
        ));
    }

    // Local servers (e.g. sd.cpp) may return raw image bytes
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    if content_type.starts_with("image/") {
        let mime = if content_type.contains("png") {
            "image/png"
        } else if content_type.contains("jpeg") || content_type.contains("jpg") {
            "image/jpeg"
        } else {
            "image/png"
        };
        let data = resp
            .bytes()
            .await
            .map_err(|e| format!("Failed to read image bytes: {}", e))?
            .to_vec();
        return Ok(ImageGenerationResult {
            images: vec![GeneratedImage {
                data,
                mime_type: mime.to_string(),
            }],
            revised_prompt: None,
        });
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    parse_image_response(&json).await
}

/// Grok /images/generations — uses aspect_ratio + resolution instead of size.
async fn generate_grok(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: &ImageGenerationRequest,
) -> Result<ImageGenerationResult, String> {
    let url = format!(
        "{}/images/generations",
        base_url.trim_end_matches('/')
    );

    let ratio = request.aspect_ratio.as_deref().unwrap_or("1:1");
    let n = request.count.unwrap_or(1).max(1).min(10);

    let body = serde_json::json!({
        "model": model,
        "prompt": request.prompt,
        "n": n,
        "aspect_ratio": ratio,
        "response_format": "b64_json",
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .timeout(std::time::Duration::from_secs(120))
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Grok image generation request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "Grok image generation API error ({}): {}",
            status, text
        ));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Grok response: {}", e))?;

    parse_image_response(&json).await
}

/// Grok /images/edits — uses JSON body with image data URL, not multipart.
async fn edit_grok(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: &ImageGenerationRequest,
) -> Result<ImageGenerationResult, String> {
    let url = format!("{}/images/edits", base_url.trim_end_matches('/'));

    let ratio = request.aspect_ratio.as_deref().unwrap_or("1:1");
    let n = request.count.unwrap_or(1).max(1).min(10);

    let mut body = serde_json::json!({
        "model": model,
        "prompt": request.prompt,
        "n": n,
        "aspect_ratio": ratio,
        "response_format": "b64_json",
    });

    // Grok accepts reference image as a data URL in JSON body
    if let Some(ref_img) = request.reference_images.first() {
        let b64 = base64::engine::general_purpose::STANDARD.encode(&ref_img.data);
        let data_url = format!("data:{};base64,{}", ref_img.mime_type, b64);
        body["image"] = serde_json::json!({
            "url": data_url,
            "type": "image_url"
        });
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .timeout(std::time::Duration::from_secs(120))
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Grok image edit request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Grok image edit API error ({}): {}", status, text));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Grok response: {}", e))?;

    parse_image_response(&json).await
}

/// OpenAI /images/edits — multipart form upload.
async fn edit_openai(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: &ImageGenerationRequest,
) -> Result<ImageGenerationResult, String> {
    let url = format!("{}/images/edits", base_url.trim_end_matches('/'));

    let ratio = request.aspect_ratio.as_deref().unwrap_or("1:1");
    let n = request.count.unwrap_or(1).max(1).min(4);

    let mut form = multipart::Form::new()
        .text("model", model.to_string())
        .text("prompt", request.prompt.clone())
        .text("n", n.to_string())
        .text("size", map_size(ratio, model));

    if let Some(ref_img) = request.reference_images.first() {
        let ext = match ref_img.mime_type.as_str() {
            "image/png" => "png",
            "image/webp" => "webp",
            _ => "png",
        };
        let part = multipart::Part::bytes(ref_img.data.clone())
            .file_name(format!("reference.{}", ext))
            .mime_str(&ref_img.mime_type)
            .map_err(|e| format!("Failed to build multipart: {}", e))?;
        form = form.part("image", part);
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .timeout(std::time::Duration::from_secs(120))
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Image edit request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Image edit API error ({}): {}", status, text));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    parse_image_response(&json).await
}

/// SiliconFlow /images/generations — non-standard params and response format.
async fn generate_siliconflow(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: &ImageGenerationRequest,
) -> Result<ImageGenerationResult, String> {
    let url = format!(
        "{}/images/generations",
        base_url.trim_end_matches('/')
    );

    let ratio = request.aspect_ratio.as_deref().unwrap_or("1:1");
    let n = request.count.unwrap_or(1).max(1).min(4);

    // SiliconFlow uses image_size (WxH) instead of size, batch_size instead of n
    let body = serde_json::json!({
        "model": model,
        "prompt": request.prompt,
        "image_size": map_size(ratio, model),
        "batch_size": n,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .timeout(std::time::Duration::from_secs(120))
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("SiliconFlow image generation request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "SiliconFlow image generation API error ({}): {}",
            status, text
        ));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse SiliconFlow response: {}", e))?;

    // SiliconFlow returns { "images": [{"url": "..."}] } instead of { "data": [...] }
    parse_image_response_flexible(&json).await
}

// ── Response parsers ──────────────────────────────────────────────────

/// Parse chat completions response containing inline images.
/// Handles both Gemini (content parts) and OpenRouter (images[] array) formats.
async fn parse_chat_image_response(
    json: &serde_json::Value,
) -> Result<ImageGenerationResult, String> {
    let choices = json
        .get("choices")
        .and_then(|c| c.as_array())
        .ok_or("Chat response missing 'choices' array")?;

    let message = choices
        .first()
        .and_then(|c| c.get("message"))
        .ok_or("Chat response missing message")?;

    let mut images = Vec::new();
    let mut text_content = String::new();

    // OpenRouter: images in message.images[] array
    if let Some(img_array) = message.get("images").and_then(|i| i.as_array()) {
        for img_item in img_array {
            if let Some(url) = img_item
                .get("image_url")
                .and_then(|iu| iu.get("url"))
                .and_then(|u| u.as_str())
            {
                if let Some(image) = decode_data_url_image(url) {
                    images.push(image);
                }
            }
        }
    }

    // Gemini / standard: images in message.content[] parts
    let content = message.get("content");
    if let Some(content_str) = content.and_then(|c| c.as_str()) {
        text_content = content_str.to_string();
    } else if let Some(content_parts) = content.and_then(|c| c.as_array()) {
        for part in content_parts {
            let part_type = part.get("type").and_then(|t| t.as_str()).unwrap_or("");
            match part_type {
                "text" => {
                    if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                        text_content.push_str(t);
                    }
                }
                "image_url" => {
                    if let Some(url) = part
                        .get("image_url")
                        .and_then(|iu| iu.get("url"))
                        .and_then(|u| u.as_str())
                    {
                        if let Some(image) = decode_data_url_image(url) {
                            images.push(image);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    if images.is_empty() {
        return Err(format!(
            "No images found in chat response. Text: {}",
            if text_content.len() > 200 {
                format!("{}...", &text_content[..200])
            } else {
                text_content
            }
        ));
    }

    Ok(ImageGenerationResult {
        images,
        revised_prompt: if text_content.is_empty() {
            None
        } else {
            Some(text_content)
        },
    })
}

/// Decode a data URL (data:image/png;base64,...) into image bytes.
fn decode_data_url_image(url: &str) -> Option<GeneratedImage> {
    let url = url.strip_prefix("data:")?;
    let (header, b64) = url.split_once(";base64,")?;
    let mime_type = if header.contains("png") {
        "image/png"
    } else if header.contains("jpeg") || header.contains("jpg") {
        "image/jpeg"
    } else if header.contains("webp") {
        "image/webp"
    } else {
        "image/png"
    };
    let data = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .ok()?;
    Some(GeneratedImage {
        data,
        mime_type: mime_type.to_string(),
    })
}

/// Flexible image response parser: handles both OpenAI `data[]` and SiliconFlow `images[]`.
async fn parse_image_response_flexible(
    json: &serde_json::Value,
) -> Result<ImageGenerationResult, String> {
    // Try standard data[] first, then SiliconFlow images[]
    let items = json
        .get("data")
        .and_then(|d| d.as_array())
        .or_else(|| json.get("images").and_then(|d| d.as_array()))
        .ok_or("Response missing both 'data' and 'images' arrays")?;

    if items.is_empty() {
        return Err("API returned empty image array".to_string());
    }

    let revised_prompt = items
        .first()
        .and_then(|d| d.get("revised_prompt"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut images = Vec::new();
    let client = reqwest::Client::new();

    for item in items {
        let image_data = if let Some(b64) = item.get("b64_json").and_then(|v| v.as_str()) {
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| format!("Failed to decode base64 image: {}", e))?
        } else if let Some(url) = item.get("url").and_then(|v| v.as_str()) {
            client
                .get(url)
                .timeout(std::time::Duration::from_secs(60))
                .send()
                .await
                .map_err(|e| format!("Failed to download image: {}", e))?
                .bytes()
                .await
                .map_err(|e| format!("Failed to read image bytes: {}", e))?
                .to_vec()
        } else {
            return Err("Image data contains neither b64_json nor url".to_string());
        };

        images.push(GeneratedImage {
            data: image_data,
            mime_type: "image/png".to_string(),
        });
    }

    Ok(ImageGenerationResult {
        images,
        revised_prompt,
    })
}

/// Parse standard OpenAI images response: data[].b64_json or data[].url
async fn parse_image_response(
    json: &serde_json::Value,
) -> Result<ImageGenerationResult, String> {
    parse_image_response_flexible(json).await
}

// ── /img command parser ────────────────────────────────────────────────

/// Parse "/img prompt --ratio 16:9 --quality hd" into ImageGenerationRequest.
pub fn parse_img_command(
    content: &str,
    default_ratio: &str,
    default_quality: &str,
) -> Result<ImageGenerationRequest, String> {
    // Strip /img prefix
    let text = if let Some(rest) = content.strip_prefix("/img ") {
        rest
    } else if let Some(rest) = content.strip_prefix("/img\n") {
        rest
    } else if content == "/img" {
        return Err("请在 /img 后输入图片描述。\nPlease provide an image description after /img.".to_string());
    } else {
        content
    };

    let mut aspect_ratio: Option<String> = None;
    let mut quality: Option<String> = None;
    let mut count: Option<u8> = None;
    let mut background: Option<String> = None;

    // Tokenize and extract --key value / -k value from end
    let tokens: Vec<&str> = text.split_whitespace().collect();
    let mut prompt_end = tokens.len();
    let mut i = tokens.len();

    while i >= 2 {
        let key = tokens[i - 2];
        let val = tokens[i - 1];

        match key {
            "--ratio" | "-r" => {
                match val {
                    "1:1" | "16:9" | "9:16" | "4:3" | "3:4" => {
                        aspect_ratio = Some(val.to_string());
                    }
                    _ => break, // unknown value, stop scanning
                }
                prompt_end = i - 2;
                i -= 2;
            }
            "--quality" | "-q" => {
                match val {
                    "standard" | "hd" => {
                        quality = Some(val.to_string());
                    }
                    _ => break,
                }
                prompt_end = i - 2;
                i -= 2;
            }
            "--count" | "-n" => {
                if let Ok(n) = val.parse::<u8>() {
                    if (1..=4).contains(&n) {
                        count = Some(n);
                        prompt_end = i - 2;
                        i -= 2;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
            "--bg" => {
                match val {
                    "auto" | "transparent" | "opaque" => {
                        background = Some(val.to_string());
                    }
                    _ => break,
                }
                prompt_end = i - 2;
                i -= 2;
            }
            _ => break,
        }
    }

    let prompt = tokens[..prompt_end].join(" ");
    let prompt = prompt.trim().to_string();

    if prompt.is_empty() {
        return Err("请在 /img 后输入图片描述。\nPlease provide an image description after /img.".to_string());
    }

    Ok(ImageGenerationRequest {
        prompt,
        aspect_ratio: aspect_ratio.or_else(|| Some(default_ratio.to_string())),
        quality: quality.or_else(|| Some(default_quality.to_string())),
        count,
        background,
        reference_images: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_prompt() {
        let req = parse_img_command("/img a cyberpunk cat", "1:1", "standard").unwrap();
        assert_eq!(req.prompt, "a cyberpunk cat");
        assert_eq!(req.aspect_ratio.as_deref(), Some("1:1"));
        assert_eq!(req.quality.as_deref(), Some("standard"));
        assert!(req.count.is_none());
    }

    #[test]
    fn test_parse_with_params() {
        let req =
            parse_img_command("/img 橘猫 --ratio 16:9 --quality hd", "1:1", "standard").unwrap();
        assert_eq!(req.prompt, "橘猫");
        assert_eq!(req.aspect_ratio.as_deref(), Some("16:9"));
        assert_eq!(req.quality.as_deref(), Some("hd"));
    }

    #[test]
    fn test_parse_all_params() {
        let req = parse_img_command(
            "/img logo design --bg transparent --count 2 --ratio 1:1 --quality hd",
            "1:1",
            "standard",
        )
        .unwrap();
        assert_eq!(req.prompt, "logo design");
        assert_eq!(req.background.as_deref(), Some("transparent"));
        assert_eq!(req.count, Some(2));
        assert_eq!(req.aspect_ratio.as_deref(), Some("1:1"));
        assert_eq!(req.quality.as_deref(), Some("hd"));
    }

    #[test]
    fn test_parse_short_flags() {
        let req = parse_img_command("/img sunset -r 9:16 -q hd -n 3", "1:1", "standard").unwrap();
        assert_eq!(req.prompt, "sunset");
        assert_eq!(req.aspect_ratio.as_deref(), Some("9:16"));
        assert_eq!(req.quality.as_deref(), Some("hd"));
        assert_eq!(req.count, Some(3));
    }

    #[test]
    fn test_parse_empty_prompt_error() {
        let result = parse_img_command("/img", "1:1", "standard");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_only_params_error() {
        let result = parse_img_command("/img --ratio 16:9", "1:1", "standard");
        assert!(result.is_err());
    }

    #[test]
    fn test_detect_provider() {
        assert_eq!(detect_provider("https://api.openai.com/v1"), ProviderKind::OpenAI);
        assert_eq!(detect_provider("https://api.x.ai/v1"), ProviderKind::Grok);
        assert_eq!(detect_provider("https://openrouter.ai/api/v1"), ProviderKind::OpenRouter);
        assert_eq!(detect_provider("https://api.siliconflow.cn/v1"), ProviderKind::SiliconFlow);
        assert_eq!(detect_provider("http://localhost:8080/v1"), ProviderKind::Local);
        assert_eq!(detect_provider("http://127.0.0.1:1234/v1"), ProviderKind::Local);
        // Gemini
        assert_eq!(detect_provider("https://generativelanguage.googleapis.com/v1beta/openai"), ProviderKind::Gemini);
        // Zhipu, Volcengine, etc. → Standard
        assert_eq!(detect_provider("https://open.bigmodel.cn/api/paas/v4"), ProviderKind::Standard);
        assert_eq!(detect_provider("https://ark.cn-beijing.volces.com/api/v3"), ProviderKind::Standard);
    }

    #[test]
    fn test_is_chat_image_model() {
        // Gemini → native API
        assert!(is_chat_image_model("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-3.1-flash-image-preview"));
        assert!(is_chat_image_model("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.5-flash-image"));
        // OpenRouter → chat completions
        assert!(is_chat_image_model("https://openrouter.ai/api/v1", "google/gemini-2.5-flash-image"));
        assert!(is_chat_image_model("https://openrouter.ai/api/v1", "openai/gpt-image-1"));
        // OpenAI → /images/* endpoints
        assert!(!is_chat_image_model("https://api.openai.com/v1", "gpt-image-1"));
        // Grok → /images/* endpoints
        assert!(!is_chat_image_model("https://api.x.ai/v1", "grok-imagine-image"));
    }

    #[test]
    fn test_supports_image_edits() {
        assert!(supports_image_edits("https://api.openai.com/v1"));
        assert!(supports_image_edits("https://api.x.ai/v1"));
        assert!(!supports_image_edits("https://open.bigmodel.cn/api/paas/v4"));
        assert!(!supports_image_edits("https://openrouter.ai/api/v1"));
        assert!(!supports_image_edits("https://api.siliconflow.cn/v1"));
    }

    #[test]
    fn test_map_size() {
        // OpenAI models
        assert_eq!(map_size("1:1", "gpt-image-1"), "1024x1024");
        assert_eq!(map_size("16:9", "gpt-image-1"), "1536x1024");
        assert_eq!(map_size("16:9", "dall-e-3"), "1792x1024");
        assert_eq!(map_size("9:16", "gpt-image-1"), "1024x1536");
        assert_eq!(map_size("4:3", "gpt-image-1"), "1024x1024");
        // Local / SD models
        assert_eq!(map_size("1:1", "stablediffusion"), "1024x1024");
        assert_eq!(map_size("16:9", "z-image-turbo"), "1024x576");
        assert_eq!(map_size("9:16", "z-image-turbo"), "576x1024");
        assert_eq!(map_size("4:3", "z-image-turbo"), "1024x768");
        assert_eq!(map_size("3:4", "z-image-turbo"), "768x1024");
        // Cloud providers (Gemini, Grok, etc.) — full resolution
        assert_eq!(map_size("16:9", "gemini-3.1-flash-image-preview"), "1536x1024");
        assert_eq!(map_size("9:16", "grok-imagine-image"), "1024x1536");
        assert_eq!(map_size("4:3", "cogView-4-250304"), "1024x768");
    }

    #[test]
    fn test_map_quality() {
        assert_eq!(map_quality("standard", "gpt-image-1"), Some("medium".to_string()));
        assert_eq!(map_quality("hd", "gpt-image-1"), Some("high".to_string()));
        assert_eq!(map_quality("standard", "dall-e-3"), Some("standard".to_string()));
        assert_eq!(map_quality("hd", "dall-e-3"), Some("hd".to_string()));
        // Non-OpenAI providers return None
        assert_eq!(map_quality("hd", "cogView-4-250304"), None);
        assert_eq!(map_quality("standard", "grok-imagine-image"), None);
    }
}
