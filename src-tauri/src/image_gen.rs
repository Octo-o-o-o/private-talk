use base64::Engine;
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

// ── Parameter mapping ──────────────────────────────────────────────────

/// Map aspect_ratio to OpenAI size string.
fn map_size(aspect_ratio: &str, model: &str) -> String {
    let is_dalle3 = model.contains("dall-e-3");
    match aspect_ratio {
        "16:9" => {
            if is_dalle3 {
                "1792x1024"
            } else {
                "1536x1024"
            }
        }
        "9:16" => {
            if is_dalle3 {
                "1024x1792"
            } else {
                "1024x1536"
            }
        }
        _ => "1024x1024", // 1:1, 4:3, 3:4 fallback
    }
    .to_string()
}

/// Map unified quality value to OpenAI quality string.
fn map_quality(quality: &str, model: &str) -> String {
    let is_dalle3 = model.contains("dall-e-3");
    match quality {
        "hd" => {
            if is_dalle3 {
                "hd"
            } else {
                "high"
            }
        }
        _ => {
            if is_dalle3 {
                "standard"
            } else {
                "medium"
            }
        }
    }
    .to_string()
}

// ── API calls ──────────────────────────────────────────────────────────

/// POST {base_url}/images/generations — text-to-image, no reference.
pub async fn generate_images(
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
    let quality = request.quality.as_deref().unwrap_or("standard");
    let n = request.count.unwrap_or(1).max(1).min(4);

    let is_dalle3 = model.contains("dall-e-3");

    let mut body = serde_json::json!({
        "model": model,
        "prompt": request.prompt,
        "n": n,
        "size": map_size(ratio, model),
        "quality": map_quality(quality, model),
    });

    // DALL-E 3 uses response_format; gpt-image-1 uses output_format
    if is_dalle3 {
        body["response_format"] = serde_json::json!("b64_json");
    } else {
        body["output_format"] = serde_json::json!("png");
    }

    if let Some(bg) = &request.background {
        if !is_dalle3 {
            body["background"] = serde_json::json!(bg);
        }
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .timeout(std::time::Duration::from_secs(120))
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

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    parse_image_response(&json).await
}

/// POST {base_url}/images/edits — image editing with reference (multipart).
pub async fn edit_images(
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

    // Attach first reference image
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

/// Parse the OpenAI images response: data[].b64_json or data[].url
async fn parse_image_response(
    json: &serde_json::Value,
) -> Result<ImageGenerationResult, String> {
    let data = json
        .get("data")
        .and_then(|d| d.as_array())
        .ok_or("Response missing 'data' array")?;

    if data.is_empty() {
        return Err("API returned empty data array".to_string());
    }

    let revised_prompt = data
        .first()
        .and_then(|d| d.get("revised_prompt"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut images = Vec::new();
    let client = reqwest::Client::new();

    for item in data {
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
    fn test_map_size() {
        assert_eq!(map_size("1:1", "gpt-image-1"), "1024x1024");
        assert_eq!(map_size("16:9", "gpt-image-1"), "1536x1024");
        assert_eq!(map_size("16:9", "dall-e-3"), "1792x1024");
        assert_eq!(map_size("9:16", "gpt-image-1"), "1024x1536");
        assert_eq!(map_size("4:3", "gpt-image-1"), "1024x1024");
    }

    #[test]
    fn test_map_quality() {
        assert_eq!(map_quality("standard", "gpt-image-1"), "medium");
        assert_eq!(map_quality("hd", "gpt-image-1"), "high");
        assert_eq!(map_quality("standard", "dall-e-3"), "standard");
        assert_eq!(map_quality("hd", "dall-e-3"), "hd");
    }
}
