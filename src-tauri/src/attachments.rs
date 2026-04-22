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

#[derive(Debug, Clone, Deserialize)]
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
