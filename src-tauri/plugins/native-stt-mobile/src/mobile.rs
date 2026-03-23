use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PermissionState, PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::{NativeSttMobileInfo, PermissionResponse, RequestPermissionsPayload};

const PLUGIN_IDENTIFIER: &str = "com.wangyixiao.privatetalk.nativesttmobile";

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<NativeSttMobile<R>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "NativeSttPlugin")?;
    Ok(NativeSttMobile(handle))
}

pub struct NativeSttMobile<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> NativeSttMobile<R> {
    pub fn get_info(&self) -> crate::Result<NativeSttMobileInfo> {
        self.0.run_mobile_plugin("getInfo", ()).map_err(Into::into)
    }

    pub fn start_capture(&self) -> crate::Result<NativeSttMobileInfo> {
        self.0
            .run_mobile_plugin("startCapture", ())
            .map_err(Into::into)
    }

    pub fn finish_capture(&self) -> crate::Result<String> {
        self.0
            .run_mobile_plugin("finishCapture", ())
            .map_err(Into::into)
    }

    pub fn cancel_capture(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin::<()>("cancelCapture", ())
            .map_err(Into::into)
    }

    pub fn open_microphone_settings(&self) -> crate::Result<bool> {
        self.0
            .run_mobile_plugin("openMicrophoneSettings", ())
            .map_err(Into::into)
    }

    pub fn open_speech_settings(&self) -> crate::Result<bool> {
        self.0
            .run_mobile_plugin("openSpeechSettings", ())
            .map_err(Into::into)
    }

    pub fn check_microphone_permission(&self) -> crate::Result<PermissionState> {
        self.0
            .run_mobile_plugin::<PermissionResponse>("checkPermissions", ())
            .map(|response| response.microphone)
            .map_err(Into::into)
    }

    pub fn request_microphone_permission(&self) -> crate::Result<PermissionState> {
        self.0
            .run_mobile_plugin::<PermissionResponse>(
                "requestPermissions",
                RequestPermissionsPayload {
                    permissions: vec!["microphone".to_string()],
                },
            )
            .map(|response| response.microphone)
            .map_err(Into::into)
    }
}
