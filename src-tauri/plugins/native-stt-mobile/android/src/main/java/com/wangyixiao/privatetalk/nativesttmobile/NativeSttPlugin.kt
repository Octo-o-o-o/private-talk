package com.wangyixiao.privatetalk.nativesttmobile

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.util.Locale

data class NativeSttInfo(
    val supported: Boolean,
    val status: String,
    val source: String,
    val platform: String,
    val mode: String,
    val detail: String?
)

private sealed class CaptureResult {
    data class Success(val transcript: String) : CaptureResult()
    data class Failure(val code: String, val message: String) : CaptureResult()
}

@TauriPlugin(
    permissions = [Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")]
)
class NativeSttPlugin(private val activity: Activity) : Plugin(activity) {
    private var recognizer: SpeechRecognizer? = null
    private var pendingFinishInvoke: Invoke? = null
    private var finishedResult: CaptureResult? = null
    private var latestTranscript: String = ""

    @Command
    fun getInfo(invoke: Invoke) {
        invoke.resolveObject(buildInfo())
    }

    @Command
    fun startCapture(invoke: Invoke) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            invoke.reject(
                "Microphone permission must be granted before Android speech recognition can start.",
                "native-stt-permission-required"
            )
            return
        }

        val info = buildInfo()
        if (!info.supported) {
            invoke.resolveObject(info)
            return
        }

        if (recognizer != null) {
            invoke.reject("Speech recognition is already active.", "native-stt-unavailable")
            return
        }

        latestTranscript = ""
        finishedResult = null
        pendingFinishInvoke = null

        try {
            val nextRecognizer = createRecognizer()
            nextRecognizer.setRecognitionListener(createRecognitionListener())
            recognizer = nextRecognizer
            nextRecognizer.startListening(buildRecognizerIntent())
            invoke.resolveObject(info)
        } catch (error: UnsupportedOperationException) {
            destroyRecognizer()
            invoke.reject(
                "This Android device does not provide the required on-device speech recognizer.",
                "native-stt-unavailable",
                error
            )
        } catch (error: Exception) {
            destroyRecognizer()
            invoke.reject(
                "Failed to start Android native speech recognition.",
                "native-stt-unavailable",
                error
            )
        }
    }

    @Command
    fun finishCapture(invoke: Invoke) {
        val result = finishedResult
        if (result != null) {
            finishedResult = null
            resolveResult(invoke, result)
            return
        }

        val activeRecognizer = recognizer
        if (activeRecognizer == null) {
            invoke.reject("No Android speech recognition session is active.", "native-stt-canceled")
            return
        }

        pendingFinishInvoke = invoke
        try {
            activeRecognizer.stopListening()
        } catch (error: Exception) {
            pendingFinishInvoke = null
            destroyRecognizer()
            invoke.reject(
                "Failed to finish Android speech recognition.",
                "native-stt-unavailable",
                error
            )
        }
    }

    @Command
    fun cancelCapture(invoke: Invoke) {
        pendingFinishInvoke = null
        finishedResult = CaptureResult.Failure(
            "native-stt-canceled",
            "Android speech recognition was canceled."
        )
        try {
            recognizer?.cancel()
        } catch (_: Exception) {
        }
        destroyRecognizer()
        invoke.resolve()
    }

    @Command
    fun openMicrophoneSettings(invoke: Invoke) {
        invoke.resolveObject(
            launchSettingsIntent(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", activity.packageName, null)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
        )
    }

    @Command
    fun openSpeechSettings(invoke: Invoke) {
        val openedVoiceSettings = launchSettingsIntent(
            Intent(Settings.ACTION_VOICE_INPUT_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        )
        if (openedVoiceSettings) {
            invoke.resolveObject(true)
            return
        }

        invoke.resolveObject(
            launchSettingsIntent(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", activity.packageName, null)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
        )
    }

    private fun buildInfo(): NativeSttInfo {
        val recognitionAvailable = SpeechRecognizer.isRecognitionAvailable(activity)
        val onDeviceAvailable =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                SpeechRecognizer.isOnDeviceRecognitionAvailable(activity)

        if (!recognitionAvailable) {
            return NativeSttInfo(
                supported = false,
                status = "unavailable",
                source = "native",
                platform = "android",
                mode = "unsupported",
                detail = "native-stt-unavailable: No Android speech recognition service is available on this device."
            )
        }

        return NativeSttInfo(
            supported = true,
            status = "ready",
            source = "native",
            platform = "android",
            mode = "live",
            detail =
                if (onDeviceAvailable) {
                    "Uses Android SpeechRecognizer with the system on-device recognizer."
                } else {
                    "Uses the default Android SpeechRecognizer service."
                }
        )
    }

    private fun createRecognizer(): SpeechRecognizer {
        val onDeviceAvailable =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                SpeechRecognizer.isOnDeviceRecognitionAvailable(activity)
        return if (onDeviceAvailable) {
            SpeechRecognizer.createOnDeviceSpeechRecognizer(activity)
        } else {
            SpeechRecognizer.createSpeechRecognizer(activity)
        }
    }

    private fun buildRecognizerIntent(): Intent {
        val onDeviceAvailable =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                SpeechRecognizer.isOnDeviceRecognitionAvailable(activity)

        return Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
            )
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, onDeviceAvailable)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
    }

    private fun createRecognitionListener(): RecognitionListener {
        return object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = Unit

            override fun onBeginningOfSpeech() = Unit

            override fun onRmsChanged(rmsdB: Float) = Unit

            override fun onBufferReceived(buffer: ByteArray?) = Unit

            override fun onEndOfSpeech() = Unit

            override fun onError(error: Int) {
                finishWithResult(mapRecognitionError(error))
            }

            override fun onResults(results: Bundle?) {
                val transcript = extractTranscript(results)
                if (transcript.isBlank()) {
                    finishWithResult(
                        CaptureResult.Failure(
                            "native-stt-empty-result",
                            "No speech was detected in the recording."
                        )
                    )
                    return
                }

                latestTranscript = transcript
                finishWithResult(CaptureResult.Success(transcript))
            }

            override fun onPartialResults(partialResults: Bundle?) {
                val transcript = extractTranscript(partialResults)
                if (transcript.isNotBlank()) {
                    latestTranscript = transcript
                }
            }

            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        }
    }

    private fun extractTranscript(results: Bundle?): String {
        val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        return matches?.firstOrNull()?.trim().orEmpty()
    }

    private fun mapRecognitionError(code: Int): CaptureResult.Failure {
        return when (code) {
            SpeechRecognizer.ERROR_AUDIO ->
                CaptureResult.Failure(
                    "native-stt-audio-quality",
                    "The microphone audio was not usable for Android speech recognition."
                )
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
                CaptureResult.Failure(
                    "native-stt-permission-denied",
                    "Android microphone permission is missing."
                )
            SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED,
            SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
                CaptureResult.Failure(
                    "native-stt-language-unsupported",
                    "Android speech recognition is unavailable for the current device language."
                )
            SpeechRecognizer.ERROR_NETWORK,
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
                CaptureResult.Failure(
                    "native-stt-network-required",
                    "Android speech recognition needs an available network connection for the active recognizer."
                )
            SpeechRecognizer.ERROR_NO_MATCH,
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
                CaptureResult.Failure(
                    "native-stt-empty-result",
                    "No speech was detected in the recording."
                )
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY ->
                CaptureResult.Failure(
                    "native-stt-unavailable",
                    "Android speech recognition is busy."
                )
            SpeechRecognizer.ERROR_SERVER,
            SpeechRecognizer.ERROR_SERVER_DISCONNECTED ->
                CaptureResult.Failure(
                    "native-stt-unavailable",
                    "The Android speech recognition service is unavailable."
                )
            else ->
                CaptureResult.Failure(
                    "native-stt-unavailable",
                    "Android speech recognition failed."
                )
        }
    }

    private fun finishWithResult(result: CaptureResult) {
        val invoke = pendingFinishInvoke
        pendingFinishInvoke = null
        finishedResult = if (invoke == null) result else null
        destroyRecognizer()

        if (invoke != null) {
            resolveResult(invoke, result)
        }
    }

    private fun resolveResult(invoke: Invoke, result: CaptureResult) {
        when (result) {
            is CaptureResult.Success -> invoke.resolveObject(result.transcript)
            is CaptureResult.Failure -> invoke.reject(result.message, result.code)
        }
    }

    private fun destroyRecognizer() {
        try {
            recognizer?.destroy()
        } catch (_: Exception) {
        } finally {
            recognizer = null
        }
    }

    private fun launchSettingsIntent(intent: Intent): Boolean {
        return try {
            activity.startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
    }
}
