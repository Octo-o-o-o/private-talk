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

#[derive(Debug)]
pub struct GeneratedImage {
    pub data: Vec<u8>,
    pub mime_type: String,
}

#[derive(Debug)]
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

#[cfg(test)]
mod tests {
    use super::{
        detect_provider, generate_images, map_quality, map_size, parse_img_command,
        ImageGenerationRequest, ProviderKind,
    };
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn parse(content: &str) -> Result<ImageGenerationRequest, String> {
        parse_img_command(content, "1:1", "standard", "auto")
    }

    fn req(prompt: &str) -> ImageGenerationRequest {
        ImageGenerationRequest {
            prompt: prompt.to_string(),
            aspect_ratio: Some("1:1".into()),
            quality: Some("standard".into()),
            count: Some(1),
            background: Some("auto".into()),
            reference_images: vec![],
        }
    }

    #[test]
    fn parses_prompt_only_input_with_defaults() {
        let request = parse("a watercolor of kyoto").expect("parse");
        assert_eq!(request.prompt, "a watercolor of kyoto");
        assert_eq!(request.aspect_ratio.as_deref(), Some("1:1"));
        assert_eq!(request.quality.as_deref(), Some("standard"));
        assert_eq!(request.background.as_deref(), Some("auto"));
        assert!(request.count.is_none());
    }

    #[test]
    fn parses_slash_img_prefix_with_space_or_newline() {
        let from_space = parse("/img a cat").expect("space");
        assert_eq!(from_space.prompt, "a cat");

        let from_newline = parse("/img\na cat").expect("newline");
        assert_eq!(from_newline.prompt, "a cat");
    }

    #[test]
    fn errors_on_bare_slash_img_with_no_prompt() {
        let err = parse("/img").expect_err("must error");
        assert!(err.contains("/img"));
    }

    #[test]
    fn extracts_all_trailing_flags_in_any_short_or_long_form() {
        let request = parse("a calm forest --ratio 16:9 --quality hd --count 3 --bg transparent")
            .expect("parse");
        assert_eq!(request.prompt, "a calm forest");
        assert_eq!(request.aspect_ratio.as_deref(), Some("16:9"));
        assert_eq!(request.quality.as_deref(), Some("hd"));
        assert_eq!(request.count, Some(3));
        assert_eq!(request.background.as_deref(), Some("transparent"));
    }

    #[test]
    fn supports_short_flag_aliases() {
        let request = parse("a calm forest -r 9:16 -q hd -n 2").expect("parse");
        assert_eq!(request.prompt, "a calm forest");
        assert_eq!(request.aspect_ratio.as_deref(), Some("9:16"));
        assert_eq!(request.quality.as_deref(), Some("hd"));
        assert_eq!(request.count, Some(2));
    }

    #[test]
    fn stops_flag_scan_at_first_unknown_pair_and_keeps_them_in_prompt() {
        // Backward flag parser walks token pairs from the tail; first unknown
        // pair terminates the scan, so --foo bar stays inside the prompt.
        let request = parse("/img --foo bar a cat --ratio 16:9").expect("parse");
        assert_eq!(request.prompt, "--foo bar a cat");
        assert_eq!(request.aspect_ratio.as_deref(), Some("16:9"));
    }

    #[test]
    fn rejects_out_of_range_count_by_stopping_scan() {
        // --count 5 is invalid; the parser stops and falls back to default count.
        let request = parse("/img a cat --count 5").expect("parse");
        assert_eq!(request.prompt, "a cat --count 5");
        assert!(request.count.is_none());
    }

    #[test]
    fn rejects_unknown_ratio_value_by_stopping_scan() {
        let request = parse("/img a cat --ratio 3:2").expect("parse");
        assert_eq!(request.prompt, "a cat --ratio 3:2");
        assert_eq!(request.aspect_ratio.as_deref(), Some("1:1")); // default
    }

    #[test]
    fn errors_when_prompt_is_empty_after_flag_extraction() {
        let err = parse("/img --ratio 16:9").expect_err("must error");
        assert!(err.contains("/img"));
    }

    #[test]
    fn detect_provider_recognizes_grok_by_host() {
        assert_eq!(detect_provider("https://api.x.ai/v1"), ProviderKind::Grok);
        assert_eq!(detect_provider("https://API.X.AI/v1"), ProviderKind::Grok);
        assert_eq!(
            detect_provider("https://api.openai.com/v1"),
            ProviderKind::OpenAiCompatible,
        );
        assert_eq!(
            detect_provider("https://my-proxy.local/v1"),
            ProviderKind::OpenAiCompatible,
        );
    }

    #[test]
    fn map_size_returns_known_sizes_for_each_ratio() {
        assert_eq!(map_size("1:1"), "1024x1024");
        assert_eq!(map_size("16:9"), "1536x1024");
        assert_eq!(map_size("9:16"), "1024x1536");
        assert_eq!(map_size("4:3"), "1024x768");
        assert_eq!(map_size("3:4"), "768x1024");
        // Anything else falls back to square.
        assert_eq!(map_size("garbage"), "1024x1024");
    }

    #[test]
    fn map_quality_picks_provider_specific_label() {
        assert_eq!(map_quality("hd", "dall-e-3").as_deref(), Some("hd"));
        assert_eq!(map_quality("standard", "dall-e-3").as_deref(), Some("standard"));
        assert_eq!(map_quality("hd", "gpt-image-1").as_deref(), Some("high"));
        assert_eq!(
            map_quality("standard", "gpt-image-1").as_deref(),
            Some("medium"),
        );
        // Unknown model family → no quality flag emitted.
        assert!(map_quality("hd", "grok-vision-1").is_none());
    }

    // ---------- parse_image_response (covered through generate_images) ----------

    // 1×1 transparent PNG bytes (smallest valid PNG).
    const TINY_PNG: [u8; 67] = [
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    #[tokio::test]
    async fn parses_b64_json_response_into_decoded_bytes() {
        let server = MockServer::start().await;
        let b64 = BASE64.encode(TINY_PNG);
        let payload = serde_json::json!({
            "data": [{ "b64_json": b64 }],
            "revised_prompt": "a clearer cat",
        });
        Mock::given(method("POST"))
            .and(path("/images/generations"))
            .and(header("Authorization", "Bearer test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(payload))
            .mount(&server)
            .await;

        let result = generate_images(&server.uri(), "test-key", "gpt-image-1", &req("a cat"))
            .await
            .expect("ok");
        assert_eq!(result.images.len(), 1);
        assert_eq!(result.images[0].data, TINY_PNG.to_vec());
        assert_eq!(result.images[0].mime_type, "image/png");
        assert_eq!(result.revised_prompt.as_deref(), Some("a clearer cat"));
    }

    #[tokio::test]
    async fn parses_base64_alias_in_data_array() {
        let server = MockServer::start().await;
        let b64 = BASE64.encode(TINY_PNG);
        let payload = serde_json::json!({
            "data": [{ "base64": b64 }],
        });
        Mock::given(method("POST"))
            .and(path("/images/generations"))
            .respond_with(ResponseTemplate::new(200).set_body_json(payload))
            .mount(&server)
            .await;

        let result = generate_images(&server.uri(), "k", "gpt-image-1", &req("x"))
            .await
            .expect("ok");
        assert_eq!(result.images.len(), 1);
        assert_eq!(result.images[0].data, TINY_PNG.to_vec());
    }

    #[tokio::test]
    async fn parses_inline_image_response_as_single_image() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/images/generations"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "image/png")
                    .set_body_bytes(TINY_PNG.to_vec()),
            )
            .mount(&server)
            .await;

        let result = generate_images(&server.uri(), "k", "gpt-image-1", &req("x"))
            .await
            .expect("ok");
        assert_eq!(result.images.len(), 1);
        assert_eq!(result.images[0].mime_type, "image/png");
        assert_eq!(result.images[0].data, TINY_PNG.to_vec());
        assert!(result.revised_prompt.is_none());
    }

    #[tokio::test]
    async fn falls_back_to_downloading_image_when_response_only_has_url() {
        let server = MockServer::start().await;

        // The "url" route the generator will redirect us to.
        Mock::given(method("GET"))
            .and(path("/img/abc.png"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "image/png")
                    .set_body_bytes(TINY_PNG.to_vec()),
            )
            .mount(&server)
            .await;

        let download_url = format!("{}/img/abc.png", server.uri());
        let payload = serde_json::json!({
            "data": [{ "url": download_url }],
        });
        Mock::given(method("POST"))
            .and(path("/images/generations"))
            .respond_with(ResponseTemplate::new(200).set_body_json(payload))
            .mount(&server)
            .await;

        let result = generate_images(&server.uri(), "k", "gpt-image-1", &req("x"))
            .await
            .expect("ok");
        assert_eq!(result.images.len(), 1);
        assert_eq!(result.images[0].data, TINY_PNG.to_vec());
        assert_eq!(result.images[0].mime_type, "image/png");
    }

    #[tokio::test]
    async fn errors_when_response_has_no_usable_image_data() {
        let server = MockServer::start().await;
        let payload = serde_json::json!({ "data": [{ "metadata": "no image here" }] });
        Mock::given(method("POST"))
            .and(path("/images/generations"))
            .respond_with(ResponseTemplate::new(200).set_body_json(payload))
            .mount(&server)
            .await;

        let err = generate_images(&server.uri(), "k", "gpt-image-1", &req("x"))
            .await
            .expect_err("no images");
        assert!(err.contains("no usable image data"), "got: {err}");
    }

    #[tokio::test]
    async fn errors_when_response_payload_is_completely_unrecognized() {
        let server = MockServer::start().await;
        // No "data" or "images" array — `parse_image_response` reports
        // "Unsupported image response payload".
        let payload = serde_json::json!({ "weird": true });
        Mock::given(method("POST"))
            .and(path("/images/generations"))
            .respond_with(ResponseTemplate::new(200).set_body_json(payload))
            .mount(&server)
            .await;

        let err = generate_images(&server.uri(), "k", "gpt-image-1", &req("x"))
            .await
            .expect_err("unsupported payload");
        assert!(err.contains("Unsupported image response payload"), "got: {err}");
    }

    #[tokio::test]
    async fn propagates_http_error_status_from_image_endpoint() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/images/generations"))
            .respond_with(ResponseTemplate::new(429).set_body_string("rate limited"))
            .mount(&server)
            .await;

        let err = generate_images(&server.uri(), "k", "gpt-image-1", &req("x"))
            .await
            .expect_err("429");
        assert!(err.contains("429"));
        assert!(err.contains("rate limited"));
    }
}
