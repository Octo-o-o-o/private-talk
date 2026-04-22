pub mod provider;
pub mod types;

pub fn is_vision_model(model: &str) -> bool {
    let normalized = model.to_lowercase();
    const VISION_HINTS: &[&str] = &[
        "gpt-4o",
        "gpt-4.1",
        "gpt-4.5",
        "gpt-5",
        "o1",
        "o3",
        "o4",
        "claude-3",
        "claude-4",
        "gemini",
        "glm-4v",
        "glm-4.5v",
        "qwen-vl",
        "qwen2-vl",
        "qwen2.5-vl",
        "doubao-vision",
        "vision",
        "-vl-",
        "-vl",
    ];

    VISION_HINTS.iter().any(|hint| normalized.contains(hint))
}
