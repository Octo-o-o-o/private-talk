//! Native audio capture / playback commands.
//!
//! On iOS we hand off to AVAudioRecorder / AVAudioPlayer via the ObjC bridge
//! in `gen/apple/Sources/private-talk/audio_bridge.m`. WKWebView's
//! MediaRecorder / getUserMedia pipeline has been historically unstable
//! inside Tauri shells (permission flapping, missing codecs, no
//! AVAudioSession control), so the front-end is expected to fall back to
//! the web APIs only on platforms where these commands return
//! `Err(NOT_SUPPORTED)`.
//!
//! Audio is shuttled across the FFI boundary as base64 strings to avoid
//! lifetime issues with raw byte buffers.

use serde::Serialize;

#[cfg(any(not(target_os = "ios"), test))]
const NOT_SUPPORTED: &str = "Native audio bridge is iOS-only on this build";

#[derive(Debug, Serialize)]
pub struct AudioRecording {
    pub audio_base64: String,
    pub mime_type: String,
}

#[cfg(target_os = "ios")]
mod ios {
    use super::AudioRecording;
    use std::ffi::{CStr, CString};
    use std::os::raw::{c_char, c_int};

    extern "C" {
        fn pt_audio_start_recording(out_error: *mut *mut c_char) -> c_int;
        fn pt_audio_stop_recording(
            out_base64: *mut *mut c_char,
            out_mime: *mut *mut c_char,
            out_error: *mut *mut c_char,
        ) -> c_int;
        fn pt_audio_play_base64(
            base64: *const c_char,
            mime: *const c_char,
            out_error: *mut *mut c_char,
        ) -> c_int;
        fn pt_audio_stop_playback();
        fn pt_audio_string_free(ptr: *mut c_char);
    }

    /// Pop a C string handed back by the bridge, copy it into a Rust `String`
    /// (or default), and free the underlying buffer.
    unsafe fn take_string(ptr: *mut c_char) -> Option<String> {
        if ptr.is_null() {
            return None;
        }
        let value = CStr::from_ptr(ptr).to_string_lossy().into_owned();
        pt_audio_string_free(ptr);
        Some(value)
    }

    pub fn start_recording() -> Result<(), String> {
        let mut err: *mut c_char = std::ptr::null_mut();
        let ok = unsafe { pt_audio_start_recording(&mut err) };
        if ok == 0 {
            let msg =
                unsafe { take_string(err) }.unwrap_or_else(|| "start_recording failed".into());
            return Err(msg);
        }
        Ok(())
    }

    pub fn stop_recording() -> Result<AudioRecording, String> {
        let mut b64: *mut c_char = std::ptr::null_mut();
        let mut mime: *mut c_char = std::ptr::null_mut();
        let mut err: *mut c_char = std::ptr::null_mut();
        let ok = unsafe { pt_audio_stop_recording(&mut b64, &mut mime, &mut err) };
        if ok == 0 {
            let msg = unsafe { take_string(err) }
                .unwrap_or_else(|| "stop_recording failed".into());
            return Err(msg);
        }
        let audio_base64 = unsafe { take_string(b64) }
            .ok_or_else(|| "stop_recording returned no audio data".to_string())?;
        let mime_type = unsafe { take_string(mime) }.unwrap_or_else(|| "audio/mp4".into());
        Ok(AudioRecording {
            audio_base64,
            mime_type,
        })
    }

    pub fn play(audio_base64: &str, mime: Option<&str>) -> Result<(), String> {
        let b64 = CString::new(audio_base64).map_err(|_| "invalid base64 string".to_string())?;
        let mime_c = mime
            .map(|m| CString::new(m).map_err(|_| "invalid mime string".to_string()))
            .transpose()?;
        let mime_ptr = mime_c
            .as_ref()
            .map(|c| c.as_ptr())
            .unwrap_or(std::ptr::null());

        let mut err: *mut c_char = std::ptr::null_mut();
        let ok = unsafe { pt_audio_play_base64(b64.as_ptr(), mime_ptr, &mut err) };
        if ok == 0 {
            let msg = unsafe { take_string(err) }.unwrap_or_else(|| "play failed".into());
            return Err(msg);
        }
        Ok(())
    }

    pub fn stop_playback() {
        unsafe { pt_audio_stop_playback() };
    }
}

#[cfg(not(target_os = "ios"))]
mod ios {
    use super::AudioRecording;

    pub fn start_recording() -> Result<(), String> {
        Err(super::NOT_SUPPORTED.to_string())
    }
    pub fn stop_recording() -> Result<AudioRecording, String> {
        Err(super::NOT_SUPPORTED.to_string())
    }
    pub fn play(_b64: &str, _mime: Option<&str>) -> Result<(), String> {
        Err(super::NOT_SUPPORTED.to_string())
    }
    pub fn stop_playback() {}
}

#[tauri::command]
pub fn audio_start_recording() -> Result<(), String> {
    ios::start_recording()
}

#[tauri::command]
pub fn audio_stop_recording() -> Result<AudioRecording, String> {
    ios::stop_recording()
}

#[tauri::command]
pub fn audio_play(audio_base64: String, mime_type: Option<String>) -> Result<(), String> {
    ios::play(&audio_base64, mime_type.as_deref())
}

#[tauri::command]
pub fn audio_stop_playback() {
    ios::stop_playback()
}

#[cfg(test)]
#[cfg(not(target_os = "ios"))]
mod tests {
    use super::*;

    #[test]
    fn desktop_commands_surface_the_unsupported_error() {
        assert_eq!(audio_start_recording(), Err(NOT_SUPPORTED.to_string()));
        match audio_stop_recording() {
            Err(msg) => assert_eq!(msg, NOT_SUPPORTED),
            Ok(_) => panic!("expected unsupported on desktop"),
        }
        assert_eq!(
            audio_play("AAAA".into(), Some("audio/mp4".into())),
            Err(NOT_SUPPORTED.to_string())
        );
        // stop_playback is intentionally a no-op everywhere.
        audio_stop_playback();
    }

    #[test]
    fn desktop_stop_playback_does_not_panic() {
        audio_stop_playback();
        audio_stop_playback();
    }
}
