use base64::Engine;
use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const MAX_IMAGE_DIMENSION: u32 = 2048;
const MAX_IMAGE_BYTES: u64 = 4 * 1024 * 1024; // 4 MB
const MAX_TEXT_FILE_BYTES: u64 = 100 * 1024; // 100 KB

/// Supported text file extensions (whitelist)
const TEXT_EXTENSIONS: &[&str] = &[
    "md", "txt", "log", "csv", "tsv", "json", "yaml", "yml", "toml", "xml", "py", "rs", "js",
    "ts", "tsx", "jsx", "go", "java", "c", "cpp", "h", "hpp", "sh", "bash", "zsh", "fish",
    "html", "css", "scss", "less", "sql", "graphql", "env", "gitignore", "dockerfile", "swift",
    "kt", "rb", "lua", "r", "m", "mm", "ini", "cfg", "conf",
];

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp"];

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreparedAttachment {
    pub id: String,
    pub file_type: String,
    pub file_name: String,
    pub file_path: String,
    pub mime_type: String,
    pub file_size: i64,
}

/// Determine file type from extension
pub fn classify_file(path: &Path) -> Option<(&'static str, String)> {
    let ext = path.extension()?.to_str()?.to_lowercase();

    if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        let mime = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "heic" => "image/heic",
            "heif" => "image/heif",
            "bmp" => "image/bmp",
            _ => "application/octet-stream",
        };
        return Some(("image", mime.to_string()));
    }

    if TEXT_EXTENSIONS.contains(&ext.as_str()) {
        let mime = match ext.as_str() {
            "json" => "application/json",
            "xml" => "application/xml",
            "html" => "text/html",
            "css" => "text/css",
            "js" | "jsx" => "text/javascript",
            "ts" | "tsx" => "text/typescript",
            "md" => "text/markdown",
            "csv" => "text/csv",
            "yaml" | "yml" => "text/yaml",
            "sql" => "text/sql",
            _ => "text/plain",
        };
        return Some(("text_file", mime.to_string()));
    }

    None
}

/// Get the attachments storage directory, creating it if needed.
fn attachments_dir(app_data_dir: &Path) -> Result<PathBuf, String> {
    let now = Utc::now();
    let month_dir = app_data_dir
        .join("attachments")
        .join(now.format("%Y-%m").to_string());
    std::fs::create_dir_all(&month_dir).map_err(|e| format!("Failed to create attachments dir: {}", e))?;
    Ok(month_dir)
}

/// Prepare an attachment: copy/compress file to attachments dir, return metadata.
/// Does NOT insert into DB yet (that happens when the message is sent).
pub fn prepare_attachment(
    app_data_dir: &Path,
    source_path: &Path,
) -> Result<PreparedAttachment, String> {
    let (file_type, mime_type) =
        classify_file(source_path).ok_or_else(|| "Unsupported file type".to_string())?;

    let file_name = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unnamed")
        .to_string();

    let id = uuid::Uuid::new_v4().to_string();
    let dest_dir = attachments_dir(app_data_dir)?;

    let ext = source_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin");
    let dest_path = dest_dir.join(format!("{}.{}", id, ext));

    let file_size;

    match file_type {
        "image" => {
            let src_size = std::fs::metadata(source_path)
                .map_err(|e| format!("Cannot read file: {}", e))?
                .len();

            if src_size > MAX_IMAGE_BYTES {
                // Compress: resize and save as JPEG
                let img = image::open(source_path)
                    .map_err(|e| format!("Failed to open image: {}", e))?;
                let resized = img.resize(
                    MAX_IMAGE_DIMENSION,
                    MAX_IMAGE_DIMENSION,
                    image::imageops::FilterType::Lanczos3,
                );
                let dest_jpeg = dest_dir.join(format!("{}.jpg", id));
                resized
                    .save(&dest_jpeg)
                    .map_err(|e| format!("Failed to save compressed image: {}", e))?;
                file_size = std::fs::metadata(&dest_jpeg)
                    .map_err(|e| e.to_string())?
                    .len() as i64;
                return Ok(PreparedAttachment {
                    id,
                    file_type: file_type.to_string(),
                    file_name,
                    file_path: dest_jpeg.to_string_lossy().to_string(),
                    mime_type: "image/jpeg".to_string(),
                    file_size,
                });
            }

            // Check dimensions too
            if let Ok(img) = image::open(source_path) {
                let (w, h) = (img.width(), img.height());
                if w > MAX_IMAGE_DIMENSION || h > MAX_IMAGE_DIMENSION {
                    let resized = img.resize(
                        MAX_IMAGE_DIMENSION,
                        MAX_IMAGE_DIMENSION,
                        image::imageops::FilterType::Lanczos3,
                    );
                    resized
                        .save(&dest_path)
                        .map_err(|e| format!("Failed to save resized image: {}", e))?;
                    file_size = std::fs::metadata(&dest_path)
                        .map_err(|e| e.to_string())?
                        .len() as i64;
                    return Ok(PreparedAttachment {
                        id,
                        file_type: file_type.to_string(),
                        file_name,
                        file_path: dest_path.to_string_lossy().to_string(),
                        mime_type,
                        file_size,
                    });
                }
            }

            // Just copy
            std::fs::copy(source_path, &dest_path)
                .map_err(|e| format!("Failed to copy image: {}", e))?;
            file_size = src_size as i64;
        }
        "text_file" => {
            // Copy text file
            std::fs::copy(source_path, &dest_path)
                .map_err(|e| format!("Failed to copy file: {}", e))?;
            file_size = std::fs::metadata(&dest_path)
                .map_err(|e| e.to_string())?
                .len() as i64;
        }
        _ => {
            return Err("Unsupported file type".to_string());
        }
    }

    Ok(PreparedAttachment {
        id,
        file_type: file_type.to_string(),
        file_name,
        file_path: dest_path.to_string_lossy().to_string(),
        mime_type,
        file_size,
    })
}

/// Prepare an image from raw bytes (e.g., clipboard paste).
pub fn prepare_image_from_bytes(
    app_data_dir: &Path,
    data: &[u8],
    mime_type: &str,
) -> Result<PreparedAttachment, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let dest_dir = attachments_dir(app_data_dir)?;

    let ext = match mime_type {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "png",
    };
    let dest_path = dest_dir.join(format!("{}.{}", id, ext));

    // Decode and check dimensions
    let img = image::load_from_memory(data)
        .map_err(|e| format!("Failed to decode image: {}", e))?;
    let (w, h) = (img.width(), img.height());

    if data.len() as u64 > MAX_IMAGE_BYTES || w > MAX_IMAGE_DIMENSION || h > MAX_IMAGE_DIMENSION {
        let resized = img.resize(
            MAX_IMAGE_DIMENSION,
            MAX_IMAGE_DIMENSION,
            image::imageops::FilterType::Lanczos3,
        );
        let dest_jpeg = dest_dir.join(format!("{}.jpg", id));
        resized
            .save(&dest_jpeg)
            .map_err(|e| format!("Failed to save compressed image: {}", e))?;
        let file_size = std::fs::metadata(&dest_jpeg)
            .map_err(|e| e.to_string())?
            .len() as i64;
        return Ok(PreparedAttachment {
            id,
            file_type: "image".to_string(),
            file_name: format!("paste.{}", ext),
            file_path: dest_jpeg.to_string_lossy().to_string(),
            mime_type: "image/jpeg".to_string(),
            file_size,
        });
    }

    std::fs::write(&dest_path, data).map_err(|e| format!("Failed to write image: {}", e))?;
    let file_size = data.len() as i64;

    Ok(PreparedAttachment {
        id,
        file_type: "image".to_string(),
        file_name: format!("paste.{}", ext),
        file_path: dest_path.to_string_lossy().to_string(),
        mime_type: mime_type.to_string(),
        file_size,
    })
}

/// Insert an attachment record into the database, linking it to a message.
pub fn save_attachment(
    conn: &Connection,
    attachment: &PreparedAttachment,
    message_id: &str,
) -> Result<Attachment, String> {
    let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO attachments (id, message_id, file_type, file_name, file_path, mime_type, file_size, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
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
    .map_err(|e| format!("Failed to save attachment: {}", e))?;

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

/// Load attachments for a message.
pub fn get_attachments(conn: &Connection, message_id: &str) -> Result<Vec<Attachment>, String> {
    let mut stmt = conn
        .prepare("SELECT id, message_id, file_type, file_name, file_path, mime_type, file_size, metadata, created_at FROM attachments WHERE message_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![message_id], |row| {
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
                    .and_then(|s| serde_json::from_str(&s).ok()),
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Load attachments for multiple messages at once (batch query).
pub fn get_attachments_for_messages(
    conn: &Connection,
    message_ids: &[String],
) -> Result<Vec<Attachment>, String> {
    if message_ids.is_empty() {
        return Ok(vec![]);
    }

    let placeholders: Vec<String> = message_ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
    let sql = format!(
        "SELECT id, message_id, file_type, file_name, file_path, mime_type, file_size, metadata, created_at FROM attachments WHERE message_id IN ({})",
        placeholders.join(",")
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params: Vec<&dyn rusqlite::types::ToSql> = message_ids
        .iter()
        .map(|id| id as &dyn rusqlite::types::ToSql)
        .collect();

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
                    .and_then(|s| serde_json::from_str(&s).ok()),
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Update the metadata JSON for an attachment (e.g., add STT transcription).
pub fn update_attachment_metadata(
    conn: &Connection,
    attachment_id: &str,
    metadata: &serde_json::Value,
) -> Result<(), String> {
    conn.execute(
        "UPDATE attachments SET metadata = ?1 WHERE id = ?2",
        rusqlite::params![serde_json::to_string(metadata).unwrap_or_default(), attachment_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Read an image file and return it as base64 with its MIME type.
pub fn read_image_as_base64(file_path: &str) -> Result<(String, String), String> {
    let path = Path::new(file_path);
    let data = std::fs::read(path).map_err(|e| format!("Failed to read image: {}", e))?;
    let mime = classify_file(path)
        .map(|(_, m)| m)
        .unwrap_or_else(|| "image/png".to_string());
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok((b64, mime))
}

/// Read a text file and return its contents (truncated if too large).
pub fn read_text_file_content(file_path: &str) -> Result<String, String> {
    let path = Path::new(file_path);
    let metadata = std::fs::metadata(path).map_err(|e| format!("Cannot read file: {}", e))?;

    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read text file: {}", e))?;

    if metadata.len() > MAX_TEXT_FILE_BYTES {
        let truncated: String = content.chars().take(100_000).collect();
        Ok(format!("{}\n\n[... file truncated at 100KB ...]", truncated))
    } else {
        Ok(content)
    }
}

/// Delete attachment files from disk for a list of attachment records.
pub fn delete_attachment_files(attachments: &[Attachment]) {
    for att in attachments {
        let _ = std::fs::remove_file(&att.file_path);
    }
}
