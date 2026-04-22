import { ArrowUp, FileUp, ImageIcon, Loader2, Mic, Sparkles, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { getProvidersForPurpose } from "../../lib/providerModels";
import * as api from "../../lib/tauri";
import type { AttachmentUpload } from "../../lib/types";
import { useAppStore } from "../../stores/appStore";
import type { LayoutMode } from "../layout/useLayoutMode";

export type ChatInputMode = "chat" | "image";

export interface ChatInputReferenceImage {
  name: string;
  mimeType: string;
  base64: string;
}

export interface ChatInputSubmission {
  content: string;
  mode: ChatInputMode;
  referenceImage: ChatInputReferenceImage | null;
  attachments: AttachmentUpload[];
}

interface ChatInputProps {
  layout: LayoutMode;
  onSend: (submission: ChatInputSubmission) => void;
  onStop: () => void;
  isBusy?: boolean;
  showStop?: boolean;
  canSendOverride?: boolean;
  imageEnabled?: boolean;
}

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function resizeTextarea(element: HTMLTextAreaElement | null): void {
  if (!element) {
    return;
  }

  element.style.height = "0px";
  element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unable to read audio data."));
        return;
      }
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read audio data."));
    reader.readAsDataURL(blob);
  });
}

function pickRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];

  return candidates.find((value) => MediaRecorder.isTypeSupported(value)) ?? "";
}

export function ChatInput({
  layout,
  onSend,
  onStop,
  isBusy = false,
  showStop,
  canSendOverride,
  imageEnabled = false,
}: ChatInputProps) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ChatInputMode>("chat");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [referenceImage, setReferenceImage] = useState<ChatInputReferenceImage | null>(null);
  const [attachments, setAttachments] = useState<AttachmentUpload[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isStreaming = useAppStore((s) => s.isStreaming);
  const selectedProviderId = useAppStore((s) => s.selectedProviderId);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const providers = useAppStore((s) => s.providers);
  const providerModelRegistry = useAppStore((s) => s.providerModelRegistry);
  const currentConversationId = useAppStore((s) => s.currentConversationId);
  const sttProviderId = useAppStore((s) => s.sttProviderId);

  const trimmed = input.trim();
  const canSend =
    canSendOverride ?? (mode === "image" ? true : !!selectedProviderId && !!selectedModel);
  const transcriptionProviderId = sttProviderId ?? selectedProviderId;
  const shouldShowStop = showStop ?? isStreaming;
  const busy = isBusy || isStreaming;
  const hasAttachments = attachments.length > 0;
  const hasSendPayload = !!trimmed || hasAttachments || !!referenceImage;
  const hasTextProviders =
    getProvidersForPurpose(providers, providerModelRegistry, "chat").length > 0;
  const sendDisabled =
    !shouldShowStop && (!hasSendPayload || !canSend || isRecording || isTranscribing || busy);
  const placeholder = mode === "image"
    ? t(
        "描述你想生成的图片，也可以继续写 --ratio / --quality / --count / --bg",
        "Describe the image you want, or keep using --ratio / --quality / --count / --bg flags",
      )
    : !canSend
      ? hasTextProviders
        ? t("先选择一个文本模型，再开始聊天", "Choose a text model before chatting")
        : t(
            "先去设置里的“模型与服务商”配置一个文本模型，再开始聊天",
            "Configure a text model in Settings > Models & Providers before chatting",
          )
      : currentConversationId
        ? t("给 Private Talk 发消息", "Message Private Talk")
        : t("开始一个新对话", "Start a new conversation");
  const imageToggleLabel = imageEnabled
    ? mode === "image"
      ? t("切回聊天模式", "Switch to chat mode")
      : t("切到图片模式", "Switch to image mode")
    : t("先在设置里启用图片生成", "Enable image generation in Settings first");
  const recordingAvailable =
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined";

  function send(): void {
    if (!hasSendPayload || busy || !canSend) {
      return;
    }

    onSend({
      content: trimmed,
      mode,
      referenceImage,
      attachments,
    });
    setInput("");
    setAttachments([]);
    resizeTextarea(textareaRef.current);
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!imageEnabled && mode === "image") {
      setMode("chat");
      setReferenceImage(null);
    }
  }, [imageEnabled, mode]);

  useEffect(() => {
    if (mode === "image" && attachments.length > 0) {
      setAttachments([]);
    }
  }, [attachments.length, mode]);

  async function handleReferenceImageChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setTranscriptionError(
        t("参考图必须是图片文件。", "Reference input must be an image file."),
      );
      return;
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      setTranscriptionError(
        t("参考图不能超过 20 MB。", "Reference image must be 20 MB or smaller."),
      );
      return;
    }

    try {
      const base64 = await blobToBase64(file);
      setReferenceImage({
        name: file.name,
        mimeType: file.type || "image/png",
        base64,
      });
      setMode("image");
      setTranscriptionError(null);
    } catch (error) {
      setTranscriptionError(
        error instanceof Error
          ? error.message
          : t("读取参考图失败。", "Failed to read the reference image."),
      );
    }
  }

  async function handleAttachmentChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    const acceptedFiles = files.filter((file) => file.size <= MAX_ATTACHMENT_BYTES);
    const oversizedCount = files.length - acceptedFiles.length;

    if (acceptedFiles.length === 0) {
      setTranscriptionError(
        t("附件不能超过 20 MB。", "Attachments must be 20 MB or smaller."),
      );
      return;
    }

    try {
      const nextAttachments = await Promise.all(
        acceptedFiles.map(async (file) => ({
          file_name: file.name,
          mime_type: file.type || "application/octet-stream",
          data_base64: await blobToBase64(file),
        })),
      );
      setAttachments((current) => {
        const deduped = new Map<string, AttachmentUpload>();
        for (const item of [...current, ...nextAttachments]) {
          deduped.set(`${item.file_name}:${item.mime_type}:${item.data_base64.length}`, item);
        }
        return Array.from(deduped.values());
      });
      setTranscriptionError(
        oversizedCount > 0
          ? t(
              `已跳过 ${oversizedCount} 个超过 20 MB 的附件。`,
              `Skipped ${oversizedCount} attachment(s) over 20 MB.`,
            )
          : null,
      );
    } catch (error) {
      setTranscriptionError(
        error instanceof Error
          ? error.message
          : t("读取附件失败。", "Failed to read attachment."),
      );
    }
  }

  async function transcribeBlob(blob: Blob, mimeType: string, providerId: string): Promise<void> {
    setIsTranscribing(true);
    setTranscriptionError(null);

    try {
      const audioBase64 = await blobToBase64(blob);
      const transcript = await api.sttTranscribe(audioBase64, providerId, mimeType);
      const cleaned = transcript.trim();

      if (!cleaned) {
        setTranscriptionError(t("没有识别到可用语音内容。", "No usable speech was transcribed."));
        return;
      }

      setInput((current) => {
        const nextValue = current.trim() ? `${current.trimEnd()}\n${cleaned}` : cleaned;
        window.requestAnimationFrame(() => resizeTextarea(textareaRef.current));
        return nextValue;
      });
      textareaRef.current?.focus();
    } catch (error) {
      setTranscriptionError(
        error instanceof Error
          ? error.message
          : t("语音转写失败。", "Speech transcription failed."),
      );
    } finally {
      setIsTranscribing(false);
    }
  }

  async function startRecording(): Promise<void> {
    if (!transcriptionProviderId) {
      setTranscriptionError(
        t("先在设置里配置一个聊天或转写服务商。", "Configure a chat or transcription provider first."),
      );
      return;
    }

    if (!recordingAvailable) {
      setTranscriptionError(
        t("当前环境不支持浏览器录音。", "This environment does not support browser recording."),
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      recorderRef.current = recorder;
      recorderStreamRef.current = stream;
      setTranscriptionError(null);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const nextMimeType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: nextMimeType });
        recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
        recorderStreamRef.current = null;
        recorderRef.current = null;
        setIsRecording(false);

        if (blob.size > 0) {
          void transcribeBlob(blob, nextMimeType, transcriptionProviderId);
        }
      };

      recorder.start();
      setIsRecording(true);
    } catch (error) {
      setTranscriptionError(
        error instanceof Error
          ? error.message
          : t("无法访问麦克风。", "Unable to access the microphone."),
      );
    }
  }

  function toggleImageMode(): void {
    if (!imageEnabled || busy) {
      return;
    }

    setMode((current) => {
      const next = current === "image" ? "chat" : "image";
      if (next === "chat") {
        setReferenceImage(null);
      } else {
        setAttachments([]);
      }
      return next;
    });
  }

  function stopRecording(): void {
    recorderRef.current?.stop();
  }

  const composeNotice = transcriptionError
    ? transcriptionError
    : isRecording
      ? t("正在录音，点击麦克风结束并转写。", "Recording... tap the microphone again to stop and transcribe.")
      : isTranscribing
        ? t("正在转写语音...", "Transcribing audio...")
        : null;

  return (
    <div className={`pt-compose pt-compose--${layout}`}>
      <div className="pt-compose__inner">
        {mode === "image" || referenceImage || attachments.length > 0 ? (
          <div className="pt-compose__meta">
            {mode === "image" || referenceImage ? (
              <div className="pt-compose__pill pt-compose__pill--mode">
                <Sparkles size={13} />
                <span>{t("图片模式", "Image mode")}</span>
              </div>
            ) : null}

            {referenceImage ? (
              <div className="pt-compose__pill">
                <ImageIcon size={13} />
                <span>{referenceImage.name}</span>
                <button
                  type="button"
                  className="pt-compose__pill-remove"
                  onClick={() => setReferenceImage(null)}
                  aria-label={t("移除参考图", "Remove reference image")}
                >
                  <X size={12} />
                </button>
              </div>
            ) : null}

            {mode === "chat"
              ? attachments.map((attachment) => (
                  <div key={`${attachment.file_name}:${attachment.data_base64.length}`} className="pt-compose__pill">
                    <FileUp size={13} />
                    <span>{attachment.file_name}</span>
                    <button
                      type="button"
                      className="pt-compose__pill-remove"
                      onClick={() =>
                        setAttachments((current) =>
                          current.filter((item) => item !== attachment),
                        )
                      }
                      aria-label={t("移除附件", "Remove attachment")}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))
              : null}
          </div>
        ) : null}

        <div className="pt-compose__field">
          <button
            type="button"
            className={`pt-compose__tool${mode === "image" ? " is-active" : ""}`}
            onClick={toggleImageMode}
            disabled={busy || !imageEnabled}
            aria-label={imageToggleLabel}
            title={imageToggleLabel}
          >
            <Sparkles size={16} />
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            rows={1}
            placeholder={placeholder}
            className="pt-compose__textarea"
            onChange={(event) => {
              setInput(event.target.value);
              resizeTextarea(event.target);
            }}
            onKeyDown={handleKeyDown}
          />

          {mode === "image" ? (
            <button
              type="button"
              className={`pt-compose__tool${referenceImage ? " is-active" : ""}`}
              onClick={() => imageFileInputRef.current?.click()}
              disabled={busy || isRecording || isTranscribing}
              aria-label={t("添加参考图", "Add reference image")}
              title={t("添加参考图", "Add reference image")}
            >
              <ImageIcon size={16} />
            </button>
          ) : (
            <button
              type="button"
              className={`pt-compose__tool${attachments.length > 0 ? " is-active" : ""}`}
              onClick={() => attachmentInputRef.current?.click()}
              disabled={busy || isRecording || isTranscribing}
              aria-label={t("添加附件", "Add attachments")}
              title={t("添加附件", "Add attachments")}
            >
              <FileUp size={16} />
            </button>
          )}

          <button
            type="button"
            className={`pt-compose__tool${isRecording ? " is-active" : ""}`}
            onClick={isRecording ? stopRecording : () => void startRecording()}
            disabled={isTranscribing || busy}
            aria-label={
              isRecording
                ? t("结束录音", "Stop recording")
                : t("录音转文字", "Record voice to text")
            }
            title={
              isRecording
                ? t("结束录音", "Stop recording")
                : t("录音转文字", "Record voice to text")
            }
          >
            {isTranscribing ? (
              <Loader2 size={16} className="pt-spinner" />
            ) : (
              <Mic size={16} />
            )}
          </button>

          <button
            type="button"
            className={`pt-compose__send${
              sendDisabled ? " is-disabled" : ""
            }${shouldShowStop ? " is-stop" : ""}`}
            onClick={shouldShowStop ? onStop : send}
            disabled={sendDisabled}
            aria-label={shouldShowStop ? t("停止生成", "Stop generation") : t("发送消息", "Send message")}
            title={shouldShowStop ? t("停止生成", "Stop generation") : t("发送消息", "Send message")}
          >
            {shouldShowStop ? (
              <Square size={13} fill="currentColor" />
            ) : (
              <ArrowUp size={16} strokeWidth={2.8} />
            )}
          </button>
        </div>

        <input
          ref={imageFileInputRef}
          type="file"
          accept="image/*"
          className="pt-compose__file-input"
          onChange={(event) => {
            void handleReferenceImageChange(event);
          }}
        />
        <input
          ref={attachmentInputRef}
          type="file"
          multiple
          className="pt-compose__file-input"
          onChange={(event) => {
            void handleAttachmentChange(event);
          }}
        />

        {composeNotice ? (
          <p className={`pt-compose__notice${transcriptionError ? " is-error" : ""}`}>
            {composeNotice}
          </p>
        ) : null}
      </div>
    </div>
  );
}
