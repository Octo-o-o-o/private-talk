use base64::Engine;
use chrono::Utc;
use image::GenericImageView;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const MAX_IMAGE_DIMENSION: u32 = 2048;
const MAX_IMAGE_BYTES: u64 = 4 * 1024 * 1024; // 4 MB
const MAX_TEXT_FILE_BYTES: u64 = 100 * 1024; // 100 KB
const MAX_AUDIO_BYTES: u64 = 20 * 1024 * 1024; // 20 MB

/// Supported text file extensions (whitelist)
const TEXT_EXTENSIONS: &[&str] = &[
    "md",
    "txt",
    "log",
    "csv",
    "tsv",
    "json",
    "yaml",
    "yml",
    "toml",
    "xml",
    "py",
    "rs",
    "js",
    "ts",
    "tsx",
    "jsx",
    "go",
    "java",
    "c",
    "cpp",
    "h",
    "hpp",
    "sh",
    "bash",
    "zsh",
    "fish",
    "html",
    "css",
    "scss",
    "less",
    "sql",
    "graphql",
    "env",
    "gitignore",
    "dockerfile",
    "swift",
    "kt",
    "rb",
    "lua",
    "r",
    "m",
    "mm",
    "ini",
    "cfg",
    "conf",
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
    std::fs::create_dir_all(&month_dir)
        .map_err(|e| format!("Failed to create attachments dir: {}", e))?;
    Ok(month_dir)
}

/// Resize an image to fit within MAX_IMAGE_DIMENSION and save as JPEG.
/// Returns the saved file path and file size.
fn save_resized_image(
    img: &image::DynamicImage,
    dest_dir: &Path,
    id: &str,
) -> Result<(String, i64), String> {
    let resized = img.resize(
        MAX_IMAGE_DIMENSION,
        MAX_IMAGE_DIMENSION,
        image::imageops::FilterType::Lanczos3,
    );
    let dest_jpeg = dest_dir.join(format!("{}.jpg", id));
    resized
        .save(&dest_jpeg)
        .map_err(|e| format!("Failed to save resized image: {}", e))?;
    let file_size = std::fs::metadata(&dest_jpeg)
        .map_err(|e| e.to_string())?
        .len() as i64;
    Ok((dest_jpeg.to_string_lossy().to_string(), file_size))
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

            // Compress oversized images to JPEG
            if src_size > MAX_IMAGE_BYTES {
                let img =
                    image::open(source_path).map_err(|e| format!("Failed to open image: {}", e))?;
                let (path, size) = save_resized_image(&img, &dest_dir, &id)?;
                let _ = generate_thumbnail(Path::new(&path));
                return Ok(PreparedAttachment {
                    id,
                    file_type: file_type.to_string(),
                    file_name,
                    file_path: path,
                    mime_type: "image/jpeg".to_string(),
                    file_size: size,
                });
            }

            // Resize if dimensions exceed limit
            if let Ok(img) = image::open(source_path) {
                if img.width() > MAX_IMAGE_DIMENSION || img.height() > MAX_IMAGE_DIMENSION {
                    let resized = img.resize(
                        MAX_IMAGE_DIMENSION,
                        MAX_IMAGE_DIMENSION,
                        image::imageops::FilterType::Lanczos3,
                    );
                    resized
                        .save(&dest_path)
                        .map_err(|e| format!("Failed to save resized image: {}", e))?;
                    let _ = generate_thumbnail(&dest_path);
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

            std::fs::copy(source_path, &dest_path)
                .map_err(|e| format!("Failed to copy image: {}", e))?;
            file_size = src_size as i64;

            // Generate thumbnail for chat list (best-effort)
            let _ = generate_thumbnail(&dest_path);
        }
        "text_file" => {
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
    let file_name = format!("paste.{}", ext);

    let img =
        image::load_from_memory(data).map_err(|e| format!("Failed to decode image: {}", e))?;

    if data.len() as u64 > MAX_IMAGE_BYTES
        || img.width() > MAX_IMAGE_DIMENSION
        || img.height() > MAX_IMAGE_DIMENSION
    {
        let (path, file_size) = save_resized_image(&img, &dest_dir, &id)?;
        let _ = generate_thumbnail(Path::new(&path));
        return Ok(PreparedAttachment {
            id,
            file_type: "image".to_string(),
            file_name,
            file_path: path,
            mime_type: "image/jpeg".to_string(),
            file_size,
        });
    }

    std::fs::write(&dest_path, data).map_err(|e| format!("Failed to write image: {}", e))?;
    let _ = generate_thumbnail(&dest_path);

    Ok(PreparedAttachment {
        id,
        file_type: "image".to_string(),
        file_name,
        file_path: dest_path.to_string_lossy().to_string(),
        mime_type: mime_type.to_string(),
        file_size: data.len() as i64,
    })
}

/// Prepare an audio attachment from raw bytes (e.g., recorded in the webview).
pub fn prepare_audio_from_bytes(
    app_data_dir: &Path,
    data: &[u8],
    mime_type: &str,
) -> Result<PreparedAttachment, String> {
    if data.is_empty() {
        return Err("Audio payload is empty".to_string());
    }
    if data.len() as u64 > MAX_AUDIO_BYTES {
        return Err("Audio file is too large (max 20MB)".to_string());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let dest_dir = attachments_dir(app_data_dir)?;

    let ext = match mime_type {
        "audio/webm" | "audio/webm;codecs=opus" => "webm",
        "audio/mp4" => "m4a",
        "audio/ogg" | "audio/ogg;codecs=opus" => "ogg",
        "audio/wav" => "wav",
        "audio/aac" => "aac",
        _ => "bin",
    };
    let dest_path = dest_dir.join(format!("{}.{}", id, ext));
    std::fs::write(&dest_path, data).map_err(|e| format!("Failed to write audio: {}", e))?;

    Ok(PreparedAttachment {
        id,
        file_type: "audio".to_string(),
        file_name: format!("voice-message.{}", ext),
        file_path: dest_path.to_string_lossy().to_string(),
        mime_type: mime_type.to_string(),
        file_size: data.len() as i64,
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

/// Load attachments for multiple messages at once (batch query).
pub fn get_attachments_for_messages(
    conn: &Connection,
    message_ids: &[String],
) -> Result<Vec<Attachment>, String> {
    if message_ids.is_empty() {
        return Ok(vec![]);
    }

    let placeholders: Vec<String> = message_ids
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect();
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

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
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

    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read text file: {}", e))?;

    if metadata.len() > MAX_TEXT_FILE_BYTES {
        let truncated: String = content.chars().take(100_000).collect();
        Ok(format!(
            "{}\n\n[... file truncated at 100KB ...]",
            truncated
        ))
    } else {
        Ok(content)
    }
}

/// Save an AI-generated image as an attachment with metadata.
/// Writes raw bytes to disk and inserts a DB record including the metadata column.
pub fn save_generated_image(
    app_data_dir: &Path,
    image_data: &[u8],
    mime_type: &str,
    message_id: &str,
    metadata: serde_json::Value,
    conn: &Connection,
) -> Result<Attachment, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let dest_dir = attachments_dir(app_data_dir)?;

    let ext = match mime_type {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    };
    let file_name = format!("{}.{}", id, ext);
    let dest_path = dest_dir.join(&file_name);

    std::fs::write(&dest_path, image_data)
        .map_err(|e| format!("Failed to write generated image: {}", e))?;

    // Generate thumbnail (best-effort, non-fatal)
    let _ = generate_thumbnail(&dest_path);

    let file_path = dest_path.to_string_lossy().to_string();
    let file_size = image_data.len() as i64;
    let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let metadata_str = serde_json::to_string(&metadata).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO attachments (id, message_id, file_type, file_name, file_path, mime_type, file_size, metadata, created_at) VALUES (?1, ?2, 'image', ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, message_id, file_name, file_path, mime_type, file_size, metadata_str, now],
    )
    .map_err(|e| format!("Failed to save generated attachment: {}", e))?;

    Ok(Attachment {
        id,
        message_id: message_id.to_string(),
        file_type: "image".to_string(),
        file_name,
        file_path,
        mime_type: mime_type.to_string(),
        file_size,
        metadata: Some(metadata),
        created_at: now,
    })
}

const THUMB_MAX_EDGE: u32 = 480;

/// Generate a thumbnail alongside the original image.
/// Returns the thumbnail path on success, or None on failure (non-fatal).
fn generate_thumbnail(original_path: &Path) -> Option<PathBuf> {
    let img = image::open(original_path).ok()?;
    let (w, h) = img.dimensions();
    if w <= THUMB_MAX_EDGE && h <= THUMB_MAX_EDGE {
        // Image is small enough — no thumbnail needed
        return None;
    }
    let thumb = img.thumbnail(THUMB_MAX_EDGE, THUMB_MAX_EDGE);

    let stem = original_path.file_stem()?.to_string_lossy().to_string();
    let thumb_path = original_path.with_file_name(format!("{}_thumb.jpg", stem));
    thumb
        .to_rgb8()
        .save_with_format(&thumb_path, image::ImageFormat::Jpeg)
        .ok()?;
    Some(thumb_path)
}

/// Delete attachment files from disk for a list of attachment records.
pub fn delete_attachment_files(attachments: &[Attachment]) {
    for att in attachments {
        let _ = std::fs::remove_file(&att.file_path);
        // Also remove thumbnail if it exists
        let path = Path::new(&att.file_path);
        if let Some(stem) = path.file_stem() {
            let thumb = path.with_file_name(format!("{}_thumb.jpg", stem.to_string_lossy()));
            let _ = std::fs::remove_file(thumb);
        }
    }
}
