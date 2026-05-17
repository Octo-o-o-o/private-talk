use base64::Engine;
use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const MAX_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_BYTES: usize = 256 * 1024;
const MAX_PDF_TEXT_CHARS: usize = 500_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub message_id: String,
    pub file_type: String,
    pub file_name: String,
    pub file_path: String,
    pub mime_type: String,
    pub file_size: i64,
    pub metadata: Option<serde_json::Value>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct PreparedAttachment {
    pub id: String,
    pub file_type: String,
    pub file_name: String,
    pub file_path: String,
    pub mime_type: String,
    pub file_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentUpload {
    pub file_name: String,
    pub mime_type: String,
    pub data_base64: String,
}

fn sanitize_file_name(input: &str) -> String {
    let trimmed = input.trim();
    let candidate = Path::new(trimmed)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment");
    let sanitized = candidate
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect::<String>();
    if sanitized.is_empty() {
        "attachment".to_string()
    } else {
        sanitized
    }
}

fn file_extension(file_name: &str, mime_type: &str) -> String {
    let lower_name = file_name.to_lowercase();
    if lower_name.ends_with(".pdf") || mime_type == "application/pdf" {
        return "pdf".to_string();
    }
    if lower_name.ends_with(".png") || mime_type == "image/png" {
        return "png".to_string();
    }
    if lower_name.ends_with(".jpg") || lower_name.ends_with(".jpeg") || mime_type == "image/jpeg" {
        return "jpg".to_string();
    }
    if lower_name.ends_with(".webp") || mime_type == "image/webp" {
        return "webp".to_string();
    }
    if lower_name.ends_with(".gif") || mime_type == "image/gif" {
        return "gif".to_string();
    }
    if lower_name.ends_with(".md") || mime_type == "text/markdown" {
        return "md".to_string();
    }
    if lower_name.ends_with(".json") || mime_type == "application/json" {
        return "json".to_string();
    }
    if lower_name.ends_with(".csv") || mime_type == "text/csv" {
        return "csv".to_string();
    }
    if lower_name.ends_with(".txt") || mime_type.starts_with("text/") {
        return "txt".to_string();
    }
    Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("bin")
        .to_string()
}

fn classify_attachment(file_name: &str, mime_type: &str) -> String {
    let lower_name = file_name.to_lowercase();
    if mime_type == "application/pdf" || lower_name.ends_with(".pdf") {
        return "pdf".to_string();
    }
    if mime_type.starts_with("image/") {
        return "image".to_string();
    }
    let text_extensions = [
        ".txt", ".md", ".json", ".yaml", ".yml", ".toml", ".csv", ".tsv", ".xml", ".html", ".css",
        ".js", ".ts", ".tsx", ".jsx", ".py", ".rs", ".go", ".java", ".sql", ".log",
    ];
    if mime_type.starts_with("text/")
        || mime_type == "application/json"
        || text_extensions
            .iter()
            .any(|suffix| lower_name.ends_with(suffix))
    {
        return "text_file".to_string();
    }
    "file".to_string()
}

fn attachments_dir(app_data_dir: &Path) -> Result<PathBuf, String> {
    let dir = app_data_dir
        .join("attachments")
        .join(Utc::now().format("%Y-%m").to_string());
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

pub fn save_upload(
    app_data_dir: &Path,
    upload: &AttachmentUpload,
) -> Result<PreparedAttachment, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(upload.data_base64.trim())
        .map_err(|error| format!("Invalid attachment data: {error}"))?;

    if bytes.is_empty() {
        return Err("Attachment payload is empty.".to_string());
    }
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err("Attachment is too large (max 20 MB).".to_string());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let file_name = sanitize_file_name(&upload.file_name);
    let mime_type = upload.mime_type.trim().to_string();
    let file_type = classify_attachment(&file_name, &mime_type);
    let ext = file_extension(&file_name, &mime_type);
    let dir = attachments_dir(app_data_dir)?;
    let path = dir.join(format!("{id}.{ext}"));
    std::fs::write(&path, &bytes).map_err(|error| error.to_string())?;

    if file_type == "pdf" {
        let extracted = extract_pdf_text(&bytes)?;
        let text_path = dir.join(format!("{id}_text.txt"));
        std::fs::write(text_path, extracted).map_err(|error| error.to_string())?;
    }

    Ok(PreparedAttachment {
        id,
        file_type,
        file_name,
        file_path: path.to_string_lossy().to_string(),
        mime_type,
        file_size: bytes.len() as i64,
    })
}

fn extract_pdf_text(bytes: &[u8]) -> Result<String, String> {
    let text = pdf_extract::extract_text_from_mem(bytes)
        .map_err(|error| format!("Failed to extract PDF text: {error}"))?;
    if text.chars().count() > MAX_PDF_TEXT_CHARS {
        let mut truncated: String = text.chars().take(MAX_PDF_TEXT_CHARS).collect();
        truncated.push_str("\n\n[... PDF text truncated ...]");
        Ok(truncated)
    } else {
        Ok(text)
    }
}

pub fn save_attachment(
    conn: &Connection,
    attachment: &PreparedAttachment,
    message_id: &str,
) -> Result<Attachment, String> {
    let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO attachments (id, message_id, file_type, file_name, file_path, mime_type, file_size, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            attachment.id,
            message_id,
            attachment.file_type,
            attachment.file_name,
            attachment.file_path,
            attachment.mime_type,
            attachment.file_size,
            now,
        ],
    )
    .map_err(|error| error.to_string())?;

    Ok(Attachment {
        id: attachment.id.clone(),
        message_id: message_id.to_string(),
        file_type: attachment.file_type.clone(),
        file_name: attachment.file_name.clone(),
        file_path: attachment.file_path.clone(),
        mime_type: attachment.mime_type.clone(),
        file_size: attachment.file_size,
        metadata: None,
        created_at: now,
    })
}

pub fn get_attachments_for_messages(
    conn: &Connection,
    message_ids: &[String],
) -> Result<Vec<Attachment>, String> {
    if message_ids.is_empty() {
        return Ok(vec![]);
    }

    let placeholders = message_ids
        .iter()
        .enumerate()
        .map(|(index, _)| format!("?{}", index + 1))
        .collect::<Vec<_>>()
        .join(",");

    let sql = format!(
        "SELECT id, message_id, file_type, file_name, file_path, mime_type, file_size, metadata, created_at
         FROM attachments WHERE message_id IN ({placeholders}) ORDER BY created_at ASC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let params = message_ids
        .iter()
        .map(|id| id as &dyn rusqlite::types::ToSql)
        .collect::<Vec<_>>();
    let rows = stmt
        .query_map(params.as_slice(), |row| {
            Ok(Attachment {
                id: row.get(0)?,
                message_id: row.get(1)?,
                file_type: row.get(2)?,
                file_name: row.get(3)?,
                file_path: row.get(4)?,
                mime_type: row.get(5)?,
                file_size: row.get(6)?,
                metadata: row
                    .get::<_, Option<String>>(7)?
                    .and_then(|value| serde_json::from_str(&value).ok()),
                created_at: row.get(8)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn get_attachment_uploads_for_message(
    conn: &Connection,
    message_id: &str,
) -> Result<Vec<AttachmentUpload>, String> {
    let attachments = get_attachments_for_messages(conn, &[message_id.to_string()])?;

    attachments
        .into_iter()
        .map(|attachment| {
            let bytes = std::fs::read(&attachment.file_path).map_err(|error| error.to_string())?;
            Ok(AttachmentUpload {
                file_name: attachment.file_name,
                mime_type: attachment.mime_type,
                data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            })
        })
        .collect()
}

pub fn read_text_file_content(file_path: &str) -> Result<String, String> {
    let bytes = std::fs::read(file_path).map_err(|error| error.to_string())?;
    let mut content = String::from_utf8_lossy(&bytes).to_string();
    if bytes.len() > MAX_TEXT_ATTACHMENT_BYTES {
        content = content.chars().take(120_000).collect::<String>();
        content.push_str("\n\n[... file truncated ...]");
    }
    Ok(content)
}

pub fn read_pdf_text_content(file_path: &str) -> Result<String, String> {
    let path = Path::new(file_path);
    let stem = path
        .file_stem()
        .ok_or_else(|| "Invalid PDF path".to_string())?
        .to_string_lossy()
        .to_string();
    let text_path = path.with_file_name(format!("{stem}_text.txt"));
    std::fs::read_to_string(text_path).map_err(|error| error.to_string())
}

pub fn read_image_as_base64(file_path: &str) -> Result<(String, String), String> {
    let bytes = std::fs::read(file_path).map_err(|error| error.to_string())?;
    let mime_type = match Path::new(file_path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    }
    .to_string();

    Ok((
        base64::engine::general_purpose::STANDARD.encode(bytes),
        mime_type,
    ))
}

pub fn delete_attachment_files(attachments: &[Attachment]) {
    for attachment in attachments {
        let _ = std::fs::remove_file(&attachment.file_path);
        let path = Path::new(&attachment.file_path);
        if attachment.file_type == "pdf" {
            if let Some(stem) = path.file_stem().and_then(|value| value.to_str()) {
                let _ = std::fs::remove_file(path.with_file_name(format!("{stem}_text.txt")));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        classify_attachment, extract_pdf_text, file_extension, read_text_file_content,
        sanitize_file_name, save_upload, AttachmentUpload, MAX_ATTACHMENT_BYTES,
        MAX_TEXT_ATTACHMENT_BYTES,
    };
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    use std::path::{Path, PathBuf};
    use tempfile::TempDir;

    #[test]
    fn sanitize_file_name_strips_path_components() {
        // Path-style inputs collapse to basename (path traversal protection).
        // Note: tests run on Unix-style hosts where '\\' is NOT a path
        // separator, so backslashes get replaced via the sanitization map
        // rather than stripped by file_name().
        assert_eq!(sanitize_file_name("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_file_name("/abs/path/file.txt"), "file.txt");
        assert_eq!(
            sanitize_file_name("nested\\windows\\path.docx"),
            "nested_windows_path.docx",
        );
    }

    #[test]
    fn sanitize_file_name_replaces_reserved_characters_with_underscore() {
        // ':', '*', '?', '"', '<', '>', '|' all map to '_'; '/' and '\\' do
        // too but Path::file_name strips them earlier as path separators.
        assert_eq!(sanitize_file_name("a:b*c?\"<d>|e.txt"), "a_b_c___d__e.txt");
    }

    #[test]
    fn sanitize_file_name_falls_back_to_attachment_for_empty_or_blank() {
        assert_eq!(sanitize_file_name(""), "attachment");
        assert_eq!(sanitize_file_name("   "), "attachment");
        assert_eq!(sanitize_file_name("/"), "attachment");
    }

    #[test]
    fn file_extension_prefers_file_name_then_mime_then_path_fallback() {
        assert_eq!(file_extension("photo.png", "application/octet-stream"), "png");
        assert_eq!(file_extension("photo.JPG", ""), "jpg");
        assert_eq!(file_extension("blob", "application/pdf"), "pdf");
        assert_eq!(file_extension("blob", "image/png"), "png");
        assert_eq!(file_extension("notes", "text/markdown"), "md");
        assert_eq!(file_extension("data", "application/json"), "json");
        // No name hint, no mime hint, no extension on path → "bin"
        assert_eq!(file_extension("nameonly", "application/octet-stream"), "bin");
        // Path has extension that isn't in the explicit allowlist → keep it.
        assert_eq!(file_extension("notes.rtf", "application/octet-stream"), "rtf");
    }

    #[test]
    fn classify_attachment_distinguishes_pdf_image_text_other() {
        assert_eq!(classify_attachment("a.pdf", "application/pdf"), "pdf");
        assert_eq!(classify_attachment("a.pdf", "anything"), "pdf");
        assert_eq!(classify_attachment("photo.png", "image/png"), "image");
        assert_eq!(classify_attachment("photo.heic", "image/heic"), "image");
        assert_eq!(classify_attachment("snippet.rs", "text/plain"), "text_file");
        assert_eq!(classify_attachment("notes.md", ""), "text_file");
        assert_eq!(classify_attachment("data.json", ""), "text_file");
        assert_eq!(classify_attachment("readme", "text/plain"), "text_file");
        assert_eq!(classify_attachment("blob.bin", "application/octet-stream"), "file");
    }

    fn upload(file_name: &str, mime_type: &str, payload: &[u8]) -> AttachmentUpload {
        AttachmentUpload {
            file_name: file_name.to_string(),
            mime_type: mime_type.to_string(),
            data_base64: BASE64.encode(payload),
        }
    }

    fn assert_path_inside(parent: &Path, child: &Path) {
        let parent_canon = parent.canonicalize().expect("canonicalize parent");
        let child_canon = child.canonicalize().expect("canonicalize child");
        assert!(
            child_canon.starts_with(&parent_canon),
            "child {child_canon:?} must live inside parent {parent_canon:?}",
        );
    }

    #[test]
    fn save_upload_writes_to_app_data_dir_with_uuid_filename() {
        let tmp = TempDir::new().expect("temp dir");
        let payload = b"hello attachment";

        let prepared = save_upload(tmp.path(), &upload("notes.txt", "text/plain", payload))
            .expect("save_upload should succeed");

        assert_eq!(prepared.file_type, "text_file");
        assert_eq!(prepared.file_name, "notes.txt");
        assert_eq!(prepared.file_size, payload.len() as i64);

        let written_path = PathBuf::from(&prepared.file_path);
        assert!(written_path.exists(), "file must be written to disk");
        assert_path_inside(tmp.path(), &written_path);

        // File name must NOT reuse the user-provided file name on disk
        // (UUID + extension prevents collisions and trivial path traversal).
        let on_disk_name = written_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert!(
            on_disk_name.ends_with(".txt"),
            "extension must be preserved, got {on_disk_name}",
        );
        assert!(
            !on_disk_name.contains("notes"),
            "user-provided basename must not leak into on-disk filename: {on_disk_name}",
        );

        // Bytes round-trip exactly.
        let bytes = std::fs::read(&written_path).expect("read back");
        assert_eq!(bytes, payload);
    }

    #[test]
    fn save_upload_traversal_attempt_stays_within_app_data_dir() {
        let tmp = TempDir::new().expect("temp dir");
        let prepared = save_upload(
            tmp.path(),
            &upload("../../../escape.txt", "text/plain", b"x"),
        )
        .expect("save_upload");

        // sanitize_file_name strips the path, but the on-disk file name is
        // UUID-based anyway. The important invariant: the written file is
        // inside the app_data_dir.
        let written_path = PathBuf::from(&prepared.file_path);
        assert_path_inside(tmp.path(), &written_path);
    }

    #[test]
    fn save_upload_rejects_empty_payload() {
        let tmp = TempDir::new().expect("temp dir");
        let err = save_upload(tmp.path(), &upload("empty.txt", "text/plain", b""))
            .expect_err("must reject empty payload");
        assert!(err.contains("empty"), "got: {err}");
    }

    #[test]
    fn save_upload_rejects_payload_above_20mb_limit() {
        let tmp = TempDir::new().expect("temp dir");
        let oversized = vec![0u8; MAX_ATTACHMENT_BYTES + 1];
        let err = save_upload(tmp.path(), &upload("big.bin", "application/octet-stream", &oversized))
            .expect_err("must reject oversized payload");
        assert!(err.contains("too large"), "got: {err}");
    }

    #[test]
    fn save_upload_rejects_invalid_base64() {
        let tmp = TempDir::new().expect("temp dir");
        let upload = AttachmentUpload {
            file_name: "x.txt".to_string(),
            mime_type: "text/plain".to_string(),
            data_base64: "not!valid!base64!@#$".to_string(),
        };
        let err = save_upload(tmp.path(), &upload).expect_err("must reject bad base64");
        assert!(err.contains("Invalid attachment data"), "got: {err}");
    }

    #[test]
    fn read_text_file_content_returns_full_content_when_under_limit() {
        let tmp = TempDir::new().expect("temp dir");
        let path = tmp.path().join("small.txt");
        std::fs::write(&path, "hello world").expect("write");

        let content =
            read_text_file_content(path.to_str().unwrap()).expect("read_text_file_content");
        assert_eq!(content, "hello world");
    }

    #[test]
    fn read_text_file_content_truncates_with_marker_above_limit() {
        let tmp = TempDir::new().expect("temp dir");
        let path = tmp.path().join("big.txt");
        // 1 byte over the 256 KB limit triggers the truncation branch.
        let payload = "a".repeat(MAX_TEXT_ATTACHMENT_BYTES + 1);
        std::fs::write(&path, &payload).expect("write");

        let content =
            read_text_file_content(path.to_str().unwrap()).expect("read_text_file_content");

        assert!(
            content.contains("[... file truncated ...]"),
            "must include truncation marker"
        );
        assert!(
            content.chars().count() <= 120_000 + 32,
            "must be truncated to ~120k chars + marker",
        );
    }

    // ---------- extract_pdf_text (error path only) ----------
    //
    // Generating a valid PDF on the fly without pulling in `lopdf` as a
    // dev-dep is high-effort / low-payoff: pdf-extract is a 3rd-party library
    // whose happy path is well-tested upstream. What we DO want to guard is
    // that our wrapper translates failures into a user-friendly String error
    // instead of panicking — a regression here would surface as an opaque
    // 500-style crash when the user uploads a corrupt or fake-PDF attachment.

    #[test]
    fn extract_pdf_text_returns_error_for_non_pdf_input() {
        let err = extract_pdf_text(b"this is plainly not a PDF document")
            .expect_err("must reject non-PDF bytes");
        assert!(
            err.contains("Failed to extract PDF text"),
            "error must be the wrapped form, got: {err}",
        );
    }

    #[test]
    fn extract_pdf_text_returns_error_for_empty_input() {
        let err = extract_pdf_text(&[]).expect_err("must reject empty input");
        assert!(err.contains("Failed to extract PDF text"), "got: {err}");
    }

    #[test]
    fn extract_pdf_text_returns_error_for_truncated_pdf_header() {
        // Looks like a PDF signature but body is missing — must NOT panic.
        let err =
            extract_pdf_text(b"%PDF-1.4\n%fake content with nothing parseable after\n%%EOF\n")
                .expect_err("malformed PDF must surface as Err");
        assert!(err.contains("Failed to extract PDF text"), "got: {err}");
    }
}
