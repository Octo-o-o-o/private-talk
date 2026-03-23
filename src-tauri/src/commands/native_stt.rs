use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeSttStatus {
    Ready,
    Prompt,
    Denied,
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeSttInfo {
    pub supported: bool,
    pub status: NativeSttStatus,
    pub source: &'static str,
    pub platform: &'static str,
    pub mode: &'static str,
    pub detail: Option<String>,
}

pub struct NativeSttState {
    inner: Mutex<platform::PlatformState>,
}

impl Default for NativeSttState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(platform::PlatformState::default()),
        }
    }
}

#[tauri::command]
pub fn get_native_stt_info(
    app: AppHandle,
    state: State<'_, NativeSttState>,
) -> Result<NativeSttInfo, String> {
    platform::get_info(&app, &state.inner)
}

#[tauri::command]
pub async fn begin_native_stt_capture(
    app: AppHandle,
    state: State<'_, NativeSttState>,
) -> Result<NativeSttInfo, String> {
    platform::begin_capture(&app, &state.inner).await
}

#[tauri::command]
pub async fn finish_native_stt_capture(
    app: AppHandle,
    state: State<'_, NativeSttState>,
    audio_base64: String,
    mime_type: Option<String>,
) -> Result<String, String> {
    platform::finish_capture(&app, &state.inner, audio_base64, mime_type).await
}

#[tauri::command]
pub async fn cancel_native_stt_capture(
    app: AppHandle,
    state: State<'_, NativeSttState>,
) -> Result<(), String> {
    platform::cancel_capture(&app, &state.inner).await
}

#[tauri::command]
pub fn open_native_stt_settings(app: AppHandle) -> Result<bool, String> {
    platform::open_settings(&app)
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod platform {
    use super::{NativeSttInfo, NativeSttStatus};
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    use block2::RcBlock;
    use objc2::AnyThread;
    #[cfg(target_os = "ios")]
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSError, NSString, NSURL};
    use objc2_speech::{
        SFSpeechRecognitionResult, SFSpeechRecognizer, SFSpeechRecognizerAuthorizationStatus,
        SFSpeechURLRecognitionRequest,
    };
    #[cfg(target_os = "ios")]
    use objc2_ui_kit::{UIApplication, UIApplicationOpenSettingsURLString};
    use std::fs;
    use std::path::{Path, PathBuf};
    #[cfg(target_os = "macos")]
    use std::process::Command;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::Duration;
    use tauri::Manager;

    fn platform_name() -> &'static str {
        #[cfg(target_os = "ios")]
        {
            "ios"
        }

        #[cfg(not(target_os = "ios"))]
        {
            "macos"
        }
    }

    #[derive(Default)]
    pub struct PlatformState;

    fn info(status: NativeSttStatus, detail: impl Into<Option<String>>) -> NativeSttInfo {
        NativeSttInfo {
            supported: !matches!(status, NativeSttStatus::Unavailable),
            status,
            source: "native",
            platform: platform_name(),
            mode: "file",
            detail: detail.into(),
        }
    }

    fn map_authorization_status(status: SFSpeechRecognizerAuthorizationStatus) -> NativeSttStatus {
        if status == SFSpeechRecognizerAuthorizationStatus::Authorized {
            NativeSttStatus::Ready
        } else if status == SFSpeechRecognizerAuthorizationStatus::NotDetermined {
            NativeSttStatus::Prompt
        } else if status == SFSpeechRecognizerAuthorizationStatus::Denied
            || status == SFSpeechRecognizerAuthorizationStatus::Restricted
        {
            NativeSttStatus::Denied
        } else {
            NativeSttStatus::Unavailable
        }
    }

    fn create_default_recognizer() -> Result<objc2::rc::Retained<SFSpeechRecognizer>, String> {
        unsafe { SFSpeechRecognizer::init(SFSpeechRecognizer::alloc()) }.ok_or_else(|| {
            "native-stt-language-unsupported: Speech recognition is unavailable for the current macOS dictation language.".to_string()
        })
    }

    fn current_info() -> Result<NativeSttInfo, String> {
        let recognizer = match create_default_recognizer() {
            Ok(recognizer) => recognizer,
            Err(error) => {
                return Ok(info(NativeSttStatus::Unavailable, Some(error)));
            }
        };

        let auth = unsafe { SFSpeechRecognizer::authorizationStatus() };
        let status = map_authorization_status(auth);

        if matches!(status, NativeSttStatus::Ready) && !unsafe { recognizer.isAvailable() } {
            return Ok(info(
                NativeSttStatus::Unavailable,
                Some(
                    "native-stt-unavailable: Speech recognition services are temporarily unavailable on this Mac."
                        .to_string(),
                ),
            ));
        }

        let detail = match status {
            NativeSttStatus::Ready => Some(
                "Uses Apple Speech.framework to transcribe the recorded audio file after capture."
                    .to_string(),
            ),
            NativeSttStatus::Prompt => Some(
                "Apple Speech Recognition permission will be requested the first time native transcription is needed."
                    .to_string(),
            ),
            NativeSttStatus::Denied => Some(
                "Allow Private Talk to use Speech Recognition in system settings."
                    .to_string(),
            ),
            NativeSttStatus::Unavailable => None,
        };

        Ok(info(status, detail))
    }

    fn request_authorization_if_needed() -> Result<NativeSttStatus, String> {
        let current = unsafe { SFSpeechRecognizer::authorizationStatus() };
        if current != SFSpeechRecognizerAuthorizationStatus::NotDetermined {
            return Ok(map_authorization_status(current));
        }

        let (tx, rx) = mpsc::channel();
        let handler = RcBlock::new(move |status: SFSpeechRecognizerAuthorizationStatus| {
            let _ = tx.send(status);
        });

        unsafe {
            SFSpeechRecognizer::requestAuthorization(&handler);
        }

        let next = rx.recv_timeout(Duration::from_secs(30)).map_err(|_| {
            "native-stt-timeout: Timed out while waiting for macOS Speech Recognition permission."
                .to_string()
        })?;

        Ok(map_authorization_status(next))
    }

    fn audio_extension(mime_type: Option<&str>) -> &'static str {
        match mime_type.unwrap_or("audio/mp4") {
            "audio/mp4" => "m4a",
            "audio/wav" => "wav",
            "audio/mpeg" | "audio/mp3" => "mp3",
            "audio/ogg" | "audio/ogg;codecs=opus" => "ogg",
            "audio/webm" | "audio/webm;codecs=opus" => "webm",
            _ => "m4a",
        }
    }

    fn write_temp_audio_file(
        app: &tauri::AppHandle,
        audio_base64: &str,
        mime_type: Option<&str>,
    ) -> Result<PathBuf, String> {
        let audio_bytes = BASE64
            .decode(audio_base64)
            .map_err(|error| format!("native-stt-unavailable: Invalid base64 audio: {error}"))?;

        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("native-stt-unavailable: {error}"))?;
        let stt_dir = app_data_dir.join("stt").join("macos");
        fs::create_dir_all(&stt_dir).map_err(|error| {
            format!("native-stt-unavailable: Failed to create STT cache dir: {error}")
        })?;

        let file_path = stt_dir.join(format!(
            "{}.{}",
            uuid::Uuid::new_v4(),
            audio_extension(mime_type)
        ));
        fs::write(&file_path, audio_bytes).map_err(|error| {
            format!("native-stt-unavailable: Failed to write temp audio file: {error}")
        })?;

        Ok(file_path)
    }

    fn transcribe_audio_file(path: &Path) -> Result<String, String> {
        match request_authorization_if_needed()? {
            NativeSttStatus::Ready => {}
            NativeSttStatus::Denied => {
                return Err(
                    "native-stt-permission-denied: Allow Private Talk in System Settings > Privacy & Security > Speech Recognition."
                        .to_string(),
                );
            }
            NativeSttStatus::Prompt => {
                return Err(
                    "native-stt-permission-required: macOS Speech Recognition permission has not been granted yet."
                        .to_string(),
                );
            }
            NativeSttStatus::Unavailable => {
                return Err(
                    "native-stt-unavailable: macOS Speech Recognition is unavailable for the current system language."
                        .to_string(),
                );
            }
        }

        let recognizer = create_default_recognizer()?;
        if !unsafe { recognizer.isAvailable() } {
            return Err(
                "native-stt-unavailable: macOS Speech Recognition is temporarily unavailable."
                    .to_string(),
            );
        }

        let ns_path = NSString::from_str(&path.to_string_lossy());
        let url = NSURL::fileURLWithPath(&ns_path);
        let request = unsafe {
            SFSpeechURLRecognitionRequest::initWithURL(SFSpeechURLRecognitionRequest::alloc(), &url)
        };

        unsafe {
            request.setShouldReportPartialResults(false);
        }

        let (tx, rx) = mpsc::channel::<Result<String, String>>();
        let did_finish = Arc::new(AtomicBool::new(false));
        let did_finish_for_block = Arc::clone(&did_finish);

        let handler = RcBlock::new(
            move |result: *mut SFSpeechRecognitionResult, error: *mut NSError| {
                if !error.is_null() {
                    if !did_finish_for_block.swap(true, Ordering::SeqCst) {
                        let message = unsafe { (&*error).localizedDescription().to_string() };
                        let _ = tx.send(Err(format!("native-stt-unavailable: {message}")));
                    }
                    return;
                }

                let Some(result) = (unsafe { result.as_ref() }) else {
                    return;
                };

                if unsafe { result.isFinal() } && !did_finish_for_block.swap(true, Ordering::SeqCst)
                {
                    let transcript =
                        unsafe { result.bestTranscription().formattedString().to_string() };
                    let _ = tx.send(Ok(transcript));
                }
            },
        );

        let _task =
            unsafe { recognizer.recognitionTaskWithRequest_resultHandler(&request, &handler) };

        match rx.recv_timeout(Duration::from_secs(120)) {
            Ok(Ok(transcript)) => {
                let normalized = transcript.trim().to_string();
                if normalized.is_empty() {
                    Err(
                        "native-stt-empty-result: No speech was detected in the recording."
                            .to_string(),
                    )
                } else {
                    Ok(normalized)
                }
            }
            Ok(Err(error)) => Err(error),
            Err(mpsc::RecvTimeoutError::Timeout) => Err(
                "native-stt-timeout: macOS Speech Recognition did not finish in time.".to_string(),
            ),
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(
                "native-stt-unavailable: macOS Speech Recognition stopped unexpectedly."
                    .to_string(),
            ),
        }
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
            .map_err(|_| "native-stt-timeout: Timed out while opening iOS app settings.".to_string())
    }

    pub fn get_info(
        _app: &tauri::AppHandle,
        _state: &Mutex<PlatformState>,
    ) -> Result<NativeSttInfo, String> {
        current_info()
    }

    pub async fn begin_capture(
        _app: &tauri::AppHandle,
        _state: &Mutex<PlatformState>,
    ) -> Result<NativeSttInfo, String> {
        current_info()
    }

    pub async fn finish_capture(
        app: &tauri::AppHandle,
        _state: &Mutex<PlatformState>,
        audio_base64: String,
        mime_type: Option<String>,
    ) -> Result<String, String> {
        let app = app.clone();
        tokio::task::spawn_blocking(move || {
            let temp_path = write_temp_audio_file(&app, &audio_base64, mime_type.as_deref())?;
            let result = transcribe_audio_file(&temp_path);
            let _ = fs::remove_file(&temp_path);
            result
        })
        .await
        .map_err(|error| {
            format!("native-stt-unavailable: Failed to join macOS STT task: {error}")
        })?
    }

    pub async fn cancel_capture(
        _app: &tauri::AppHandle,
        _state: &Mutex<PlatformState>,
    ) -> Result<(), String> {
        Ok(())
    }

    pub fn open_settings(_app: &tauri::AppHandle) -> Result<bool, String> {
        #[cfg(target_os = "ios")]
        {
            return open_ios_app_settings(_app);
        }

        #[cfg(target_os = "macos")]
        {
            let deep_links = [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition",
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_SpeechRecognition",
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

            Ok(false)
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{NativeSttInfo, NativeSttStatus};
    use std::process::Command;
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread::{self, JoinHandle};
    use std::time::Duration;
    use windows::core::Error as WindowsError;
    use windows::Foundation::TypedEventHandler;
    use windows::Media::SpeechRecognition::{
        SpeechContinuousRecognitionCompletedEventArgs,
        SpeechContinuousRecognitionResultGeneratedEventArgs, SpeechRecognitionResultStatus,
        SpeechRecognizer,
    };

    const HRESULT_PRIVACY_STATEMENT_DECLINED: i32 = 0x8004_5509u32 as i32;

    enum WorkerCommand {
        Stop,
        Cancel,
    }

    struct ActiveWorker {
        command_tx: mpsc::Sender<WorkerCommand>,
        result_rx: mpsc::Receiver<Result<String, String>>,
        join_handle: JoinHandle<()>,
    }

    #[derive(Default)]
    pub struct PlatformState {
        active_worker: Option<ActiveWorker>,
    }

    struct WorkerRuntime {
        recognizer: SpeechRecognizer,
        session: windows::Media::SpeechRecognition::SpeechContinuousRecognitionSession,
        result_token: i64,
        completed_token: i64,
        transcript: Arc<Mutex<String>>,
        completed_rx: mpsc::Receiver<SpeechRecognitionResultStatus>,
    }

    impl WorkerRuntime {
        fn cleanup(&self) {
            let _ = self.session.RemoveResultGenerated(self.result_token);
            let _ = self.session.RemoveCompleted(self.completed_token);
            let _ = self.recognizer.Close();
        }

        fn stop_and_collect(self) -> Result<String, String> {
            self.session
                .StopAsync()
                .map_err(|error| map_windows_error(&error))?
                .get()
                .map_err(|error| map_windows_error(&error))?;

            let completed_status = self.completed_rx.recv_timeout(Duration::from_secs(8)).ok();
            self.cleanup();

            let transcript = self
                .transcript
                .lock()
                .map_err(|_| {
                    "native-stt-unavailable: Failed to read the Windows dictation result."
                        .to_string()
                })?
                .trim()
                .to_string();

            if !transcript.is_empty() {
                return Ok(transcript);
            }

            if let Some(status) = completed_status {
                return Err(map_result_status(status));
            }

            Err("native-stt-empty-result: No speech was detected in the recording.".to_string())
        }

        fn cancel(self) {
            let _ = self
                .session
                .CancelAsync()
                .and_then(|action| action.get());
            self.cleanup();
        }
    }

    fn info(detail: impl Into<Option<String>>) -> NativeSttInfo {
        NativeSttInfo {
            supported: true,
            status: NativeSttStatus::Ready,
            source: "native",
            platform: "windows",
            mode: "live",
            detail: detail.into(),
        }
    }

    fn map_windows_error(error: &WindowsError) -> String {
        if error.code().0 == HRESULT_PRIVACY_STATEMENT_DECLINED {
            return "native-stt-speech-privacy-disabled: Enable online speech recognition in Windows Settings > Privacy & security > Speech."
                .to_string();
        }

        format!("native-stt-unavailable: {error}")
    }

    fn map_result_status(status: SpeechRecognitionResultStatus) -> String {
        if status == SpeechRecognitionResultStatus::Success {
            "native-stt-empty-result: No speech was detected in the recording.".to_string()
        } else if status == SpeechRecognitionResultStatus::TopicLanguageNotSupported {
            "native-stt-language-unsupported: Windows speech recognition is unavailable for the current system speech language."
                .to_string()
        } else if status == SpeechRecognitionResultStatus::GrammarCompilationFailure {
            "native-stt-unavailable: Windows speech recognition could not compile the dictation grammar."
                .to_string()
        } else if status == SpeechRecognitionResultStatus::AudioQualityFailure {
            "native-stt-audio-quality: The recording quality was too low for Windows speech recognition."
                .to_string()
        } else if status == SpeechRecognitionResultStatus::UserCanceled {
            "native-stt-canceled: Windows speech recognition was canceled.".to_string()
        } else if status == SpeechRecognitionResultStatus::TimeoutExceeded
            || status == SpeechRecognitionResultStatus::PauseLimitExceeded
        {
            "native-stt-timeout: Windows speech recognition timed out.".to_string()
        } else if status == SpeechRecognitionResultStatus::NetworkFailure {
            "native-stt-network-required: Windows native dictation needs network access and speech privacy enabled."
                .to_string()
        } else if status == SpeechRecognitionResultStatus::MicrophoneUnavailable {
            "native-stt-microphone-unavailable: The microphone is unavailable to Windows speech recognition."
                .to_string()
        } else {
            "native-stt-unavailable: Windows speech recognition is currently unavailable."
                .to_string()
        }
    }

    fn create_recognizer() -> Result<(SpeechRecognizer, Option<String>), String> {
        let language =
            SpeechRecognizer::SystemSpeechLanguage().map_err(|error| map_windows_error(&error))?;
        let language_tag = language.LanguageTag().ok().map(|tag| tag.to_string());
        let recognizer = SpeechRecognizer::Create(&language)
            .or_else(|_| SpeechRecognizer::new())
            .map_err(|error| map_windows_error(&error))?;
        Ok((recognizer, language_tag))
    }

    fn append_transcript(target: &Arc<Mutex<String>>, next: &str) {
        let normalized = next.trim();
        if normalized.is_empty() {
            return;
        }

        if let Ok(mut transcript) = target.lock() {
            if transcript.ends_with(normalized) {
                return;
            }

            if !transcript.is_empty() {
                transcript.push(' ');
            }
            transcript.push_str(normalized);
        }
    }

    fn run_worker(
        started_tx: mpsc::Sender<Result<NativeSttInfo, String>>,
        command_rx: mpsc::Receiver<WorkerCommand>,
        result_tx: mpsc::Sender<Result<String, String>>,
    ) {
        {
            use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
            if let Err(error) = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok() {
                let _ = started_tx.send(Err(error.to_string()));
                return;
            }
        }

        let startup = (|| -> Result<(WorkerRuntime, Option<String>), String> {
            let (recognizer, language_tag) = create_recognizer()?;

            let compile_status = {
                let result = recognizer
                    .CompileConstraintsAsync()
                    .map_err(|error| map_windows_error(&error))?
                    .get()
                    .map_err(|error| map_windows_error(&error))?;
                result.Status().map_err(|error| map_windows_error(&error))
            }?;

            if compile_status != SpeechRecognitionResultStatus::Success {
                return Err(map_result_status(compile_status));
            }

            let session = recognizer
                .ContinuousRecognitionSession()
                .map_err(|error| map_windows_error(&error))?;

            let transcript = Arc::new(Mutex::new(String::new()));
            let (completed_tx, completed_rx) = mpsc::channel();

            let transcript_for_results = Arc::clone(&transcript);
            let result_token = session
                .ResultGenerated(&TypedEventHandler::<
                    windows::Media::SpeechRecognition::SpeechContinuousRecognitionSession,
                    SpeechContinuousRecognitionResultGeneratedEventArgs,
                >::new(move |_, args| {
                    let result = args.Result()?;
                    if result.Status()? == SpeechRecognitionResultStatus::Success {
                        append_transcript(&transcript_for_results, &result.Text()?.to_string());
                    }
                    Ok(())
                }))
                .map_err(|error| map_windows_error(&error))?;

            let completed_token = session
                .Completed(&TypedEventHandler::<
                    windows::Media::SpeechRecognition::SpeechContinuousRecognitionSession,
                    SpeechContinuousRecognitionCompletedEventArgs,
                >::new(move |_, args| {
                    let status = args.Status()
                        .unwrap_or(SpeechRecognitionResultStatus::Unknown);
                    let _ = completed_tx.send(status);
                    Ok(())
                }))
                .map_err(|error| map_windows_error(&error))?;

            session
                .StartAsync()
                .map_err(|error| map_windows_error(&error))?
                .get()
                .map_err(|error| map_windows_error(&error))?;

            Ok((
                WorkerRuntime {
                    recognizer,
                    session,
                    result_token,
                    completed_token,
                    transcript,
                    completed_rx,
                },
                language_tag,
            ))
        })();

        let (runtime, language_tag) = match startup {
            Ok(result) => result,
            Err(error) => {
                let _ = started_tx.send(Err(error));
                return;
            }
        };

        let detail = language_tag.map(|tag| {
            format!("Uses Windows.Media.SpeechRecognition continuous dictation ({tag}).")
        });
        let _ = started_tx.send(Ok(info(detail)));

        let command = command_rx.recv().unwrap_or(WorkerCommand::Cancel);
        match command {
            WorkerCommand::Stop => {
                let _ = result_tx.send(runtime.stop_and_collect());
            }
            WorkerCommand::Cancel => {
                runtime.cancel();
            }
        }
    }

    fn stop_worker_blocking(worker: ActiveWorker) -> Result<String, String> {
        let _ = worker.command_tx.send(WorkerCommand::Stop);
        let result = worker
            .result_rx
            .recv_timeout(Duration::from_secs(20))
            .unwrap_or_else(|_| {
                Err(
                    "native-stt-timeout: Windows speech recognition did not finish in time."
                        .to_string(),
                )
            });
        let _ = worker.join_handle.join();
        result
    }

    fn cancel_worker_blocking(worker: ActiveWorker) {
        let _ = worker.command_tx.send(WorkerCommand::Cancel);
        let _ = worker.join_handle.join();
    }

    pub fn get_info(
        _app: &tauri::AppHandle,
        _state: &Mutex<PlatformState>,
    ) -> Result<NativeSttInfo, String> {
        {
            use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
            unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok().ok();
        }
        let (_, language_tag) = create_recognizer()?;
        Ok(info(language_tag.map(|tag| {
            format!("Uses Windows.Media.SpeechRecognition continuous dictation ({tag}).")
        })))
    }

    pub async fn begin_capture(
        _app: &tauri::AppHandle,
        state: &Mutex<PlatformState>,
    ) -> Result<NativeSttInfo, String> {
        let previous_worker = {
            let mut guard = state.lock().map_err(|error| error.to_string())?;
            guard.active_worker.take()
        };
        if let Some(worker) = previous_worker {
            let _ = tokio::task::spawn_blocking(move || cancel_worker_blocking(worker))
                .await
                .map_err(|error| error.to_string());
        }

        let (started_tx, started_rx) = mpsc::channel();
        let (command_tx, command_rx) = mpsc::channel();
        let (result_tx, result_rx) = mpsc::channel();
        let join_handle = thread::spawn(move || run_worker(started_tx, command_rx, result_tx));

        let (worker, info) = tokio::task::spawn_blocking(
            move || -> Result<(ActiveWorker, NativeSttInfo), String> {
                let info = started_rx.recv().map_err(|_| {
                    "native-stt-unavailable: Windows speech worker stopped before initialization."
                        .to_string()
                })??;

                Ok((
                    ActiveWorker {
                        command_tx,
                        result_rx,
                        join_handle,
                    },
                    info,
                ))
            },
        )
        .await
        .map_err(|error| error.to_string())??;

        let mut guard = state.lock().map_err(|error| error.to_string())?;
        guard.active_worker = Some(worker);
        Ok(info)
    }

    pub async fn finish_capture(
        _app: &tauri::AppHandle,
        state: &Mutex<PlatformState>,
        _audio_base64: String,
        _mime_type: Option<String>,
    ) -> Result<String, String> {
        let worker = {
            let mut guard = state.lock().map_err(|error| error.to_string())?;
            guard.active_worker.take()
        }
        .ok_or_else(|| {
            "native-stt-session-not-started: Windows native speech recognition was not armed for this recording."
                .to_string()
        })?;

        tokio::task::spawn_blocking(move || stop_worker_blocking(worker))
            .await
            .map_err(|error| error.to_string())?
    }

    pub async fn cancel_capture(
        _app: &tauri::AppHandle,
        state: &Mutex<PlatformState>,
    ) -> Result<(), String> {
        let worker = {
            let mut guard = state.lock().map_err(|error| error.to_string())?;
            guard.active_worker.take()
        };

        if let Some(worker) = worker {
            tokio::task::spawn_blocking(move || cancel_worker_blocking(worker))
                .await
                .map_err(|error| error.to_string())?;
        }

        Ok(())
    }

    pub fn open_settings(_app: &tauri::AppHandle) -> Result<bool, String> {
        let targets = ["ms-settings:privacy-speech", "ms-settings:speech"];

        for target in targets {
            if Command::new("cmd")
                .args(["/C", "start", "", target])
                .status()
                .map_err(|error| error.to_string())?
                .success()
            {
                return Ok(true);
            }

            if Command::new("explorer.exe")
                .arg(target)
                .status()
                .map_err(|error| error.to_string())?
                .success()
            {
                return Ok(true);
            }
        }

        Ok(false)
    }
}

#[cfg(target_os = "android")]
mod platform {
    use super::{NativeSttInfo, NativeSttStatus};
    use std::sync::Mutex;
    use tauri_plugin_native_stt_mobile::{NativeSttMobileExt, NativeSttMobileInfo};

    #[derive(Default)]
    pub struct PlatformState;

    fn map_info(info: NativeSttMobileInfo) -> NativeSttInfo {
        let status = match info.status.as_str() {
            "ready" => NativeSttStatus::Ready,
            "prompt" => NativeSttStatus::Prompt,
            "denied" => NativeSttStatus::Denied,
            _ => NativeSttStatus::Unavailable,
        };

        let platform = match info.platform.as_str() {
            "android" => "android",
            _ => "other",
        };

        let mode = match info.mode.as_str() {
            "live" => "live",
            "file" => "file",
            _ => "unsupported",
        };

        NativeSttInfo {
            supported: info.supported,
            status,
            source: "native",
            platform,
            mode,
            detail: info.detail,
        }
    }

    fn normalize_mobile_error(error: impl ToString) -> String {
        let raw = error.to_string();
        if let Some(stripped) = raw.strip_prefix('[') {
            if let Some((code, message)) = stripped.split_once("] - ") {
                return format!("{code}: {message}");
            }
        }
        raw
    }

    pub fn get_info(
        app: &tauri::AppHandle,
        _state: &Mutex<PlatformState>,
    ) -> Result<NativeSttInfo, String> {
        app.native_stt_mobile()
            .get_info()
            .map(map_info)
            .map_err(normalize_mobile_error)
    }

    pub async fn begin_capture(
        app: &tauri::AppHandle,
        _state: &Mutex<PlatformState>,
    ) -> Result<NativeSttInfo, String> {
        app.native_stt_mobile()
            .start_capture()
            .map(map_info)
            .map_err(normalize_mobile_error)
    }

    pub async fn finish_capture(
        _app: &tauri::AppHandle,
        _state: &Mutex<PlatformState>,
        _audio_base64: String,
        _mime_type: Option<String>,
    ) -> Result<String, String> {
        _app.native_stt_mobile()
            .finish_capture()
            .map_err(normalize_mobile_error)
    }

    pub async fn cancel_capture(
        app: &tauri::AppHandle,
        _state: &Mutex<PlatformState>,
    ) -> Result<(), String> {
        app.native_stt_mobile()
            .cancel_capture()
            .map_err(normalize_mobile_error)
    }

    pub fn open_settings(app: &tauri::AppHandle) -> Result<bool, String> {
        app.native_stt_mobile()
            .open_speech_settings()
            .map_err(normalize_mobile_error)
    }
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "windows",
    target_os = "ios",
    target_os = "android"
)))]
mod platform {
    use super::{NativeSttInfo, NativeSttStatus};
    use std::sync::Mutex;

    #[derive(Default)]
    pub struct PlatformState;

    fn unsupported_info() -> NativeSttInfo {
        NativeSttInfo {
            supported: false,
            status: NativeSttStatus::Unavailable,
            source: "unsupported",
            platform: "other",
            mode: "unsupported",
            detail: Some(
                "Native system speech recognition is not implemented for this platform."
                    .to_string(),
            ),
        }
    }

    pub fn get_info(
        _app: &tauri::AppHandle,
        _state: &Mutex<PlatformState>,
    ) -> Result<NativeSttInfo, String> {
        Ok(unsupported_info())
    }

    pub async fn begin_capture(
        _app: &tauri::AppHandle,
        _state: &Mutex<PlatformState>,
    ) -> Result<NativeSttInfo, String> {
        Ok(unsupported_info())
    }

    pub async fn finish_capture(
        _app: &tauri::AppHandle,
        _state: &Mutex<PlatformState>,
        _audio_base64: String,
        _mime_type: Option<String>,
    ) -> Result<String, String> {
        Err("native-stt-unavailable: Native system speech recognition is not available on this platform."
            .to_string())
    }

    pub async fn cancel_capture(
        _app: &tauri::AppHandle,
        _state: &Mutex<PlatformState>,
    ) -> Result<(), String> {
        Ok(())
    }

    pub fn open_settings(_app: &tauri::AppHandle) -> Result<bool, String> {
        Ok(false)
    }
}
