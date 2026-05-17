mod attachments;
mod commands;
mod db;
mod image_generation;
mod llm;
mod pin;

use db::DbState;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_dir)?;

            let conn = Connection::open(app_dir.join("private-talk.db"))?;
            db::schema::init_db(&conn)?;
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
