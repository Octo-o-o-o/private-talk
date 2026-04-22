use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::multipart;
use serde::{Deserialize, Serialize};
use serde_json::json;

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

pub struct GeneratedImage {
    pub data: Vec<u8>,
    pub mime_type: String,
}

pub struct ImageGenerationResult {
    pub images: Vec<GeneratedImage>,
    pub revised_prompt: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProviderKind {
    OpenAiCompatible,
    Grok,
}

fn detect_provider(base_url: &str) -> ProviderKind {
    let url = base_url.to_lowercase();
    if url.contains("api.x.ai") {
        ProviderKind::Grok
    } else {
        ProviderKind::OpenAiCompatible
    }
}

fn map_size(aspect_ratio: &str) -> &'static str {
    match aspect_ratio {
        "16:9" => "1536x1024",
        "9:16" => "1024x1536",
        "4:3" => "1024x768",
        "3:4" => "768x1024",
        _ => "1024x1024",
    }
}

fn map_quality(quality: &str, model: &str) -> Option<String> {
    if model.contains("dall-e-3") {
        Some(if quality == "hd" { "hd" } else { "standard" }.to_string())
    } else if model.starts_with("gpt-image") {
        Some(if quality == "hd" { "high" } else { "medium" }.to_string())
    } else {
        None
    }
}

async fn parse_image_response(
    response: reqwest::Response,
) -> Result<ImageGenerationResult, String> {
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();

    if content_type.starts_with("image/") {
        let mime_type = content_type;
        let data = response
            .bytes()
            .await
            .map_err(|error| format!("Failed to read image bytes: {error}"))?
            .to_vec();

        return Ok(ImageGenerationResult {
            images: vec![GeneratedImage { data, mime_type }],
            revised_prompt: None,
        });
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse image response: {error}"))?;

    let revised_prompt = json
        .get("revised_prompt")
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
        .or_else(|| {
            json.get("data")
                .and_then(|value| value.as_array())
                .and_then(|items| items.first())
                .and_then(|item| item.get("revised_prompt"))
                .and_then(|value| value.as_str())
                .map(ToString::to_string)
        });

    let items = json
        .get("data")
        .and_then(|value| value.as_array())
        .or_else(|| json.get("images").and_then(|value| value.as_array()))
        .ok_or_else(|| format!("Unsupported image response payload: {json}"))?;

    let client = reqwest::Client::new();
    let mut images = Vec::new();

    for item in items {
        if let Some(value) = item.get("b64_json").and_then(|value| value.as_str()) {
            let data = BASE64
                .decode(value)
                .map_err(|error| format!("Invalid base64 image payload: {error}"))?;
            images.push(GeneratedImage {
                data,
                mime_type: "image/png".to_string(),
            });
            continue;
        }

        if let Some(value) = item.get("base64").and_then(|value| value.as_str()) {
            let data = BASE64
                .decode(value)
                .map_err(|error| format!("Invalid base64 image payload: {error}"))?;
            images.push(GeneratedImage {
                data,
                mime_type: "image/png".to_string(),
            });
            continue;
        }

        if let Some(url) = item.get("url").and_then(|value| value.as_str()) {
            let download = client
                .get(url)
                .send()
                .await
                .map_err(|error| format!("Failed to download generated image: {error}"))?;
            if !download.status().is_success() {
                let status = download.status();
                let body = download.text().await.unwrap_or_default();
                return Err(format!("Image download failed ({status}): {body}"));
            }

            let mime_type = download
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("image/png")
                .to_string();
            let data = download
                .bytes()
                .await
                .map_err(|error| format!("Failed to read downloaded image: {error}"))?
                .to_vec();
            images.push(GeneratedImage { data, mime_type });
        }
    }

    if images.is_empty() {
        return Err("Image provider returned no usable image data.".to_string());
    }

    Ok(ImageGenerationResult {
        images,
        revised_prompt,
    })
}

pub async fn generate_images(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: &ImageGenerationRequest,
) -> Result<ImageGenerationResult, String> {
    let provider = detect_provider(base_url);
    let url = format!("{}/images/generations", base_url.trim_end_matches('/'));
    let ratio = request.aspect_ratio.as_deref().unwrap_or("1:1");
    let quality = request.quality.as_deref().unwrap_or("standard");
    let count = request.count.unwrap_or(1).clamp(1, 4);

    let mut body = json!({
        "model": model,
        "prompt": request.prompt,
        "n": count,
        "response_format": "b64_json",
    });

    if provider == ProviderKind::Grok {
        body["aspect_ratio"] = json!(ratio);
    } else {
        body["size"] = json!(map_size(ratio));
        if let Some(mapped_quality) = map_quality(quality, model) {
            body["quality"] = json!(mapped_quality);
        }
        if let Some(background) = &request.background {
            body["background"] = json!(background);
        }
    }

    let response = reqwest::Client::new()
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Image generation request failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Image generation API error ({status}): {body}"));
    }

    parse_image_response(response).await
}

pub async fn edit_images(
    base_url: &str,
    api_key: &str,
    model: &str,
    request: &ImageGenerationRequest,
) -> Result<ImageGenerationResult, String> {
    if request.reference_images.is_empty() {
        return generate_images(base_url, api_key, model, request).await;
    }

    if detect_provider(base_url) == ProviderKind::Grok {
        return generate_images(base_url, api_key, model, request).await;
    }

    let url = format!("{}/images/edits", base_url.trim_end_matches('/'));
    let ratio = request.aspect_ratio.as_deref().unwrap_or("1:1");
    let quality = request.quality.as_deref().unwrap_or("standard");
    let count = request.count.unwrap_or(1).clamp(1, 4);

    let mut form = multipart::Form::new()
        .text("model", model.to_string())
        .text("prompt", request.prompt.clone())
        .text("n", count.to_string())
        .text("size", map_size(ratio).to_string())
        .text("response_format", "b64_json".to_string());

    if let Some(mapped_quality) = map_quality(quality, model) {
        form = form.text("quality", mapped_quality);
    }
    if let Some(background) = &request.background {
        form = form.text("background", background.clone());
    }

    for (index, reference) in request.reference_images.iter().enumerate().take(1) {
        let part = multipart::Part::bytes(reference.data.clone())
            .file_name(format!("reference-{index}.png"))
            .mime_str(&reference.mime_type)
            .map_err(|error| format!("Invalid reference image mime type: {error}"))?;
        form = form.part("image", part);
    }

    let response = reqwest::Client::new()
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("Image edit request failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Image edit API error ({status}): {body}"));
    }

    parse_image_response(response).await
}

pub fn parse_img_command(
    content: &str,
    default_ratio: &str,
    default_quality: &str,
    default_background: &str,
) -> Result<ImageGenerationRequest, String> {
    let text = if let Some(rest) = content.strip_prefix("/img ") {
        rest
    } else if let Some(rest) = content.strip_prefix("/img\n") {
        rest
    } else if content == "/img" {
        return Err(
            "请在 /img 后输入图片描述。\nPlease provide an image description after /img."
                .to_string(),
        );
    } else {
        content
    };

    let mut aspect_ratio: Option<String> = None;
    let mut quality: Option<String> = None;
    let mut count: Option<u8> = None;
    let mut background: Option<String> = None;

    let tokens: Vec<&str> = text.split_whitespace().collect();
    let mut prompt_end = tokens.len();
    let mut index = tokens.len();

    while index >= 2 {
        let key = tokens[index - 2];
        let value = tokens[index - 1];

        match key {
            "--ratio" | "-r" => {
                match value {
                    "1:1" | "16:9" | "9:16" | "4:3" | "3:4" => {
                        aspect_ratio = Some(value.to_string());
                    }
                    _ => break,
                }
                prompt_end = index - 2;
                index -= 2;
            }
            "--quality" | "-q" => {
                match value {
                    "standard" | "hd" => {
                        quality = Some(value.to_string());
                    }
                    _ => break,
                }
                prompt_end = index - 2;
                index -= 2;
            }
            "--count" | "-n" => {
                if let Ok(parsed) = value.parse::<u8>() {
                    if (1..=4).contains(&parsed) {
                        count = Some(parsed);
                        prompt_end = index - 2;
                        index -= 2;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
            "--bg" => {
                match value {
                    "auto" | "transparent" | "opaque" => {
                        background = Some(value.to_string());
                    }
                    _ => break,
                }
                prompt_end = index - 2;
                index -= 2;
            }
            _ => break,
        }
    }

    let prompt = tokens[..prompt_end].join(" ").trim().to_string();
    if prompt.is_empty() {
        return Err(
            "请在 /img 后输入图片描述。\nPlease provide an image description after /img."
                .to_string(),
        );
    }

    Ok(ImageGenerationRequest {
        prompt,
        aspect_ratio: Some(aspect_ratio.unwrap_or_else(|| default_ratio.to_string())),
        quality: Some(quality.unwrap_or_else(|| default_quality.to_string())),
        count,
        background: Some(background.unwrap_or_else(|| default_background.to_string())),
        reference_images: Vec::new(),
    })
}
