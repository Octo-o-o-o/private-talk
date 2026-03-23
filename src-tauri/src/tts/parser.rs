use super::types::VoiceSegment;
use std::collections::HashMap;

struct RoleLookup<'a> {
    raw: &'a HashMap<String, Option<String>>,
    normalized: HashMap<String, Vec<(String, Option<String>)>>,
    assistant_voice: Option<String>,
}

impl<'a> RoleLookup<'a> {
    fn new(raw: &'a HashMap<String, Option<String>>) -> Self {
        let mut normalized = HashMap::new();
        for (role, voice_id) in raw {
            normalized
                .entry(normalize_role_key(role))
                .or_insert_with(Vec::new)
                .push((role.clone(), voice_id.clone()));
        }

        let assistant_voice = Self::lookup_direct_impl(raw, &normalized, "assistant");

        Self {
            raw,
            normalized,
            assistant_voice,
        }
    }

    fn resolve_voice(&self, role: &str) -> Option<String> {
        self.lookup_direct(role)
            .or_else(|| self.assistant_voice.clone())
    }

    fn is_known_role(&self, role: &str) -> bool {
        self.lookup_direct(role).is_some()
    }

    fn lookup_direct(&self, role: &str) -> Option<String> {
        Self::lookup_direct_impl(self.raw, &self.normalized, role)
    }

    fn lookup_direct_impl(
        raw: &HashMap<String, Option<String>>,
        normalized: &HashMap<String, Vec<(String, Option<String>)>>,
        role: &str,
    ) -> Option<String> {
        let cleaned = clean_role_label(role);
        if let Some(voice_id) = raw.get(&cleaned) {
            return voice_id.clone();
        }

        let canonical = canonical_role_alias(&cleaned);
        if canonical != cleaned {
            if let Some(voice_id) = raw.get(&canonical) {
                return voice_id.clone();
            }
        }

        let candidates = normalized.get(&normalize_role_key(&cleaned))?;
        select_preferred_voice(candidates, &cleaned, &canonical)
    }
}

struct ColonCandidate {
    role: String,
    rest: String,
    is_known_role: bool,
}

/// Parse message text into voice segments based on role annotations.
///
/// Supports two formats:
/// - Chinese parentheses: `（角色名）文本内容`
/// - Square brackets: `[角色名]文本内容`
/// - Dialogue prefix: `角色名：文本内容`
///
/// Text without any annotation is assigned to the "assistant" role.
///
/// `voice_mapping` maps role names to voice IDs.
pub fn parse_voice_segments(
    text: &str,
    voice_mapping: &HashMap<String, Option<String>>,
) -> Vec<VoiceSegment> {
    let role_lookup = RoleLookup::new(voice_mapping);
    let lines: Vec<&str> = text.lines().collect();
    let colon_mode_enabled = should_enable_colon_mode(&lines, &role_lookup);
    let mut segments: Vec<VoiceSegment> = Vec::new();
    let mut current_role = "assistant".to_string();
    let mut current_text = String::new();

    for line in lines {
        let trimmed = line.trim();

        // Try to extract role from line start (Chinese parentheses or square brackets)
        let extracted = extract_role_chinese(trimmed)
            .or_else(|| extract_role_bracket(trimmed))
            .or_else(|| {
                if colon_mode_enabled {
                    extract_role_colon(trimmed, &role_lookup)
                } else {
                    None
                }
            });

        if let Some((role, rest)) = extracted {
            flush_segment(&mut segments, &current_role, &current_text, &role_lookup);
            current_role = role;
            current_text = rest;
        } else {
            current_text.push_str(trimmed);
        }
        current_text.push('\n');
    }

    // Flush last segment
    flush_segment(&mut segments, &current_role, &current_text, &role_lookup);

    segments
}

fn flush_segment(
    segments: &mut Vec<VoiceSegment>,
    role: &str,
    text: &str,
    role_lookup: &RoleLookup<'_>,
) {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return;
    }

    let voice_id = role_lookup.resolve_voice(role);

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
                let role = clean_role_label(&line[start..pos]);
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
            let role = clean_role_label(&line[1..pos]);
            let rest = after_bracket.trim().to_string();
            if !role.is_empty() {
                return Some((role, rest));
            }
        }
    }
    None
}

fn extract_role_colon(line: &str, role_lookup: &RoleLookup<'_>) -> Option<(String, String)> {
    extract_role_colon_candidate(line, role_lookup).map(|candidate| (candidate.role, candidate.rest))
}

fn extract_role_colon_candidate(
    line: &str,
    role_lookup: &RoleLookup<'_>,
) -> Option<ColonCandidate> {
    let line = line.trim();
    if line.is_empty()
        || line.starts_with('#')
        || line.starts_with('>')
        || line.starts_with("- ")
        || line.starts_with("* ")
        || line.starts_with("+ ")
    {
        return None;
    }

    let (pos, sep_len) = find_role_separator(line)?;
    let role = clean_role_label(&line[..pos]);
    let rest = line[pos + sep_len..].trim().to_string();

    if role.is_empty()
        || rest.is_empty()
        || rest.starts_with("//")
        || role.chars().count() > 24
        || !is_role_label_candidate(&role)
    {
        return None;
    }

    Some(ColonCandidate {
        is_known_role: role_lookup.is_known_role(&role),
        role,
        rest,
    })
}

fn should_enable_colon_mode(lines: &[&str], role_lookup: &RoleLookup<'_>) -> bool {
    let mut nonempty_lines = 0;
    let mut candidate_lines = 0;
    let mut has_known_role = false;

    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        nonempty_lines += 1;

        if let Some(candidate) = extract_role_colon_candidate(trimmed, role_lookup) {
            candidate_lines += 1;
            if candidate.is_known_role {
                has_known_role = true;
            }
        }
    }

    has_known_role || (candidate_lines >= 2 && candidate_lines * 2 >= nonempty_lines)
}

fn find_role_separator(line: &str) -> Option<(usize, usize)> {
    line.char_indices()
        .find_map(|(idx, ch)| match ch {
            ':' | '：' => Some((idx, ch.len_utf8())),
            _ => None,
        })
}

fn is_role_label_candidate(role: &str) -> bool {
    role.chars().all(|ch| {
        ch.is_alphanumeric()
            || ch.is_whitespace()
            || matches!(ch, '_' | '-' | '·' | '・' | '\'' | '’')
    })
}

fn clean_role_label(role: &str) -> String {
    strip_markdown_wrappers(role.trim()).trim().to_string()
}

fn strip_markdown_wrappers(value: &str) -> &str {
    let trimmed = value.trim();
    for marker in ["**", "__", "*", "_", "`"] {
        if trimmed.starts_with(marker)
            && trimmed.ends_with(marker)
            && trimmed.len() > marker.len() * 2
        {
            return &trimmed[marker.len()..trimmed.len() - marker.len()];
        }
    }
    trimmed
}

fn canonical_role_alias(role: &str) -> String {
    let cleaned = clean_role_label(role);
    let normalized: String = cleaned
        .chars()
        .filter(|ch| !matches!(ch, ' ' | '\t' | '\n' | '\r' | '_' | '-' | '·' | '・'))
        .flat_map(|ch| ch.to_lowercase())
        .collect();

    match normalized.as_str() {
        "narrator" | "narration" | "旁白" | "旁述" | "解说" => "narrator".to_string(),
        "assistant" | "助手" | "小助手" | "bot" | "ai" => "assistant".to_string(),
        _ => cleaned,
    }
}

fn normalize_role_key(role: &str) -> String {
    canonical_role_alias(role)
        .chars()
        .filter(|ch| !matches!(ch, ' ' | '\t' | '\n' | '\r' | '_' | '-' | '·' | '・'))
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn select_preferred_voice(
    candidates: &[(String, Option<String>)],
    cleaned: &str,
    canonical: &str,
) -> Option<String> {
    let cleaned_lower = cleaned.to_lowercase();
    let canonical_lower = canonical.to_lowercase();

    candidates
        .iter()
        .min_by_key(|(raw_key, _)| {
            let candidate = clean_role_label(raw_key);
            let candidate_lower = candidate.to_lowercase();
            let rank = if candidate == cleaned {
                0
            } else if candidate_lower == cleaned_lower {
                1
            } else if candidate == canonical {
                2
            } else if candidate_lower == canonical_lower {
                3
            } else {
                4
            };
            (rank, candidate_lower)
        })
        .and_then(|(_, voice_id)| voice_id.clone())
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

    #[test]
    fn test_narrator_alias_maps_to_same_voice() {
        let text = "（旁白）夜深了。\n[Narrator] Still the same voice.";
        let mut mapping = HashMap::new();
        mapping.insert("narrator".to_string(), Some("voice-narrator".to_string()));
        let segments = parse_voice_segments(text, &mapping);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].voice_id.as_deref(), Some("voice-narrator"));
        assert_eq!(segments[1].voice_id.as_deref(), Some("voice-narrator"));
    }

    #[test]
    fn test_assistant_alias_falls_back_for_unknown_role() {
        let text = "（未知角色）你好。";
        let mut mapping = HashMap::new();
        mapping.insert("助手".to_string(), Some("voice-assistant".to_string()));
        let segments = parse_voice_segments(text, &mapping);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].voice_id.as_deref(), Some("voice-assistant"));
    }

    #[test]
    fn test_known_role_colon_format() {
        let text = "旁白：夜深了。";
        let mut mapping = HashMap::new();
        mapping.insert("narrator".to_string(), Some("voice-narrator".to_string()));
        let segments = parse_voice_segments(text, &mapping);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].role_name, "旁白");
        assert_eq!(segments[0].voice_id.as_deref(), Some("voice-narrator"));
    }

    #[test]
    fn test_dialogue_colon_format_without_mapping() {
        let text = "Alice: Hello there.\nBob: Hi!";
        let segments = parse_voice_segments(text, &HashMap::new());
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].role_name, "Alice");
        assert_eq!(segments[1].role_name, "Bob");
    }

    #[test]
    fn test_single_heading_like_colon_does_not_trigger_role_mode() {
        let text = "总结：今天主要讨论 TTS 方案。";
        let segments = parse_voice_segments(text, &HashMap::new());
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].role_name, "assistant");
        assert_eq!(segments[0].text, text);
    }

    #[test]
    fn test_markdown_wrapped_role_label() {
        let text = "**旁白**：夜深了。";
        let mut mapping = HashMap::new();
        mapping.insert("旁白".to_string(), Some("voice-narrator".to_string()));
        let segments = parse_voice_segments(text, &mapping);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].role_name, "旁白");
        assert_eq!(segments[0].voice_id.as_deref(), Some("voice-narrator"));
    }

    #[test]
    fn test_alias_resolution_prefers_closest_match() {
        let text = "[narrator] One more line.";
        let mut mapping = HashMap::new();
        mapping.insert("Narrator".to_string(), Some("voice-en".to_string()));
        mapping.insert("旁白".to_string(), Some("voice-zh".to_string()));
        let segments = parse_voice_segments(text, &mapping);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].voice_id.as_deref(), Some("voice-en"));
    }
}
