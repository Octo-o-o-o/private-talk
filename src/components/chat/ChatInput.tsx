import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AudioLines,
  Loader2,
  Mic,
  Paperclip,
  Send,
  Square,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAppStore } from "../../stores/appStore";
import * as api from "../../lib/tauri";
import type { PreparedAttachment } from "../../lib/types";
import { AttachmentImage } from "./AttachmentImage";

interface Props {
  onSend: (content: string, attachmentJsons?: string[]) => void;
  onStop: () => void;
}

type PlatformKind = "macos" | "windows" | "linux" | "unknown";
type MicrophoneCapability =
  | "ready"
  | "missing-get-user-media"
  | "missing-media-recorder"
  | "insecure-context";
type MicrophonePermissionState =
  | "unknown"
  | "prompt"
  | "granted"
  | "denied";
type ComposerAttachmentStatus = "preparing" | "ready" | "error";
type ComposerAttachmentType = "image" | "text_file" | "audio";

interface ComposerAttachment {
  clientId: string;
  fileName: string;
  fileSize: number;
  fileType: ComposerAttachmentType;
  mimeType: string;
  status: ComposerAttachmentStatus;
  previewUrl?: string;
  prepared?: PreparedAttachment;
  error?: string;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SystemSpeechSession {
  recognition: SpeechRecognitionLike;
  transcript: string;
  error: string | null;
  endPromise: Promise<string>;
  resolveEnd: (transcript: string) => void;
  resolved: boolean;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const TEXT_EXTENSIONS = new Set([
  "md",
  "txt",
  "log",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "py",
  "rs",
  "js",
  "ts",
  "tsx",
  "jsx",
  "go",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "sh",
  "bash",
  "zsh",
  "html",
  "css",
  "scss",
  "less",
  "sql",
  "graphql",
  "env",
  "gitignore",
  "dockerfile",
]);

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

function getExtensionFromMimeType(mimeType: string) {
  const [, subtype = "bin"] = mimeType.split("/");
  return subtype.split("+")[0] || "bin";
}

function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function getSupportedMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];

  for (const mime of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }

  return "";
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function detectPlatform(): PlatformKind {
  if (typeof navigator === "undefined") return "unknown";
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("mac os") || userAgent.includes("macintosh")) {
    return "macos";
  }
  if (userAgent.includes("windows")) {
    return "windows";
  }
  if (userAgent.includes("linux")) {
    return "linux";
  }
  return "unknown";
}

function detectMicrophoneCapability(): MicrophoneCapability {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "insecure-context";
  }
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== "function"
  ) {
    return "missing-get-user-media";
  }
  if (typeof MediaRecorder === "undefined") {
    return "missing-media-recorder";
  }
  return "ready";
}

function getSpeechRecognitionConstructor():
  | SpeechRecognitionConstructor
  | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function extractSpeechRecognitionTranscript(
  results: ArrayLike<SpeechRecognitionResultLike>
) {
  let finalTranscript = "";
  let interimTranscript = "";

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const alternative = result?.[0];
    if (!alternative?.transcript) continue;
    if (result.isFinal) {
      finalTranscript += alternative.transcript;
    } else {
      interimTranscript += alternative.transcript;
    }
  }

  return `${finalTranscript} ${interimTranscript}`.trim();
}

export function ChatInput({ onSend, onStop }: Props) {
  const [input, setInput] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<
    ComposerAttachment[]
  >([]);
  const [recordingMode, setRecordingMode] = useState<
    "voice-message" | "voice-to-text" | null
  >(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [transcribingMode, setTranscribingMode] = useState<
    "voice-message" | "voice-to-text" | null
  >(null);
  const [composerError, setComposerError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [microphonePermission, setMicrophonePermission] =
    useState<MicrophonePermissionState>("unknown");
  const [isResolvingMicrophonePermission, setIsResolvingMicrophonePermission] =
    useState(false);
  const [hasResolvedMicrophonePermission, setHasResolvedMicrophonePermission] =
    useState(false);
  const [didAttemptOpenMicrophoneSettings, setDidAttemptOpenMicrophoneSettings] =
    useState(false);

  const dragCounterRef = useRef(0);
  const composerAttachmentsRef = useRef<ComposerAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingMimeTypeRef = useRef("");
  const systemSpeechSessionRef = useRef<SystemSpeechSession | null>(null);

  const isStreaming = useAppStore((s) => s.isStreaming);
  const streamingConversationId = useAppStore((s) => s.streamingConversationId);
  const currentConversationId = useAppStore((s) => s.currentConversationId);
  const conversations = useAppStore((s) => s.conversations);
  const selectedProviderId = useAppStore((s) => s.selectedProviderId);
  const selectedSttProviderId = useAppStore((s) => s.selectedSttProviderId);
  const sttModel = useAppStore((s) => s.sttModel);
  const providers = useAppStore((s) => s.providers);
  const { t, locale } = useI18n();
  const platform = detectPlatform();
  const microphoneCapability = detectMicrophoneCapability();
  const systemSpeechRecognitionSupported =
    getSpeechRecognitionConstructor() !== null;

  const isOtherStreaming =
    isStreaming &&
    streamingConversationId !== null &&
    streamingConversationId !== currentConversationId;
  const currentConversation = currentConversationId
    ? conversations.find((conversation) => conversation.id === currentConversationId) ?? null
    : null;
  const canSendChatMessage =
    !!selectedProviderId || !!currentConversation?.openclaw_instance_id;
  const selectedSttProvider = selectedSttProviderId
    ? providers.find((provider) => provider.id === selectedSttProviderId) ?? null
    : null;
  const hasConfiguredSttProvider = !!selectedSttProviderId;
  const hasAnySpeechTranscriptionPath =
    hasConfiguredSttProvider || systemSpeechRecognitionSupported;
  const readyAttachments = composerAttachments.filter(
    (attachment): attachment is ComposerAttachment & { prepared: PreparedAttachment } =>
      attachment.status === "ready" && !!attachment.prepared
  );
  const hasPreparingAttachments = composerAttachments.some(
    (attachment) => attachment.status === "preparing"
  );
  const hasFailedAttachments = composerAttachments.some(
    (attachment) => attachment.status === "error"
  );
  const isRecording = recordingMode !== null;
  const isTranscribing = transcribingMode !== null;
  const canSend =
    (input.trim().length > 0 || readyAttachments.length > 0) &&
    !isStreaming &&
    !isOtherStreaming &&
    !isRecording &&
    !isTranscribing &&
    !hasPreparingAttachments &&
    !hasFailedAttachments;
  const canUseVoiceToTextAction =
    microphoneCapability === "ready" &&
    hasAnySpeechTranscriptionPath &&
    !isStreaming &&
    !isOtherStreaming &&
    !isTranscribing &&
    !hasPreparingAttachments &&
    !isResolvingMicrophonePermission;
  const canUseVoiceMessageAction =
    canUseVoiceToTextAction && canSendChatMessage;
  const canUseAttachmentPicker = !isStreaming && !isOtherStreaming && !isRecording && !isTranscribing;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [input]);

  useEffect(() => {
    composerAttachmentsRef.current = composerAttachments;
  }, [composerAttachments]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stream.getTracks().forEach((track) => track.stop());
        recorder.stop();
      }
      const speechSession = systemSpeechSessionRef.current;
      if (speechSession) {
        try {
          speechSession.recognition.abort();
        } catch {
          // Ignore cleanup failures.
        }
        if (!speechSession.resolved) {
          speechSession.resolved = true;
          speechSession.resolveEnd(speechSession.transcript);
        }
      }
      composerAttachmentsRef.current.forEach((attachment) => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      });
    };
  }, []);

  const refreshMicrophonePermission = useCallback(async () => {
    if (
      microphoneCapability === "missing-get-user-media" ||
      typeof navigator === "undefined"
    ) {
      setHasResolvedMicrophonePermission(true);
      return;
    }

    let nextPermission: MicrophonePermissionState = "unknown";

    try {
      const nativePermission = await api.getMicrophonePermissionStatus();
      if (
        nativePermission.status === "granted" ||
        nativePermission.status === "denied"
      ) {
        setMicrophonePermission(nativePermission.status);
        setHasResolvedMicrophonePermission(true);
        return;
      }
      if (nativePermission.status === "prompt") {
        nextPermission = "prompt";
      }
    } catch (error) {
      console.error("Failed to read native microphone permission:", error);
    }

    if (navigator.permissions?.query) {
      try {
        const status = await navigator.permissions.query({
          name: "microphone" as PermissionName,
        });

        if (status.state === "granted") {
          nextPermission = "granted";
        } else if (status.state === "denied") {
          nextPermission = "denied";
        } else if (status.state === "prompt") {
          nextPermission = "prompt";
        }
      } catch {
        // Safari / WKWebView may not expose the Permissions API for microphone.
      }
    }

    if (
      nextPermission !== "granted" &&
      navigator.mediaDevices?.enumerateDevices
    ) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(
          (device) => device.kind === "audioinput"
        );
        if (audioInputs.some((device) => device.label.trim().length > 0)) {
          nextPermission = "granted";
        } else if (
          nextPermission === "unknown" &&
          audioInputs.length > 0
        ) {
          nextPermission = "prompt";
        }
      } catch {
        // Ignore device enumeration failures and keep the best-known state.
      }
    }

    setMicrophonePermission(nextPermission);
    setHasResolvedMicrophonePermission(true);
  }, [microphoneCapability]);

  useEffect(() => {
    void refreshMicrophonePermission();
    const warmupTimer = window.setTimeout(() => {
      void refreshMicrophonePermission();
    }, 900);

    return () => {
      window.clearTimeout(warmupTimer);
    };
  }, [refreshMicrophonePermission]);

  useEffect(() => {
    const handleVisibilityRefresh = () => {
      if (document.visibilityState === "visible") {
        void refreshMicrophonePermission();
      }
    };
    const handleFocusRefresh = () => {
      void refreshMicrophonePermission();
    };

    window.addEventListener("focus", handleFocusRefresh);
    document.addEventListener("visibilitychange", handleVisibilityRefresh);

    return () => {
      window.removeEventListener("focus", handleFocusRefresh);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityRefresh
      );
    };
  }, [refreshMicrophonePermission]);

  const clearComposerError = () => {
    if (composerError) {
      setComposerError("");
    }
  };

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const attachmentJsons = readyAttachments.map((attachment) =>
      JSON.stringify(attachment.prepared)
    );
    onSend(input.trim(), attachmentJsons.length > 0 ? attachmentJsons : undefined);
    setInput("");
    setComposerAttachments((current) => {
      current.forEach((attachment) => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      });
      return [];
    });
    setComposerError("");
  }, [canSend, input, onSend, readyAttachments, composerError]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const appendComposerAttachment = (attachment: ComposerAttachment) => {
    setComposerAttachments((prev) => [...prev, attachment]);
  };

  const updateComposerAttachment = (
    clientId: string,
    patch: Partial<ComposerAttachment>
  ) => {
    setComposerAttachments((prev) =>
      prev.map((attachment) =>
        attachment.clientId === clientId
          ? { ...attachment, ...patch }
          : attachment
      )
    );
  };

  const queueImageAttachment = (file: Blob, fileName: string, mimeType: string) => {
    const clientId = crypto.randomUUID();
    const previewUrl = URL.createObjectURL(file);

    appendComposerAttachment({
      clientId,
      fileName,
      fileSize: file.size,
      fileType: "image",
      mimeType,
      status: "preparing",
      previewUrl,
    });

    void (async () => {
      try {
        const b64 = await readFileAsBase64(file);
        const json = await api.prepareImageAttachment(b64, mimeType || "image/png");
        const prepared = JSON.parse(json) as PreparedAttachment;
        updateComposerAttachment(clientId, {
          status: "ready",
          prepared,
          fileName: prepared.file_name,
          fileSize: prepared.file_size,
          mimeType: prepared.mime_type,
        });
      } catch (error) {
        console.error(`Failed to prepare attachment ${fileName}:`, error);
        updateComposerAttachment(clientId, {
          status: "error",
          error: getErrorMessage(
            error,
            t("图片处理失败，请移除后重试", "Image preparation failed")
          ),
        });
      }
    })();
  };

  const queueTextAttachment = (file: File, mimeType: string) => {
    const clientId = crypto.randomUUID();

    appendComposerAttachment({
      clientId,
      fileName: file.name,
      fileSize: file.size,
      fileType: "text_file",
      mimeType,
      status: "preparing",
    });

    void (async () => {
      try {
        const content = await readFileAsText(file);
        const json = await api.prepareTextAttachment(file.name, content, mimeType);
        const prepared = JSON.parse(json) as PreparedAttachment;
        updateComposerAttachment(clientId, {
          status: "ready",
          prepared,
          fileName: prepared.file_name,
          fileSize: prepared.file_size,
          mimeType: prepared.mime_type,
        });
      } catch (error) {
        console.error(`Failed to prepare attachment ${file.name}:`, error);
        updateComposerAttachment(clientId, {
          status: "error",
          error: getErrorMessage(
            error,
            t("附件处理失败，请移除后重试", "Attachment preparation failed")
          ),
        });
      }
    })();
  };

  const prepareSelectedFiles = (files: FileList | File[]) => {
    clearComposerError();

    for (const file of Array.from(files)) {
      const ext = getFileExtension(file.name);

      if (file.type.startsWith("image/")) {
        queueImageAttachment(file, file.name, file.type || "image/png");
        continue;
      }

      if (TEXT_EXTENSIONS.has(ext)) {
        queueTextAttachment(file, file.type || "text/plain");
        continue;
      }

      setComposerError(
        t(
          `暂不支持附件类型：${file.name}`,
          `Unsupported attachment type: ${file.name}`
        )
      );
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    prepareSelectedFiles(files);
    event.target.value = "";
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item.type.startsWith("image/")) continue;

      event.preventDefault();
      const blob = item.getAsFile();
      if (!blob) continue;

      clearComposerError();
      const extension = getExtensionFromMimeType(item.type || "image/png");
      const fileName = `paste.${extension}`;
      queueImageAttachment(blob, fileName, item.type || "image/png");
      break;
    }
  };

  const removePendingAttachment = (clientId: string) => {
    setComposerAttachments((prev) => {
      const target = prev.find((attachment) => attachment.clientId === clientId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((attachment) => attachment.clientId !== clientId);
    });
  };

  const getMicrophoneSettingsHint = () => {
    if (platform === "windows") {
      return t(
        "请在 Windows 设置 > 隐私和安全性 > 麦克风 中允许此应用访问麦克风",
        "Allow this app to use the microphone in Windows Settings > Privacy & security > Microphone"
      );
    }
    if (platform === "macos") {
      return t(
        "请在 系统设置 > 隐私与安全性 > 麦克风 中允许 Private Talk",
        "Allow Private Talk in System Settings > Privacy & Security > Microphone"
      );
    }
    return t(
      "请在系统隐私设置中允许此应用访问麦克风",
      "Allow microphone access for this app in your system privacy settings"
    );
  };

  const getMicrophoneSettingsSteps = () => {
    if (platform === "windows") {
      return t(
        "手动路径：1. 打开设置 2. 隐私和安全性 3. 麦克风 4. 打开“允许桌面应用访问你的麦克风”，并确认 Private Talk 可访问",
        "Manual path: 1. Open Settings 2. Privacy & security 3. Microphone 4. Turn on desktop app microphone access and confirm Private Talk is allowed"
      );
    }
    if (platform === "macos") {
      return t(
        "手动路径：1. 打开系统设置 2. 隐私与安全性 3. 麦克风 4. 打开 Private Talk 的开关",
        "Manual path: 1. Open System Settings 2. Privacy & Security 3. Microphone 4. Turn on Private Talk"
      );
    }
    return t(
      "如果系统设置没有自动打开，请到系统隐私设置里的麦克风页面，允许 Private Talk 访问麦克风",
      "If system settings did not open automatically, go to the microphone privacy page in system settings and allow Private Talk"
    );
  };

  const getOpenedMicrophoneSettingsHint = () => {
    if (platform === "windows") {
      return t(
        "如果 Windows 设置已经打开，请进入“隐私和安全性 > 麦克风”，然后打开“允许桌面应用访问你的麦克风”，并确认 Private Talk 可访问。",
        "If Windows Settings is already open, go to Privacy & security > Microphone, then enable desktop app microphone access and confirm Private Talk is allowed."
      );
    }
    if (platform === "macos") {
      return t(
        "如果系统设置已经打开，请在左侧进入“隐私与安全性 > 麦克风”，然后打开 Private Talk。",
        "If System Settings is already open, use the left sidebar to open Privacy & Security > Microphone, then turn on Private Talk."
      );
    }
    return t(
      "如果系统设置已经打开，请进入麦克风权限页面并允许 Private Talk 访问。",
      "If system settings is already open, go to the microphone permissions page and allow Private Talk."
    );
  };

  const openMicrophoneSettings = async () => {
    setDidAttemptOpenMicrophoneSettings(true);
    try {
      const opened = await api.openMicrophoneSettings();
      if (!opened) {
        setComposerError(
          `${getMicrophoneSettingsHint()} ${getMicrophoneSettingsSteps()}`
        );
      }
    } catch (error) {
      console.error("Failed to open microphone settings:", error);
      setComposerError(
        `${getMicrophoneSettingsHint()} ${getMicrophoneSettingsSteps()}`
      );
    }
  };

  const handleMicrophoneAccessFailure = (
    error: unknown,
    mode: "permission" | "recording"
  ) => {
    if (error instanceof DOMException) {
      switch (error.name) {
        case "NotAllowedError":
        case "PermissionDeniedError":
        case "SecurityError":
          setMicrophonePermission("denied");
          setComposerError(getMicrophoneSettingsHint());
          return;
        case "NotFoundError":
        case "DevicesNotFoundError":
          setComposerError(
            t("没有检测到可用麦克风", "No microphone device was found")
          );
          return;
        case "NotReadableError":
        case "TrackStartError":
        case "AbortError":
          setComposerError(
            t(
              "麦克风当前不可用，可能正被其它应用占用",
              "The microphone is unavailable, possibly in use by another app"
            )
          );
          return;
        default:
          break;
      }
    }

    setComposerError(
      getErrorMessage(
        error,
        mode === "permission"
          ? t("麦克风授权失败，请重试", "Microphone permission request failed")
          : t("麦克风不可用，请检查系统权限设置", "Microphone access is unavailable")
      )
    );
  };

  const requestMicrophonePermission = async () => {
    if (
      microphoneCapability === "missing-get-user-media" ||
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      return false;
    }

    clearComposerError();
    setIsResolvingMicrophonePermission(true);

    try {
      try {
        const nativePermission = await api.requestNativeMicrophonePermission();
        if (nativePermission.status === "granted") {
          setMicrophonePermission("granted");
          setHasResolvedMicrophonePermission(true);
          return true;
        }
        if (nativePermission.status === "denied") {
          setMicrophonePermission("denied");
          setHasResolvedMicrophonePermission(true);
          setComposerError(getMicrophoneSettingsHint());
          return false;
        }
      } catch (error) {
        console.error("Failed to request native microphone permission:", error);
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicrophonePermission("granted");
      setHasResolvedMicrophonePermission(true);
      return true;
    } catch (error) {
      console.error("Failed to request microphone permission:", error);
      handleMicrophoneAccessFailure(error, "permission");
      return false;
    } finally {
      setIsResolvingMicrophonePermission(false);
      void refreshMicrophonePermission();
    }
  };

  const startSystemSpeechRecognition = useCallback(() => {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) return false;

    const existingSession = systemSpeechSessionRef.current;
    if (existingSession) {
      try {
        existingSession.recognition.abort();
      } catch {
        // Ignore stale session cleanup failures.
      }
      if (!existingSession.resolved) {
        existingSession.resolved = true;
        existingSession.resolveEnd(existingSession.transcript);
      }
      systemSpeechSessionRef.current = null;
    }

    try {
      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = locale;

      let resolveEnd: (transcript: string) => void = () => undefined;
      const session: SystemSpeechSession = {
        recognition,
        transcript: "",
        error: null,
        resolved: false,
        endPromise: new Promise<string>((resolve) => {
          resolveEnd = resolve;
        }),
        resolveEnd: (transcript: string) => resolveEnd(transcript),
      };

      recognition.onresult = (event) => {
        session.transcript = extractSpeechRecognitionTranscript(event.results);
      };
      recognition.onerror = (event) => {
        session.error = event.error;
      };
      recognition.onend = () => {
        if (!session.resolved) {
          session.resolved = true;
          session.resolveEnd(session.transcript);
        }
      };

      systemSpeechSessionRef.current = session;
      recognition.start();
      return true;
    } catch (error) {
      console.error("Failed to start system speech recognition:", error);
      systemSpeechSessionRef.current = null;
      return false;
    }
  }, [locale]);

  const stopSystemSpeechRecognition = useCallback(
    async (mode: "stop" | "abort" = "stop") => {
      const session = systemSpeechSessionRef.current;
      if (!session) return "";

      systemSpeechSessionRef.current = null;

      try {
        if (mode === "abort") {
          session.recognition.abort();
        } else {
          session.recognition.stop();
        }
      } catch {
        // Ignore stop failures and fall through to timeout.
      }

      const timeoutPromise = new Promise<string>((resolve) => {
        window.setTimeout(() => resolve(session.transcript), 800);
      });

      const transcript = await Promise.race([
        session.endPromise,
        timeoutPromise,
      ]);

      if (!session.resolved) {
        session.resolved = true;
        session.resolveEnd(transcript);
      }

      return transcript.trim();
    },
    []
  );

  const transcribeRecordedAudio = useCallback(
    async (
      audioBase64: string,
      mimeType: string,
      systemTranscriptPromise: Promise<string>
    ) => {
      let providerError: unknown = null;

      if (selectedSttProviderId) {
        try {
          const transcript = await api.sttTranscribe(
            audioBase64,
            selectedSttProviderId,
            mimeType
          );
          const normalized = transcript.trim();
          if (normalized) {
            return normalized;
          }
          providerError = new Error(
            t("没有识别到语音内容，请重试", "No speech was detected")
          );
        } catch (error) {
          providerError = error;
        }
      }

      const systemTranscript = (await systemTranscriptPromise).trim();
      if (systemTranscript) {
        return systemTranscript;
      }

      if (providerError) {
        throw providerError;
      }

      throw new Error(
        t(
          "当前系统没有可用的语音识别能力，请在设置里配置 STT Provider",
          "No system speech recognition is available. Configure an STT provider in Settings."
        )
      );
    },
    [selectedSttProviderId, t]
  );

  const handleDragEnter = (event: React.DragEvent) => {
    event.preventDefault();
    dragCounterRef.current += 1;
    if (event.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);

    if (!canUseAttachmentPicker) return;

    const files = event.dataTransfer.files;
    if (!files || files.length === 0) return;
    prepareSelectedFiles(files);
  };

  const resetRecordingState = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecordingMode(null);
    setRecordingDuration(0);
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  };

  const ensureSpeechReady = () => {
    if (!hasAnySpeechTranscriptionPath) {
      setComposerError(
        systemSpeechRecognitionSupported
          ? t(
              "当前可用系统语音识别，但还没有独立 STT Provider。你也可以直接使用系统识别。",
              "System speech recognition is available, but no dedicated STT provider is configured. You can still use system recognition directly."
            )
          : t(
              "当前系统没有可用的语音识别能力，请先在设置里配置 STT Provider",
              "No system speech recognition is available. Configure an STT provider first."
            )
      );
      return false;
    }

    if (isStreaming || isOtherStreaming || isTranscribing) {
      return false;
    }

    if (microphoneCapability !== "ready") {
      return false;
    }

    return true;
  };

  const startRecording = async (mode: "voice-message" | "voice-to-text") => {
    clearComposerError();
    if (!ensureSpeechReady()) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      const options: MediaRecorderOptions = mimeType ? { mimeType } : {};
      const mediaRecorder = new MediaRecorder(stream, options);
      recordingMimeTypeRef.current = mimeType;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        const actualMime = recordingMimeTypeRef.current || "audio/webm";
        const recordedChunks = [...chunksRef.current];
        const systemTranscriptPromise = stopSystemSpeechRecognition();
        resetRecordingState();

        if (recordedChunks.length === 0) return;

        setTranscribingMode(mode);

        try {
          const blob = new Blob(recordedChunks, { type: actualMime });
          const base64 = await readFileAsBase64(blob);
          const transcript = await transcribeRecordedAudio(
            base64,
            actualMime,
            systemTranscriptPromise
          );
          const normalizedTranscript = transcript.trim();

          if (!normalizedTranscript) {
            setComposerError(
              t("没有识别到语音内容，请重试", "No speech was detected")
            );
            return;
          }

          if (mode === "voice-to-text") {
            setInput((prev) =>
              prev.trim() ? `${prev.trimEnd()}\n${normalizedTranscript}` : normalizedTranscript
            );
            textareaRef.current?.focus();
            return;
          }

          const audioJson = await api.prepareAudioAttachment(base64, actualMime);
          onSend(normalizedTranscript, [audioJson]);
        } catch (error) {
          console.error("Voice processing failed:", error);
          setComposerError(
            getErrorMessage(
              error,
              mode === "voice-to-text"
                ? t("语音转文字失败，请重试", "Voice-to-text failed")
                : t("语音消息发送失败，请重试", "Voice message failed")
            )
          );
        } finally {
          setTranscribingMode(null);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      if (systemSpeechRecognitionSupported) {
        startSystemSpeechRecognition();
      }
      setRecordingMode(mode);
      setRecordingDuration(0);

      timerRef.current = setInterval(() => {
        setRecordingDuration((seconds) => seconds + 1);
      }, 1000);
    } catch (error) {
      console.error("Microphone access denied:", error);
      handleMicrophoneAccessFailure(error, "recording");
      void stopSystemSpeechRecognition("abort");
      resetRecordingState();
      void refreshMicrophonePermission();
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
  };

  const cancelRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.stream.getTracks().forEach((track) => track.stop());
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    }
    void stopSystemSpeechRecognition("abort");
    resetRecordingState();
  };

  const formatDuration = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;

  const microphoneNotice =
    microphoneCapability === "insecure-context"
      ? t(
          "当前窗口不是安全上下文，录音 API 无法启用",
          "This window is not running in a secure context, so recording APIs are unavailable"
        )
      : microphoneCapability === "missing-get-user-media"
        ? t(
            "当前 WebView 没有提供麦克风 API，这通常不是系统权限问题",
            "This WebView does not expose microphone APIs, so this is not just a system permission issue"
          )
        : microphoneCapability === "missing-media-recorder"
          ? platform === "windows"
            ? t(
                "当前 WebView2 缺少录音编码能力，请先更新 Microsoft Edge WebView2 Runtime",
                "This WebView2 runtime does not expose MediaRecorder. Update Microsoft Edge WebView2 Runtime first"
              )
            : platform === "macos"
              ? t(
                  "当前系统 WebKit 没有提供 MediaRecorder，授权后也无法录音。请先升级 macOS / WebKit",
                  "This system WebKit does not expose MediaRecorder, so permission alone will not enable recording. Update macOS / WebKit first"
                )
              : t(
                  "当前环境缺少录音编码能力，授权后也无法录音",
                  "This environment does not expose MediaRecorder, so permission alone will not enable recording"
                )
          : microphonePermission === "denied"
            ? getMicrophoneSettingsHint()
            : !hasResolvedMicrophonePermission
              ? t(
                  "正在检测麦克风权限...",
                  "Checking microphone access..."
                )
              : microphonePermission === "prompt" || microphonePermission === "unknown"
              ? t(
                  "录音前需要先授权麦克风访问",
                  "Microphone access must be granted before recording"
                )
              : null;
  const attachmentNotice = hasPreparingAttachments
    ? t("正在处理附件，预览已显示，稍后即可发送", "Preparing attachments. Preview is ready and send will unlock shortly")
    : hasFailedAttachments
      ? t("有附件处理失败，请移除失败项后再发送", "Some attachments failed. Remove the failed items before sending")
      : null;
  const sttRouteNotice = hasConfiguredSttProvider
    ? systemSpeechRecognitionSupported
      ? t(
          `语音转写使用 ${selectedSttProvider?.name ?? "STT Provider"} · ${sttModel}，失败时自动回退到系统识别`,
          `Speech-to-text uses ${selectedSttProvider?.name ?? "the STT provider"} · ${sttModel}, with automatic fallback to system recognition on failure`
        )
      : t(
          `语音转写使用 ${selectedSttProvider?.name ?? "STT Provider"} · ${sttModel}`,
          `Speech-to-text uses ${selectedSttProvider?.name ?? "the STT provider"} · ${sttModel}`
        )
    : systemSpeechRecognitionSupported
      ? t(
          "未配置独立 STT Provider，当前直接使用系统识别",
          "No dedicated STT provider is configured. Using system recognition directly"
        )
      : null;

  const helperText = composerError
    ? composerError
    : attachmentNotice
      ? attachmentNotice
    : transcribingMode === "voice-to-text"
      ? t("正在把语音转成文字...", "Transcribing speech to text...")
      : transcribingMode === "voice-message"
        ? t("正在处理语音消息...", "Processing voice message...")
        : microphoneNotice
          ? microphoneNotice
          : !hasAnySpeechTranscriptionPath
          ? t(
              "当前系统没有可用语音识别能力，请在设置里配置独立 STT Provider",
              "No speech recognition is available in this environment. Configure a dedicated STT provider in Settings."
            )
          : sttRouteNotice
            ? sttRouteNotice
          : t("Enter 发送，Shift+Enter 换行，也支持粘贴图片", "Press Enter to send, Shift+Enter for a new line, and paste images directly");

  const utilityButtonClass =
    "flex h-10 w-10 items-center justify-center rounded-2xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

  const renderPrimaryAction = () => {
    if (isStreaming && !isOtherStreaming) {
      return (
        <Button
          type="button"
          onClick={onStop}
          variant="default"
          size="icon"
          className="h-10 w-10 rounded-2xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
          title={t("停止生成", "Stop generation")}
        >
          <Square className="h-4 w-4 fill-current" />
        </Button>
      );
    }

    if (isOtherStreaming || isTranscribing || hasPreparingAttachments) {
      return (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          disabled
          className="h-10 w-10 rounded-2xl"
          title={
            hasPreparingAttachments
              ? t("正在处理附件", "Preparing attachments")
              : t("处理中...", "Working...")
          }
        >
          <Loader2 className="h-4 w-4 animate-spin" />
        </Button>
      );
    }

    if (canSend) {
      return (
        <Button
          type="button"
          onClick={handleSend}
          size="icon"
          className="h-10 w-10 rounded-2xl"
          title={t("发送消息", "Send message")}
        >
          <Send className="h-4 w-4" />
        </Button>
      );
    }

    return (
      <Button
        type="button"
        onClick={() => startRecording("voice-message")}
        size="icon"
        disabled={!canUseVoiceMessageAction}
        className="h-10 w-10 rounded-2xl"
        title={t("发送语音消息", "Send voice message")}
      >
        <Mic className="h-4 w-4" />
      </Button>
    );
  };

  return (
    <div
      className="relative border-t border-border/70 bg-background/95 px-4 py-4 backdrop-blur"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 backdrop-blur-[2px]">
          <Upload className="mb-2 h-7 w-7 text-primary/60" />
          <p className="text-sm font-medium text-primary/70">
            {t("拖放图片或文件到这里", "Drop images or files here")}
          </p>
        </div>
      ) : null}

      <div className="mx-auto max-w-3xl">
        <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-sm">
          {composerAttachments.length > 0 ? (
            <div className="flex flex-wrap gap-2 border-b border-border/60 px-3 py-3">
              {composerAttachments.map((attachment) => (
                <div
                  key={attachment.clientId}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-2xl border bg-background/90 px-2.5 py-2 pr-8 transition-colors",
                    attachment.status === "error"
                      ? "border-destructive/40"
                      : "border-border/70"
                  )}
                >
                  {attachment.fileType === "image" ? (
                    attachment.previewUrl ? (
                      <div className="relative">
                        <img
                          src={attachment.previewUrl}
                          alt={attachment.fileName}
                          className="h-11 w-11 rounded-xl object-cover"
                        />
                        {attachment.status === "preparing" ? (
                          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/16">
                            <Loader2 className="h-4 w-4 animate-spin text-white" />
                          </div>
                        ) : null}
                        {attachment.status === "error" ? (
                          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-destructive/18">
                            <AlertCircle className="h-4 w-4 text-destructive" />
                          </div>
                        ) : null}
                      </div>
                    ) : attachment.prepared ? (
                      <AttachmentImage
                        filePath={attachment.prepared.file_path}
                        alt={attachment.fileName}
                        className="h-11 w-11 rounded-xl object-cover"
                        fallbackClassName="h-11 w-11 rounded-xl"
                      />
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    )
                  ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      {attachment.status === "preparing" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : attachment.status === "error" ? (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      ) : (
                        <Paperclip className="h-4 w-4" />
                      )}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="max-w-[160px] truncate text-sm font-medium text-foreground">
                      {attachment.fileName}
                    </p>
                    <p
                      className={cn(
                        "text-xs",
                        attachment.status === "error"
                          ? "text-destructive"
                          : "text-muted-foreground"
                      )}
                    >
                      {attachment.status === "preparing"
                        ? t("处理中...", "Preparing...")
                        : attachment.status === "error"
                          ? attachment.error ?? t("处理失败", "Failed")
                          : formatFileSize(attachment.fileSize)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePendingAttachment(attachment.clientId)}
                    className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title={t("移除附件", "Remove attachment")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {isRecording ? (
            <div
              className={cn(
                "flex items-center gap-3 px-4 py-4",
                recordingMode === "voice-message"
                  ? "bg-destructive/5"
                  : "bg-primary/5"
              )}
            >
              <button
                type="button"
                onClick={cancelRecording}
                className="flex h-10 w-10 items-center justify-center rounded-2xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title={t("取消录音", "Cancel recording")}
              >
                <X className="h-4 w-4" />
              </button>

              <div
                className={cn(
                  "h-2.5 w-2.5 shrink-0 rounded-full animate-pulse",
                  recordingMode === "voice-message" ? "bg-destructive" : "bg-primary"
                )}
              />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm tabular-nums text-foreground">
                    {formatDuration(recordingDuration)}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">
                    {recordingMode === "voice-message"
                      ? t("录音中，完成后发送语音消息", "Recording, stop to send voice message")
                      : t("录音中，完成后转成文字", "Recording, stop to convert to text")}
                  </span>
                </div>
                <div className="mt-2 flex items-end gap-1">
                  {[10, 20, 14, 24, 12, 18, 26, 16].map((height, index) => (
                    <div
                      key={height}
                      className={cn(
                        "w-1 rounded-full animate-pulse",
                        recordingMode === "voice-message"
                          ? "bg-destructive/50"
                          : "bg-primary/50"
                      )}
                      style={{
                        height,
                        animationDelay: `${index * 0.08}s`,
                      }}
                    />
                  ))}
                </div>
              </div>

              <Button
                type="button"
                onClick={stopRecording}
                size="icon"
                className={cn(
                  "h-10 w-10 rounded-2xl",
                  recordingMode === "voice-message"
                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    : ""
                )}
                title={t("结束录音", "Finish recording")}
              >
                <Square className="h-4 w-4 fill-current" />
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-end gap-2 p-2">
                <div className="flex items-center gap-1 self-end pb-0.5">
                  <button
                    type="button"
                    onClick={() => startRecording("voice-to-text")}
                    disabled={!canUseVoiceToTextAction}
                    className={utilityButtonClass}
                    title={t("语音转文字", "Voice to text")}
                  >
                    <AudioLines className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!canUseAttachmentPicker}
                    className={utilityButtonClass}
                    title={t("添加附件", "Add attachment")}
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.md,.txt,.log,.csv,.tsv,.json,.yaml,.yml,.toml,.xml,.py,.rs,.js,.ts,.tsx,.jsx,.go,.java,.c,.cpp,.h,.hpp,.sh,.html,.css,.scss,.sql"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <Textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(event) => {
                      clearComposerError();
                      setInput(event.target.value);
                    }}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder={
                      isOtherStreaming
                        ? t(
                            "其他会话生成中，请稍候...",
                            "Another session is generating, please wait..."
                          )
                        : t("输入消息...", "Type a message...")
                    }
                    disabled={isOtherStreaming}
                    rows={1}
                    className="min-h-[48px] max-h-40 resize-none border-0 bg-transparent px-3 py-3 leading-6 shadow-none focus-visible:ring-0"
                  />
                </div>

                <div className="flex items-center gap-1 self-end pb-0.5">
                  {renderPrimaryAction()}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-xs leading-5 break-words",
                      composerError ? "text-destructive" : "text-muted-foreground"
                    )}
                  >
                  {helperText}
                  </p>
                  {microphoneCapability === "ready" &&
                  hasResolvedMicrophonePermission &&
                  (microphonePermission === "prompt" ||
                    microphonePermission === "unknown" ||
                    microphonePermission === "denied") ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {(microphonePermission === "prompt" ||
                        microphonePermission === "unknown") && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={isResolvingMicrophonePermission}
                          onClick={() => {
                            void requestMicrophonePermission();
                          }}
                          className="h-7 rounded-full px-3 text-xs"
                        >
                          {isResolvingMicrophonePermission ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              {t("请求授权中...", "Requesting permission...")}
                            </>
                          ) : (
                            t("启用麦克风", "Enable microphone")
                          )}
                        </Button>
                      )}
                      {microphonePermission === "denied" &&
                      (platform === "macos" || platform === "windows") ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void openMicrophoneSettings();
                          }}
                          className="h-7 rounded-full px-3 text-xs"
                        >
                          {platform === "macos"
                            ? t("打开系统设置", "Open System Settings")
                            : t("打开 Windows 设置", "Open Windows Settings")}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void refreshMicrophonePermission();
                        }}
                        className="h-7 rounded-full px-2.5 text-xs text-muted-foreground"
                      >
                        {t("重新检测", "Refresh")}
                      </Button>
                    </div>
                  ) : null}
                  {microphoneCapability === "ready" &&
                  hasResolvedMicrophonePermission &&
                  microphonePermission === "denied" ? (
                    <div className="mt-2 space-y-1">
                      {didAttemptOpenMicrophoneSettings ? (
                        <p className="text-[11px] leading-5 text-muted-foreground">
                          {getOpenedMicrophoneSettingsHint()}
                        </p>
                      ) : null}
                      <p className="text-[11px] leading-5 text-muted-foreground">
                        {getMicrophoneSettingsSteps()}
                      </p>
                    </div>
                  ) : null}
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {composerAttachments.length > 0
                    ? t(
                        `${readyAttachments.length}/${composerAttachments.length} 个附件已就绪`,
                        `${readyAttachments.length}/${composerAttachments.length} attachment(s) ready`
                      )
                    : `${input.trim().length} ${t("字符", "chars")}`}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
