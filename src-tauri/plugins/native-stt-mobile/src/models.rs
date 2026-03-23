use serde::{Deserialize, Serialize};
use tauri::plugin::PermissionState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSttMobileInfo {
    pub supported: bool,
    pub status: String,
    pub source: String,
    pub platform: String,
    pub mode: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PermissionResponse {
    pub microphone: PermissionState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPermissionsPayload {
    pub permissions: Vec<String>,
}
