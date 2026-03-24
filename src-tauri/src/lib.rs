mod acp;
mod attachments;
mod commands;
mod context;
mod db;
mod image_gen;
mod llm;
mod pin;
mod tts;

use db::DbState;
use rusqlite::Connection;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

const MENU_ID_ZOOM_IN: &str = "view.zoom_in";
const MENU_ID_ZOOM_OUT: &str = "view.zoom_out";
const MENU_ID_ZOOM_RESET: &str = "view.zoom_reset";
const FRONTEND_EVENT_MENU_ZOOM: &str = "app-menu-zoom";

/// Zoom preset menu items: (menu_id, label, zoom_factor)
const ZOOM_PRESETS: &[(&str, &str, f64)] = &[
    ("view.zoom.80", "80%", 0.8),
    ("view.zoom.90", "90%", 0.9),
    ("view.zoom.100", "100%", 1.0),
    ("view.zoom.110", "110%", 1.1),
    ("view.zoom.125", "125%", 1.25),
    ("view.zoom.150", "150%", 1.5),
    ("view.zoom.175", "175%", 1.75),
    ("view.zoom.200", "200%", 2.0),
];

#[derive(Clone, Serialize)]
struct MenuZoomPayload {
    action: &'static str,
    zoom: Option<f64>,
}

#[cfg(desktop)]
fn build_zoom_presets_submenu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<Submenu<R>> {
    let submenu = Submenu::with_id(app, "view.zoom_levels", "Zoom Level", true)?;
    for &(id, label, _) in ZOOM_PRESETS {
        let item = MenuItem::with_id(app, id, label, true, None::<&str>)?;
        submenu.append(&item)?;
    }
    Ok(submenu)
}

#[cfg(desktop)]
fn append_zoom_controls<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    view_menu: &Submenu<R>,
) -> tauri::Result<()> {
    let zoom_in = MenuItem::with_id(app, MENU_ID_ZOOM_IN, "Zoom In", true, Some("CmdOrCtrl+="))?;
    let zoom_out = MenuItem::with_id(app, MENU_ID_ZOOM_OUT, "Zoom Out", true, Some("CmdOrCtrl+-"))?;
    let actual_size = MenuItem::with_id(
        app,
        MENU_ID_ZOOM_RESET,
        "Actual Size",
        true,
        Some("CmdOrCtrl+0"),
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let zoom_presets = build_zoom_presets_submenu(app)?;

    view_menu.append(&zoom_in)?;
    view_menu.append(&zoom_out)?;
    view_menu.append(&actual_size)?;
    view_menu.append(&separator)?;
    view_menu.append(&zoom_presets)?;

    Ok(())
}

#[cfg(desktop)]
fn prepend_zoom_controls_to_view<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    view_menu: &Submenu<R>,
) -> tauri::Result<()> {
    let zoom_in = MenuItem::with_id(app, MENU_ID_ZOOM_IN, "Zoom In", true, Some("CmdOrCtrl+="))?;
    let zoom_out = MenuItem::with_id(app, MENU_ID_ZOOM_OUT, "Zoom Out", true, Some("CmdOrCtrl+-"))?;
    let actual_size = MenuItem::with_id(
        app,
        MENU_ID_ZOOM_RESET,
        "Actual Size",
        true,
        Some("CmdOrCtrl+0"),
    )?;
    let separator_1 = PredefinedMenuItem::separator(app)?;
    let zoom_presets = build_zoom_presets_submenu(app)?;
    let separator_2 = PredefinedMenuItem::separator(app)?;

    view_menu.insert(&zoom_in, 0)?;
    view_menu.insert(&zoom_out, 1)?;
    view_menu.insert(&actual_size, 2)?;
    view_menu.insert(&separator_1, 3)?;
    view_menu.insert(&zoom_presets, 4)?;
    view_menu.insert(&separator_2, 5)?;

    Ok(())
}

#[cfg(desktop)]
fn build_app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;

    let existing_view_menu = menu.items()?.into_iter().find_map(|item| {
        let submenu = item.as_submenu()?;
        let label = submenu.text().ok()?;
        if label == "View" {
            Some(submenu.clone())
        } else {
            None
        }
    });

    if let Some(view_menu) = existing_view_menu {
        prepend_zoom_controls_to_view(app, &view_menu)?;
    } else {
        let view_menu = Submenu::with_id(app, "view", "View", true)?;
        append_zoom_controls(app, &view_menu)?;
        menu.append(&view_menu)?;
    }

    Ok(menu)
}

fn zoom_value_from_menu_id(menu_id: &str) -> Option<f64> {
    ZOOM_PRESETS
        .iter()
        .find(|&&(id, _, _)| id == menu_id)
        .map(|&(_, _, zoom)| zoom)
}

#[cfg(desktop)]
fn handle_menu_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: tauri::menu::MenuEvent) {
    let id = event.id();
    let payload = match id.as_ref() {
        MENU_ID_ZOOM_IN => Some(MenuZoomPayload {
            action: "in",
            zoom: None,
        }),
        MENU_ID_ZOOM_OUT => Some(MenuZoomPayload {
            action: "out",
            zoom: None,
        }),
        MENU_ID_ZOOM_RESET => Some(MenuZoomPayload {
            action: "reset",
            zoom: None,
        }),
        other => zoom_value_from_menu_id(other).map(|zoom| MenuZoomPayload {
            action: "set",
            zoom: Some(zoom),
        }),
    };

    if let Some(payload) = payload {
        let _ = app.emit(FRONTEND_EVENT_MENU_ZOOM, payload);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_native_stt_mobile::init());

    let builder = builder
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
            let db_path = app_dir.join("private-talk.db");

            let conn = Connection::open(&db_path).expect("Failed to open database");
            db::schema::init_db(&conn).expect("Failed to initialize database");

            app.manage(DbState(Mutex::new(conn)));
            app.manage(acp::client::AcpState::new());
            app.manage(commands::native_stt::NativeSttState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Conversation commands
            commands::conversation::list_conversations,
            commands::conversation::list_free_conversations,
            commands::conversation::create_conversation,
            commands::conversation::update_conversation_assistant,
            commands::conversation::update_conversation_scenario,
            commands::conversation::delete_conversation,
            commands::conversation::rename_conversation,
            commands::conversation::get_messages,
            // Provider commands
            commands::provider::list_providers,
            commands::provider::create_provider,
            commands::provider::update_provider,
            commands::provider::delete_provider,
            commands::provider::set_default_provider,
            commands::provider::discover_provider_models,
            commands::provider::scan_local_providers,
            // Assistant commands
            commands::assistant::list_assistants,
            commands::assistant::get_assistant,
            commands::assistant::create_assistant,
            commands::assistant::update_assistant,
            commands::assistant::delete_assistant,
            commands::assistant::duplicate_assistant,
            // Legacy Scenario command aliases
            commands::assistant::list_scenarios,
            commands::assistant::get_scenario,
            commands::assistant::create_scenario,
            commands::assistant::update_scenario,
            commands::assistant::delete_scenario,
            commands::assistant::duplicate_scenario,
            // Settings commands
            commands::settings::get_setting,
            commands::settings::set_setting,
            // Permission commands
            commands::permissions::get_microphone_permission_status,
            commands::permissions::request_microphone_permission,
            commands::permissions::open_microphone_settings,
            commands::native_stt::get_native_stt_info,
            commands::native_stt::begin_native_stt_capture,
            commands::native_stt::finish_native_stt_capture,
            commands::native_stt::cancel_native_stt_capture,
            commands::native_stt::open_native_stt_settings,
            // Voice commands
            commands::voice::list_voices,
            commands::voice::get_voice,
            commands::voice::create_voice,
            commands::voice::update_voice,
            commands::voice::delete_voice,
            commands::voice::save_ref_audio,
            // TTS/STT commands
            commands::tts::tts_synthesize,
            commands::tts::parse_voice_segments,
            commands::tts::stt_transcribe,
            // Chat commands
            commands::chat::send_message,
            commands::chat::stop_generation,
            commands::chat::get_context_stats,
            commands::chat::toggle_pin_message,
            commands::chat::generate_title,
            commands::chat::delete_messages_from,
            commands::chat::update_message_content,
            commands::chat::prepare_attachments,
            commands::chat::prepare_image_attachment,
            commands::chat::prepare_audio_attachment,
            commands::chat::prepare_text_attachment,
            // PIN commands
            commands::pin::is_pin_enabled,
            commands::pin::verify_pin_cmd,
            commands::pin::enable_pin,
            commands::pin::disable_pin,
            commands::pin::reset_all_data,
            // Usage commands
            commands::usage::get_usage_by_conversation,
            commands::usage::get_usage_by_date,
            // OpenClaw commands
            commands::openclaw::list_openclaw_instances,
            commands::openclaw::create_openclaw_instance,
            commands::openclaw::update_openclaw_instance,
            commands::openclaw::delete_openclaw_instance,
            commands::openclaw::detect_local_openclaw,
            commands::openclaw::list_openclaw_agents,
            commands::openclaw::send_openclaw_message,
            commands::openclaw::stop_openclaw_generation,
            commands::openclaw::parse_connection_string,
            // Config import/export commands
            commands::config_io::export_config,
            commands::config_io::cache_backup_data,
            commands::config_io::validate_backup,
            commands::config_io::import_config,
        ]);

    #[cfg(desktop)]
    let builder = builder
        .menu(build_app_menu)
        .on_menu_event(handle_menu_event);

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let acp_state = app.state::<acp::client::AcpState>();
                tauri::async_runtime::block_on(acp_state.kill_all());
            }
        });
}
