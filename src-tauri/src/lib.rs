mod acp;
mod commands;
mod context;
mod db;
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
const MENU_ID_ZOOM_80: &str = "view.zoom.80";
const MENU_ID_ZOOM_90: &str = "view.zoom.90";
const MENU_ID_ZOOM_100: &str = "view.zoom.100";
const MENU_ID_ZOOM_110: &str = "view.zoom.110";
const MENU_ID_ZOOM_125: &str = "view.zoom.125";
const MENU_ID_ZOOM_150: &str = "view.zoom.150";
const MENU_ID_ZOOM_175: &str = "view.zoom.175";
const MENU_ID_ZOOM_200: &str = "view.zoom.200";
const FRONTEND_EVENT_MENU_ZOOM: &str = "app-menu-zoom";

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

    let zoom_80 = MenuItem::with_id(app, MENU_ID_ZOOM_80, "80%", true, None::<&str>)?;
    let zoom_90 = MenuItem::with_id(app, MENU_ID_ZOOM_90, "90%", true, None::<&str>)?;
    let zoom_100 = MenuItem::with_id(app, MENU_ID_ZOOM_100, "100%", true, None::<&str>)?;
    let zoom_110 = MenuItem::with_id(app, MENU_ID_ZOOM_110, "110%", true, None::<&str>)?;
    let zoom_125 = MenuItem::with_id(app, MENU_ID_ZOOM_125, "125%", true, None::<&str>)?;
    let zoom_150 = MenuItem::with_id(app, MENU_ID_ZOOM_150, "150%", true, None::<&str>)?;
    let zoom_175 = MenuItem::with_id(app, MENU_ID_ZOOM_175, "175%", true, None::<&str>)?;
    let zoom_200 = MenuItem::with_id(app, MENU_ID_ZOOM_200, "200%", true, None::<&str>)?;

    submenu.append(&zoom_80)?;
    submenu.append(&zoom_90)?;
    submenu.append(&zoom_100)?;
    submenu.append(&zoom_110)?;
    submenu.append(&zoom_125)?;
    submenu.append(&zoom_150)?;
    submenu.append(&zoom_175)?;
    submenu.append(&zoom_200)?;

    Ok(submenu)
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
fn build_view_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let view_menu = Submenu::with_id(app, "view", "View", true)?;
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

    Ok(view_menu)
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
        let view_menu = build_view_menu(app)?;
        menu.append(&view_menu)?;
    }

    Ok(menu)
}

fn zoom_value_from_menu_id(menu_id: &str) -> Option<f64> {
    match menu_id {
        MENU_ID_ZOOM_80 => Some(0.8),
        MENU_ID_ZOOM_90 => Some(0.9),
        MENU_ID_ZOOM_100 => Some(1.0),
        MENU_ID_ZOOM_110 => Some(1.1),
        MENU_ID_ZOOM_125 => Some(1.25),
        MENU_ID_ZOOM_150 => Some(1.5),
        MENU_ID_ZOOM_175 => Some(1.75),
        MENU_ID_ZOOM_200 => Some(2.0),
        _ => None,
    }
}

#[cfg(desktop)]
fn handle_menu_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: tauri::menu::MenuEvent) {
    let payload = if event.id() == MENU_ID_ZOOM_IN {
        Some(MenuZoomPayload {
            action: "in",
            zoom: None,
        })
    } else if event.id() == MENU_ID_ZOOM_OUT {
        Some(MenuZoomPayload {
            action: "out",
            zoom: None,
        })
    } else if event.id() == MENU_ID_ZOOM_RESET {
        Some(MenuZoomPayload {
            action: "reset",
            zoom: None,
        })
    } else {
        zoom_value_from_menu_id(event.id().as_ref()).map(|zoom| MenuZoomPayload {
            action: "set",
            zoom: Some(zoom),
        })
    };

    if let Some(payload) = payload {
        let _ = app.emit(FRONTEND_EVENT_MENU_ZOOM, payload);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Initialize SQLite database in app data directory
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Conversation commands
            commands::conversation::list_conversations,
            commands::conversation::list_free_conversations,
            commands::conversation::create_conversation,
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
            // Scenario commands
            commands::scenario::list_scenarios,
            commands::scenario::get_scenario,
            commands::scenario::create_scenario,
            commands::scenario::update_scenario,
            commands::scenario::delete_scenario,
            commands::scenario::duplicate_scenario,
            // Settings commands
            commands::settings::get_setting,
            commands::settings::set_setting,
            // Voice commands
            commands::voice::list_voices,
            commands::voice::get_voice,
            commands::voice::create_voice,
            commands::voice::update_voice,
            commands::voice::delete_voice,
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
