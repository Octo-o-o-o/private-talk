use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MicrophonePermissionStatus {
    Unknown,
    Prompt,
    Granted,
    Denied,
}

#[derive(Debug, Clone, Serialize)]
pub struct MicrophonePermissionInfo {
    pub status: MicrophonePermissionStatus,
    pub source: &'static str,
}

#[tauri::command]
pub fn get_microphone_permission_status(
    app: tauri::AppHandle,
) -> Result<MicrophonePermissionInfo, String> {
    platform::get_microphone_permission_status(&app)
}

#[tauri::command]
pub fn request_microphone_permission(
    app: tauri::AppHandle,
) -> Result<MicrophonePermissionInfo, String> {
    platform::request_microphone_permission(&app)
}

#[tauri::command]
pub fn open_microphone_settings(app: tauri::AppHandle) -> Result<bool, String> {
    platform::open_microphone_settings(&app)
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod platform {
    use super::{MicrophonePermissionInfo, MicrophonePermissionStatus};
    use block2::RcBlock;
    #[cfg(target_os = "ios")]
    use objc2::MainThreadMarker;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2_av_foundation::{
        AVAuthorizationStatus, AVCaptureDevice, AVMediaType,
    };
    use objc2_foundation::NSString;
    #[cfg(target_os = "ios")]
    use objc2_foundation::NSURL;
    #[cfg(target_os = "ios")]
    use objc2_ui_kit::{UIApplication, UIApplicationOpenSettingsURLString};
    #[cfg(target_os = "macos")]
    use std::process::Command;
    use std::sync::mpsc;
    #[cfg(target_os = "ios")]
    use std::time::Duration;

    fn audio_media_type() -> Retained<AVMediaType> {
        NSString::from_str("soun")
    }

    fn map_status(status: AVAuthorizationStatus) -> MicrophonePermissionStatus {
        match status {
            AVAuthorizationStatus::Authorized => MicrophonePermissionStatus::Granted,
            AVAuthorizationStatus::Denied | AVAuthorizationStatus::Restricted => {
                MicrophonePermissionStatus::Denied
            }
            AVAuthorizationStatus::NotDetermined => MicrophonePermissionStatus::Prompt,
            _ => MicrophonePermissionStatus::Unknown,
        }
    }

    fn current_status() -> Result<MicrophonePermissionStatus, String> {
        let media_type = audio_media_type();
        let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(&media_type) };
        Ok(map_status(status))
    }

    pub fn get_microphone_permission_status(
        _app: &tauri::AppHandle,
    ) -> Result<MicrophonePermissionInfo, String> {
        Ok(MicrophonePermissionInfo {
            status: current_status()?,
            source: "native",
        })
    }

    pub fn request_microphone_permission(
        _app: &tauri::AppHandle,
    ) -> Result<MicrophonePermissionInfo, String> {
        let media_type = audio_media_type();
        let status = current_status()?;

        if !matches!(status, MicrophonePermissionStatus::Prompt) {
            return Ok(MicrophonePermissionInfo {
                status,
                source: "native",
            });
        }

        let (tx, rx) = mpsc::channel::<bool>();
        let block = RcBlock::new(move |granted: Bool| {
            let _ = tx.send(granted.as_bool());
        });

        unsafe {
            AVCaptureDevice::requestAccessForMediaType_completionHandler(&media_type, &block);
        }

        let granted = rx
            .recv()
            .map_err(|_| "Microphone permission request was interrupted".to_string())?;

        Ok(MicrophonePermissionInfo {
            status: if granted {
                MicrophonePermissionStatus::Granted
            } else {
                current_status()?
            },
            source: "native",
        })
    }

    #[cfg(target_os = "ios")]
    #[allow(deprecated)]
    fn open_ios_app_settings(app: &tauri::AppHandle) -> Result<bool, String> {
        let (tx, rx) = mpsc::channel();
        app.run_on_main_thread(move || {
            let opened = MainThreadMarker::new()
                .and_then(|mtm| {
                    let settings_url = unsafe { UIApplicationOpenSettingsURLString };
                    let url = NSURL::URLWithString(settings_url)?;
                    let application = UIApplication::sharedApplication(mtm);
                    Some(application.openURL(&url))
                })
                .unwrap_or(false);
            let _ = tx.send(opened);
        })
        .map_err(|error| error.to_string())?;

        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "Timed out while opening iOS app settings".to_string())
    }

    pub fn open_microphone_settings(_app: &tauri::AppHandle) -> Result<bool, String> {
        #[cfg(target_os = "ios")]
        {
            return open_ios_app_settings(_app);
        }

        #[cfg(target_os = "macos")]
        {
            let deep_links = [
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone",
            ];

            for url in deep_links {
                if Command::new("open")
                    .arg(url)
                    .status()
                    .map_err(|error| error.to_string())?
                    .success()
                {
                    return Ok(true);
                }
            }

            if Command::new("open")
                .args(["-a", "System Settings"])
                .status()
                .map_err(|error| error.to_string())?
                .success()
            {
                return Ok(true);
            }

            if Command::new("open")
                .args(["-b", "com.apple.systempreferences"])
                .status()
                .map_err(|error| error.to_string())?
                .success()
            {
                return Ok(true);
            }

            Ok(false)
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{MicrophonePermissionInfo, MicrophonePermissionStatus};
    use std::process::Command;
    use windows::Devices::Enumeration::{DeviceAccessInformation, DeviceAccessStatus, DeviceClass};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    fn current_status() -> Result<MicrophonePermissionStatus, String> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok().ok();
        let access = DeviceAccessInformation::CreateFromDeviceClass(DeviceClass::AudioCapture)
            .map_err(|error| error.to_string())?;
        let status = access.CurrentStatus().map_err(|error| error.to_string())?;
        let prompt_required = access.UserPromptRequired().unwrap_or(false);

        let mapped = match status {
            DeviceAccessStatus::Allowed => MicrophonePermissionStatus::Granted,
            DeviceAccessStatus::DeniedByUser | DeviceAccessStatus::DeniedBySystem => {
                MicrophonePermissionStatus::Denied
            }
            DeviceAccessStatus::Unspecified if prompt_required => {
                MicrophonePermissionStatus::Prompt
            }
            DeviceAccessStatus::Unspecified => MicrophonePermissionStatus::Unknown,
            _ => MicrophonePermissionStatus::Unknown,
        };

        Ok(mapped)
    }

    pub fn get_microphone_permission_status(
        _app: &tauri::AppHandle,
    ) -> Result<MicrophonePermissionInfo, String> {
        Ok(MicrophonePermissionInfo {
            status: current_status()?,
            source: "native",
        })
    }

    pub fn request_microphone_permission(
        app: &tauri::AppHandle,
    ) -> Result<MicrophonePermissionInfo, String> {
        get_microphone_permission_status(app)
    }

    pub fn open_microphone_settings(_app: &tauri::AppHandle) -> Result<bool, String> {
        if Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:privacy-microphone"])
            .status()
            .map_err(|error| error.to_string())?
            .success()
        {
            return Ok(true);
        }

        if Command::new("explorer.exe")
            .arg("ms-settings:privacy-microphone")
            .status()
            .map_err(|error| error.to_string())?
            .success()
        {
            return Ok(true);
        }

        Ok(false)
    }
}

#[cfg(target_os = "android")]
mod platform {
    use super::{MicrophonePermissionInfo, MicrophonePermissionStatus};
    use tauri::plugin::PermissionState;
    use tauri_plugin_native_stt_mobile::NativeSttMobileExt;

    fn map_permission_state(state: PermissionState) -> MicrophonePermissionStatus {
        match state {
            PermissionState::Granted => MicrophonePermissionStatus::Granted,
            PermissionState::Denied => MicrophonePermissionStatus::Denied,
            PermissionState::Prompt | PermissionState::PromptWithRationale => {
                MicrophonePermissionStatus::Prompt
            }
        }
    }

    pub fn get_microphone_permission_status(
        app: &tauri::AppHandle,
    ) -> Result<MicrophonePermissionInfo, String> {
        let status = app
            .native_stt_mobile()
            .check_microphone_permission()
            .map(map_permission_state)
            .map_err(|error| error.to_string())?;

        Ok(MicrophonePermissionInfo {
            status,
            source: "native",
        })
    }

    pub fn request_microphone_permission(
        app: &tauri::AppHandle,
    ) -> Result<MicrophonePermissionInfo, String> {
        let status = app
            .native_stt_mobile()
            .request_microphone_permission()
            .map(map_permission_state)
            .map_err(|error| error.to_string())?;

        Ok(MicrophonePermissionInfo {
            status,
            source: "native",
        })
    }

    pub fn open_microphone_settings(app: &tauri::AppHandle) -> Result<bool, String> {
        app.native_stt_mobile()
            .open_microphone_settings()
            .map_err(|error| error.to_string())
    }
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "windows",
    target_os = "ios",
    target_os = "android"
)))]
mod platform {
    use super::{MicrophonePermissionInfo, MicrophonePermissionStatus};

    pub fn get_microphone_permission_status(
        _app: &tauri::AppHandle,
    ) -> Result<MicrophonePermissionInfo, String> {
        Ok(MicrophonePermissionInfo {
            status: MicrophonePermissionStatus::Unknown,
            source: "unsupported",
        })
    }

    pub fn request_microphone_permission(
        app: &tauri::AppHandle,
    ) -> Result<MicrophonePermissionInfo, String> {
        get_microphone_permission_status(app)
    }

    pub fn open_microphone_settings(_app: &tauri::AppHandle) -> Result<bool, String> {
        Ok(false)
    }
}
