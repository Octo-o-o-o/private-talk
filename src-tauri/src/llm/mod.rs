pub mod provider;
pub mod types;

/// Heuristic check: does this model name suggest vision / multimodal capability?
/// Used to decide whether to send raw PDF bytes (as data-URI) alongside
/// extracted text.  False-negatives are harmless — the text fallback is
/// always included.
pub fn is_vision_model(model: &str) -> bool {
    let m = model.to_lowercase();
    const VISION_HINTS: &[&str] = &[
        // OpenAI
        "gpt-4o",
        "gpt-4-turbo",
        "gpt-4-vision",
        "gpt-4.1",
        "gpt-4.5",
        "gpt-5",
        "o1",
        "o3",
        "o4",
        // Anthropic
        "claude-3",
        "claude-4",
        // Google
        "gemini",
        // Chinese models with known vision
        "glm-4v",
        "glm-4.5v",
        "glm-4.6",
        "qwen-vl",
        "qwen2-vl",
        "qwen2.5-vl",
        // Bytedance
        "doubao-pro-vision",
        "doubao-vision",
        "doubao-1.5-vision",
        // Generic hints
        "vision",
        "-vl-",
        "-vl",
    ];
    VISION_HINTS.iter().any(|hint| m.contains(hint))
}
