const COMMANDS: &[&str] = &[
    "getInfo",
    "startCapture",
    "finishCapture",
    "cancelCapture",
    "openMicrophoneSettings",
    "openSpeechSettings",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
