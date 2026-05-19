//! Biometric (Face ID / Touch ID) authentication commands.
//!
//! On iOS we hand off to LAContext via the ObjC bridge
//! (`gen/apple/Sources/private-talk/biometric.m`). On every other platform
//! we report no biometry and refuse to evaluate so the front-end can keep
//! the PIN keypad as the only entry point.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
// Variants exist for FFI-serialization callers; cfg doesn't see them used
// on platforms whose `availability()` only ever constructs `None`.
#[allow(dead_code)]
pub enum BiometryKind {
    None,
    TouchId,
    FaceId,
    OpticId,
}

#[derive(Debug, Serialize)]
pub struct BiometryAvailability {
    pub available: bool,
    pub kind: BiometryKind,
}

#[cfg(target_os = "ios")]
mod ios {
    use super::{BiometryAvailability, BiometryKind};
    use std::ffi::{CStr, CString};
    use std::os::raw::{c_char, c_int};

    extern "C" {
        fn pt_biometric_available(out_kind: *mut c_int) -> c_int;
        fn pt_biometric_evaluate(reason: *const c_char, out_error: *mut *mut c_char) -> c_int;
        fn pt_biometric_string_free(ptr: *mut c_char);
    }

    fn map_kind(raw: c_int) -> BiometryKind {
        match raw {
            1 => BiometryKind::TouchId,
            2 => BiometryKind::FaceId,
            3 => BiometryKind::OpticId,
            _ => BiometryKind::None,
        }
    }

    pub fn availability() -> BiometryAvailability {
        let mut raw: c_int = 0;
        let ok = unsafe { pt_biometric_available(&mut raw) };
        BiometryAvailability {
            available: ok == 1,
            kind: map_kind(raw),
        }
    }

    pub fn evaluate(reason: &str) -> Result<bool, String> {
        let c_reason = CString::new(reason).map_err(|_| "invalid reason string".to_string())?;
        let mut err: *mut c_char = std::ptr::null_mut();
        let result = unsafe { pt_biometric_evaluate(c_reason.as_ptr(), &mut err) };

        if !err.is_null() {
            let message = unsafe { CStr::from_ptr(err) }
                .to_string_lossy()
                .into_owned();
            unsafe { pt_biometric_string_free(err) };
            if result <= 0 {
                return if result == 0 {
                    // 0 = user cancel / wrong biometric. We surface a typed
                    // boolean rather than an error string so the JS side can
                    // just fall back to the PIN keypad without showing a
                    // banner — "Cancel" is a legitimate user choice.
                    Ok(false)
                } else {
                    Err(message)
                };
            }
        }
        Ok(result == 1)
    }
}

#[cfg(not(target_os = "ios"))]
mod ios {
    use super::{BiometryAvailability, BiometryKind};

    pub fn availability() -> BiometryAvailability {
        BiometryAvailability {
            available: false,
            kind: BiometryKind::None,
        }
    }

    pub fn evaluate(_reason: &str) -> Result<bool, String> {
        Err("Biometric unlock is iOS-only on this build".into())
    }
}

#[tauri::command]
pub fn biometric_availability() -> BiometryAvailability {
    ios::availability()
}

#[tauri::command]
pub async fn biometric_evaluate(reason: String) -> Result<bool, String> {
    // LAContext blocks the calling thread while waiting for the user; run
    // it on a Tokio blocking worker so we don't stall the main runtime.
    tokio::task::spawn_blocking(move || ios::evaluate(&reason))
        .await
        .map_err(|e| format!("biometric_evaluate join failed: {e}"))?
}

#[cfg(test)]
#[cfg(not(target_os = "ios"))]
mod tests {
    use super::*;

    #[test]
    fn desktop_reports_no_biometry() {
        let info = biometric_availability();
        assert!(!info.available);
        assert!(matches!(info.kind, BiometryKind::None));
    }

    #[tokio::test]
    async fn desktop_evaluate_surfaces_unsupported_error() {
        let res = biometric_evaluate("unit test".to_string()).await;
        assert!(matches!(res, Err(_)));
    }
}
