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

#[cfg(test)]
mod tests {
    use super::is_vision_model;

    #[test]
    fn recognizes_each_known_vision_family() {
        let positives = [
            // GPT vision-capable families.
            "gpt-4o",
            "gpt-4o-mini",
            "gpt-4.1",
            "gpt-4.5-preview",
            "gpt-5",
            "gpt-5-pro",
            // OpenAI reasoning families (treated as multimodal-capable here).
            "o1",
            "o3",
            "o4-mini",
            // Anthropic + Google.
            "claude-3-opus",
            "claude-3.5-sonnet",
            "claude-4-haiku",
            "gemini-1.5-pro",
            "gemini-2.0-flash",
            // GLM / Qwen / Doubao vision variants.
            "glm-4v",
            "glm-4.5v",
            "qwen-vl-max",
            "qwen2-vl-7b",
            "qwen2.5-vl-72b",
            "doubao-vision-pro",
            // Generic "vision" suffix + "-vl" patterns.
            "some-vendor-vision-pro",
            "intern-vl",
            "intern-vl-chat",
        ];

        for model in positives {
            assert!(
                is_vision_model(model),
                "expected `{model}` to be classified as a vision model",
            );
        }
    }

    #[test]
    fn rejects_text_only_or_non_chat_models() {
        let negatives = [
            "gpt-3.5-turbo",
            "gpt-4",         // bare gpt-4 (no -o, -1, -5 hint) → not flagged
            "text-davinci-003",
            "llama-3-70b",
            "mistral-large",
            "mixtral-8x7b",
            "whisper-1",
            "tts-1",
            "tts-1-hd",
            "dall-e-3",
            "gpt-image-1",
            "stable-diffusion-xl",
            "command-r-plus",
            "",
        ];

        for model in negatives {
            assert!(
                !is_vision_model(model),
                "expected `{model}` to NOT be classified as a vision model",
            );
        }
    }

    #[test]
    fn matches_are_case_insensitive() {
        assert!(is_vision_model("GPT-4O"));
        assert!(is_vision_model("Claude-3-Opus"));
        assert!(is_vision_model("Qwen2.5-VL-72B"));
    }
}
