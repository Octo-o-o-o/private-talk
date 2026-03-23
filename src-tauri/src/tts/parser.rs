use super::types::VoiceSegment;
use std::collections::HashMap;

/// Parse message text into voice segments based on role annotations.
///
/// Supports two formats:
/// - Chinese parentheses: `（角色名）文本内容`
/// - Square brackets: `[角色名]文本内容`
///
/// Text without any annotation is assigned to the "assistant" role.
///
/// `voice_mapping` maps role names to voice IDs.
pub fn parse_voice_segments(
    text: &str,
    voice_mapping: &HashMap<String, Option<String>>,
) -> Vec<VoiceSegment> {
    let mut segments: Vec<VoiceSegment> = Vec::new();
    let mut current_role = "assistant".to_string();
    let mut current_text = String::new();

    for line in text.lines() {
        let trimmed = line.trim();

        // Try to extract role from line start (Chinese parentheses or square brackets)
        let extracted = extract_role_chinese(trimmed).or_else(|| extract_role_bracket(trimmed));

        if let Some((role, rest)) = extracted {
            flush_segment(&mut segments, &current_role, &current_text, voice_mapping);
            current_role = role;
            current_text = rest;
        } else {
            current_text.push_str(trimmed);
        }
        current_text.push('\n');
    }

    // Flush last segment
    flush_segment(&mut segments, &current_role, &current_text, voice_mapping);

    segments
}

fn flush_segment(
    segments: &mut Vec<VoiceSegment>,
    role: &str,
    text: &str,
    voice_mapping: &HashMap<String, Option<String>>,
) {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return;
    }

    let voice_id = voice_mapping
        .get(role)
        .cloned()
        .unwrap_or_else(|| voice_mapping.get("assistant").cloned().flatten());

    segments.push(VoiceSegment {
        role_name: role.to_string(),
        text: trimmed.to_string(),
        voice_id,
    });
}

/// Extract role from Chinese parentheses: `（角色名）文本`
fn extract_role_chinese(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.starts_with('（') || line.starts_with('(') {
        let close_chars = ['）', ')'];
        for close in close_chars {
            if let Some(pos) = line.find(close) {
                let start = if line.starts_with('（') {
                    '（'.len_utf8()
                } else {
                    1
                };
                let role = line[start..pos].trim().to_string();
                let rest = line[pos + close.len_utf8()..].trim().to_string();
                if !role.is_empty() {
                    return Some((role, rest));
                }
            }
        }
    }
    None
}

/// Extract role from square brackets: `[角色名]文本`
/// Skips Markdown links like `[text](url)` by checking if `]` is followed by `(`.
fn extract_role_bracket(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.starts_with('[') {
        if let Some(pos) = line.find(']') {
            // Skip Markdown links: [text](url)
            let after_bracket = &line[pos + 1..];
            if after_bracket.starts_with('(') {
                return None;
            }
            let role = line[1..pos].trim().to_string();
            let rest = after_bracket.trim().to_string();
            if !role.is_empty() {
                return Some((role, rest));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_chinese_parentheses() {
        let text = "（旁白）夜深了，雨打在窗户上。\n（侦探）线索就在这张照片里。";
        let mapping = HashMap::new();
        let segments = parse_voice_segments(text, &mapping);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].role_name, "旁白");
        assert!(segments[0].text.contains("夜深了"));
        assert_eq!(segments[1].role_name, "侦探");
        assert!(segments[1].text.contains("线索"));
    }

    #[test]
    fn test_parse_square_brackets() {
        let text = "[Narrator] The night was dark.\n[Detective] The clue is here.";
        let mapping = HashMap::new();
        let segments = parse_voice_segments(text, &mapping);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].role_name, "Narrator");
        assert_eq!(segments[1].role_name, "Detective");
    }

    #[test]
    fn test_no_annotation() {
        let text = "Hello, how can I help you today?";
        let mapping = HashMap::new();
        let segments = parse_voice_segments(text, &mapping);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].role_name, "assistant");
    }

    #[test]
    fn test_mixed_content() {
        // Lines without annotation continue the current role
        let text = "Some intro text\n（旁白）这是旁白\nMore text continues narrator";
        let mapping = HashMap::new();
        let segments = parse_voice_segments(text, &mapping);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].role_name, "assistant");
        assert_eq!(segments[1].role_name, "旁白");
    }

    #[test]
    fn test_role_switch_back() {
        let text = "（旁白）夜深了。\n（助手）你好！\n（旁白）继续叙述。";
        let mapping = HashMap::new();
        let segments = parse_voice_segments(text, &mapping);
        assert_eq!(segments.len(), 3);
        assert_eq!(segments[0].role_name, "旁白");
        assert_eq!(segments[1].role_name, "助手");
        assert_eq!(segments[2].role_name, "旁白");
    }

    #[test]
    fn test_markdown_link_not_parsed_as_role() {
        let text = "Check out [this link](https://example.com) for more info.";
        let mapping = HashMap::new();
        let segments = parse_voice_segments(text, &mapping);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].role_name, "assistant");
        assert!(segments[0].text.contains("[this link]"));
    }
}
