mod attachments;
mod commands;
mod db;
mod image_generation;
mod llm;
mod pin;

use db::DbState;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;
use tauri::Manager;

/// On iOS, mark a path so iCloud Backup skips it. The Objective-C side
/// (gen/apple/Sources/private-talk/ios_privacy.m) wraps NSURLIsExcludedFromBackupKey.
/// A no-op on every other target so desktop builds don't need the symbol.
fn exclude_from_icloud_backup(_path: &Path) {
    #[cfg(target_os = "ios")]
    {
        use std::ffi::CString;
        use std::os::raw::c_char;

        extern "C" {
            fn pt_ios_exclude_path_from_backup(path: *const c_char) -> bool;
        }

        let path_str = _path.to_string_lossy();
        if let Ok(cstr) = CString::new(path_str.as_ref()) {
            // Best-effort: failures are logged by the ObjC side and shouldn't
            // crash app startup — backup exclusion is hardening, not a hard
            // dependency.
            unsafe {
                let _ = pt_ios_exclude_path_from_backup(cstr.as_ptr());
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_dir)?;

            let db_path = app_dir.join("private-talk.db");
            let conn = Connection::open(&db_path)?;
            db::schema::init_db(&conn)?;
            // The DB holds conversations and (until the Keychain migration
            // lands) plaintext API keys — never let iCloud sync it.
            exclude_from_icloud_backup(&db_path);
            app.manage(DbState(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::assistant::list_assistants,
            commands::assistant::create_assistant,
            commands::assistant::update_assistant,
            commands::assistant::delete_assistant,
            commands::assistant::duplicate_assistant,
            commands::conversation::list_conversations,
            commands::conversation::create_conversation,
            commands::conversation::update_conversation_assistant,
            commands::conversation::delete_conversation,
            commands::conversation::rename_conversation,
            commands::conversation::get_messages,
            commands::conversation::get_message_resend_payload,
            commands::conversation::truncate_conversation_from_message,
            commands::provider::list_providers,
            commands::provider::create_provider,
            commands::provider::update_provider,
            commands::provider::delete_provider,
            commands::provider::set_default_provider,
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::stt::stt_transcribe,
            commands::tts::tts_synthesize,
            commands::image_gen::generate_image_message,
            commands::preview::get_preview_bootstrap,
            commands::chat::send_message,
            commands::chat::stop_generation,
            commands::usage::get_usage_by_conversation,
            commands::usage::get_usage_by_date,
            commands::config_io::export_config_data,
            commands::config_io::validate_backup_data,
            commands::config_io::import_config_data,
            commands::pin::is_pin_enabled,
            commands::pin::get_pin_length,
            commands::pin::verify_pin_cmd,
            commands::pin::enable_pin,
            commands::pin::disable_pin,
            commands::pin::reset_all_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
