use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewBootstrap {
    pub screen: Option<String>,
    pub dataset: Option<String>,
}

#[tauri::command]
pub fn get_preview_bootstrap() -> PreviewBootstrap {
    PreviewBootstrap {
        screen: std::env::var("PRIVATE_TALK_PREVIEW_SCREEN").ok(),
        dataset: std::env::var("PRIVATE_TALK_PREVIEW_DATA").ok(),
    }
}
