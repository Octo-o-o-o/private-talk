//! Status-bar style command. iOS only.
//!
//! The front-end calls this whenever the resolved appearance theme
//! (dark/light) changes so the status-bar glyphs stay readable against
//! the new background. On every other target it's a no-op.

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StatusBarStyle {
    Default,
    LightContent,
    DarkContent,
}

impl StatusBarStyle {
    fn as_native(&self) -> i32 {
        match self {
            StatusBarStyle::Default => 0,
            StatusBarStyle::LightContent => 1,
            StatusBarStyle::DarkContent => 2,
        }
    }
}

#[cfg(target_os = "ios")]
extern "C" {
    fn pt_status_bar_set_style(style: std::os::raw::c_int);
}

#[tauri::command]
pub fn status_bar_set_style(style: StatusBarStyle) {
    #[cfg(target_os = "ios")]
    unsafe {
        pt_status_bar_set_style(style.as_native());
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = style.as_native();
    }
}

#[cfg(test)]
#[cfg(not(target_os = "ios"))]
mod tests {
    use super::*;

    #[test]
    fn desktop_command_is_silent_noop() {
        status_bar_set_style(StatusBarStyle::Default);
        status_bar_set_style(StatusBarStyle::LightContent);
        status_bar_set_style(StatusBarStyle::DarkContent);
    }
}
