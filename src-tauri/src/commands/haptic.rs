//! Haptic feedback commands.
//!
//! On iOS we drive UIKit's three feedback generators
//! (Impact / Notification / Selection) via the ObjC bridge in
//! `gen/apple/Sources/private-talk/haptics.m`. Every other target turns
//! these commands into silent no-ops — haptics is purely an iOS UX
//! affordance and the front-end doesn't need to special-case the failure.

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ImpactStyle {
    Light,
    Medium,
    Heavy,
    Soft,
    Rigid,
}

impl ImpactStyle {
    fn as_native(&self) -> i32 {
        match self {
            ImpactStyle::Light => 0,
            ImpactStyle::Medium => 1,
            ImpactStyle::Heavy => 2,
            ImpactStyle::Soft => 3,
            ImpactStyle::Rigid => 4,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NotificationType {
    Success,
    Warning,
    Error,
}

impl NotificationType {
    fn as_native(&self) -> i32 {
        match self {
            NotificationType::Success => 0,
            NotificationType::Warning => 1,
            NotificationType::Error => 2,
        }
    }
}

#[cfg(target_os = "ios")]
extern "C" {
    fn pt_haptic_impact(style: std::os::raw::c_int);
    fn pt_haptic_notification(kind: std::os::raw::c_int);
    fn pt_haptic_selection();
}

#[tauri::command]
pub fn haptic_impact(style: ImpactStyle) {
    #[cfg(target_os = "ios")]
    unsafe {
        pt_haptic_impact(style.as_native());
    }
    #[cfg(not(target_os = "ios"))]
    {
        // Silence unused-variable warnings on desktop builds.
        let _ = style.as_native();
    }
}

#[tauri::command]
pub fn haptic_notification(kind: NotificationType) {
    #[cfg(target_os = "ios")]
    unsafe {
        pt_haptic_notification(kind.as_native());
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = kind.as_native();
    }
}

#[tauri::command]
pub fn haptic_selection() {
    #[cfg(target_os = "ios")]
    unsafe {
        pt_haptic_selection();
    }
}

#[cfg(test)]
#[cfg(not(target_os = "ios"))]
mod tests {
    use super::*;

    #[test]
    fn desktop_commands_are_silent_noops() {
        // The functions return () and shouldn't panic on any input.
        haptic_impact(ImpactStyle::Light);
        haptic_impact(ImpactStyle::Medium);
        haptic_impact(ImpactStyle::Heavy);
        haptic_impact(ImpactStyle::Soft);
        haptic_impact(ImpactStyle::Rigid);

        haptic_notification(NotificationType::Success);
        haptic_notification(NotificationType::Warning);
        haptic_notification(NotificationType::Error);

        haptic_selection();
    }
}
