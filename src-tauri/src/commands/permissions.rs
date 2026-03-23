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
pub fn get_microphone_permission_status() -> Result<MicrophonePermissionInfo, String> {
    platform::get_microphone_permission_status()
}

#[tauri::command]
pub fn request_microphone_permission() -> Result<MicrophonePermissionInfo, String> {
    platform::request_microphone_permission()
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{MicrophonePermissionInfo, MicrophonePermissionStatus};
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_av_foundation::{
        AVCaptureDevice, AVAuthorizationStatus, AVMediaType, AVMediaTypeAudio,
    };
    use std::sync::mpsc;

    fn audio_media_type() -> Result<&'static AVMediaType, String> {
        unsafe { AVMediaTypeAudio }
            .ok_or_else(|| "AVFoundation did not expose the audio media type".to_string())
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
        let media_type = audio_media_type()?;
        let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };
        Ok(map_status(status))
    }

    pub fn get_microphone_permission_status() -> Result<MicrophonePermissionInfo, String> {
        Ok(MicrophonePermissionInfo {
            status: current_status()?,
            source: "native",
        })
    }

    pub fn request_microphone_permission() -> Result<MicrophonePermissionInfo, String> {
        let media_type = audio_media_type()?;
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
            AVCaptureDevice::requestAccessForMediaType_completionHandler(media_type, &block);
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
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{MicrophonePermissionInfo, MicrophonePermissionStatus};
    use windows::core::initialize_mta;
    use windows::Devices::Enumeration::{
        DeviceAccessInformation, DeviceAccessStatus, DeviceClass,
    };

    fn current_status() -> Result<MicrophonePermissionStatus, String> {
        let _guard = initialize_mta().map_err(|error| error.to_string())?;
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

    pub fn get_microphone_permission_status() -> Result<MicrophonePermissionInfo, String> {
        Ok(MicrophonePermissionInfo {
            status: current_status()?,
            source: "native",
        })
    }

    pub fn request_microphone_permission() -> Result<MicrophonePermissionInfo, String> {
        get_microphone_permission_status()
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::{MicrophonePermissionInfo, MicrophonePermissionStatus};

    pub fn get_microphone_permission_status() -> Result<MicrophonePermissionInfo, String> {
        Ok(MicrophonePermissionInfo {
            status: MicrophonePermissionStatus::Unknown,
            source: "unsupported",
        })
    }

    pub fn request_microphone_permission() -> Result<MicrophonePermissionInfo, String> {
        get_microphone_permission_status()
    }
}
