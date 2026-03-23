use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod error;
mod models;

#[cfg(target_os = "android")]
mod mobile;

pub use error::{Error, Result};
pub use models::*;

#[cfg(target_os = "android")]
use mobile::NativeSttMobile;

pub trait NativeSttMobileExt<R: Runtime> {
    #[cfg(target_os = "android")]
    fn native_stt_mobile(&self) -> &NativeSttMobile<R>;
}

impl<R: Runtime, T: Manager<R>> NativeSttMobileExt<R> for T {
    #[cfg(target_os = "android")]
    fn native_stt_mobile(&self) -> &NativeSttMobile<R> {
        self.state::<NativeSttMobile<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("native-stt-mobile")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let native_stt_mobile = mobile::init(app, api)?;
                app.manage(native_stt_mobile);
            }
            Ok(())
        })
        .build()
}
