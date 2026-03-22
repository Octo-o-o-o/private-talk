import { useCallback, useRef, useState } from "react";
import {
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
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { useAppStore } from "../../stores/appStore";
import * as api from "../../lib/tauri";
import type { PreparedAttachment } from "../../lib/types";
import { convertFileSrc } from "@tauri-apps/api/core";

interface Props {
  onSend: (content: string, attachmentJsons?: string[]) => void;
  onStop: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatInput({ onSend, onStop }: Props) {
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    PreparedAttachment[]
  >([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMode, setRecordingMode] = useState<
    "voice-message" | "voice-to-text" | null
  >(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isStreaming = useAppStore((s) => s.isStreaming);
  const streamingConversationId = useAppStore((s) => s.streamingConversationId);
  const currentConversationId = useAppStore((s) => s.currentConversationId);
  const selectedProviderId = useAppStore((s) => s.selectedProviderId);
  const { t } = useI18n();

  const isOtherStreaming =
    isStreaming &&
    streamingConversationId !== null &&
    streamingConversationId !== currentConversationId;

  const canSend =
    (input.trim() || pendingAttachments.length > 0) &&
    !isStreaming &&
    !isOtherStreaming;

  // ── Send ──
  const handleSend = useCallback(() => {
    if (!canSend) return;
    const attachmentJsons = pendingAttachments.map((a) => JSON.stringify(a));
    onSend(input.trim(), attachmentJsons.length > 0 ? attachmentJsons : undefined);
    setInput("");
    setPendingAttachments([]);
  }, [canSend, input, pendingAttachments, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── File attachment ──
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      // Tauri file input provides the full path via webkitRelativePath or name
      // We use the Tauri dialog approach instead — but for <input type="file">,
      // the path is available on the File object in Tauri v2
      const file = files[i];
      // In Tauri v2, File objects from input have a `path` property
      const filePath = (file as unknown as { path?: string }).path;
      if (filePath) {
        paths.push(filePath);
      }
    }

    if (paths.length > 0) {
      try {
        const results = await api.prepareAttachments(paths);
        const prepared = results.map(
          (json) => JSON.parse(json) as PreparedAttachment
        );
        setPendingAttachments((prev) => [...prev, ...prepared]);
      } catch (err) {
        console.error("Failed to prepare attachments:", err);
      }
    }

    // Reset the file input
    e.target.value = "";
  };

  // ── Paste image ──
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;

        const reader = new FileReader();
        reader.onloadend = async () => {
          const dataUrl = reader.result as string;
          const b64 = dataUrl.split(",")[1] || "";
          try {
            const json = await api.prepareImageAttachment(b64, item.type);
            const prepared = JSON.parse(json) as PreparedAttachment;
            setPendingAttachments((prev) => [...prev, prepared]);
          } catch (err) {
            console.error("Failed to prepare pasted image:", err);
          }
        };
        reader.readAsDataURL(blob);
        break;
      }
    }
  };

  const removePendingAttachment = (id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  // ── Drag-and-drop ──
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = (file as unknown as { path?: string }).path;
      if (filePath) {
        paths.push(filePath);
      }
    }

    if (paths.length > 0) {
      try {
        const results = await api.prepareAttachments(paths);
        const prepared = results.map(
          (json) => JSON.parse(json) as PreparedAttachment
        );
        setPendingAttachments((prev) => [...prev, ...prepared]);
      } catch (err) {
        console.error("Failed to prepare dropped attachments:", err);
      }
    }
  };

  // ── Recording ──
  const startRecording = async (mode: "voice-message" | "voice-to-text") => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setIsRecording(false);
        setRecordingMode(null);
        setRecordingDuration(0);

        if (chunksRef.current.length === 0) return;

        if (!selectedProviderId) {
          console.error("No provider selected for STT");
          return;
        }

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result as string;
            resolve(dataUrl.split(",")[1] || "");
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        if (mode === "voice-to-text") {
          // Mode A: STT → fill input
          setIsTranscribing(true);
          try {
            const text = await api.sttTranscribe(base64, selectedProviderId);
            if (text.trim()) {
              setInput((prev) => (prev ? prev + " " + text.trim() : text.trim()));
              inputRef.current?.focus();
            }
          } catch (err) {
            console.error("STT failed:", err);
          } finally {
            setIsTranscribing(false);
          }
        } else {
          // Mode B: voice message — STT then send as text
          // (For now, same as voice-to-text but auto-sends)
          setIsTranscribing(true);
          try {
            const text = await api.sttTranscribe(base64, selectedProviderId);
            if (text.trim()) {
              onSend(text.trim());
            }
          } catch (err) {
            console.error("Voice message STT failed:", err);
          } finally {
            setIsTranscribing(false);
          }
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingMode(mode);
      setRecordingDuration(0);

      timerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access denied:", err);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = () => {
        // Clean up stream
        mediaRecorderRef.current = null;
      };
      chunksRef.current = [];
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
    setRecordingMode(null);
    setRecordingDuration(0);
  };

  const formatDuration = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  // ── Render ──
  return (
    <div
      className="relative border-t border-border p-4"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 backdrop-blur-[2px]">
          <Upload size={28} className="mb-1.5 text-primary/60" />
          <p className="text-sm font-medium text-primary/60">
            {t("拖放图片或文件到这里", "Drop images or files here")}
          </p>
        </div>
      )}
      <div className="mx-auto max-w-3xl">
        {/* Attachment preview bar */}
        {pendingAttachments.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto px-1 py-1">
            {pendingAttachments.map((att) => (
              <div
                key={att.id}
                className="group relative flex h-14 min-w-14 items-center gap-2 rounded-lg border border-border bg-card px-2"
              >
                {att.file_type === "image" ? (
                  <img
                    src={convertFileSrc(att.file_path)}
                    alt={att.file_name}
                    className="h-10 w-10 rounded object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-muted-foreground">
                    <Paperclip size={14} />
                  </div>
                )}
                <div className="max-w-[120px]">
                  <p className="truncate text-xs font-medium">{att.file_name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatFileSize(att.file_size)}
                  </p>
                </div>
                <button
                  onClick={() => removePendingAttachment(att.id)}
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-foreground/80 text-background opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Recording bar or input bar */}
        {isRecording ? (
          <div
            className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
              recordingMode === "voice-message"
                ? "border-destructive/30 bg-destructive/5"
                : "border-primary/30 bg-primary/5"
            }`}
          >
            {/* Cancel */}
            <button
              onClick={cancelRecording}
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X size={16} />
            </button>

            {/* Recording indicator */}
            <div
              className={`h-2 w-2 shrink-0 rounded-full animate-pulse ${
                recordingMode === "voice-message"
                  ? "bg-destructive"
                  : "bg-primary"
              }`}
            />
            <span className="font-mono text-sm tabular-nums text-foreground">
              {formatDuration(recordingDuration)}
            </span>
            <span className="text-xs text-muted-foreground">
              {recordingMode === "voice-message"
                ? t("录音中，点击发送", "Recording, click to send")
                : t("录音中，点击转为文字", "Recording, click to convert")}
            </span>

            {/* Wave visualization */}
            <div className="flex flex-1 items-center justify-center gap-0.5">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={`w-0.5 rounded-full ${
                    recordingMode === "voice-message"
                      ? "bg-destructive/50"
                      : "bg-primary/50"
                  }`}
                  style={{
                    height: `${8 + Math.sin(Date.now() / 200 + i) * 8}px`,
                    animation: `pulse 0.8s ease-in-out ${i * 0.1}s infinite alternate`,
                  }}
                />
              ))}
            </div>

            {/* Stop/Send */}
            <button
              onClick={stopRecording}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                recordingMode === "voice-message"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              }`}
            >
              <Square size={14} fill="currentColor" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {/* Left: Voice-to-text */}
            {isTranscribing ? (
              <button
                disabled
                className="shrink-0 rounded-md p-2 text-muted-foreground"
                title={t("转写中...", "Transcribing...")}
              >
                <Loader2 size={16} className="animate-spin" />
              </button>
            ) : (
              <button
                onClick={() => startRecording("voice-to-text")}
                className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title={t("语音转文字", "Voice to text")}
              >
                <AudioLines size={16} />
              </button>
            )}

            {/* Left: Attachment */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title={t("添加附件", "Add attachment")}
            >
              <Paperclip size={16} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.md,.txt,.log,.csv,.tsv,.json,.yaml,.yml,.toml,.xml,.py,.rs,.js,.ts,.tsx,.jsx,.go,.java,.c,.cpp,.h,.hpp,.sh,.html,.css,.scss,.sql"
              onChange={handleFileSelect}
              className="hidden"
            />

            {/* Center: Text input + Send/Stop */}
            <div className="relative flex-1">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
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
                className="border-border bg-input pr-12"
              />
              {isStreaming && !isOtherStreaming ? (
                <Button
                  type="button"
                  onClick={onStop}
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-destructive hover:text-destructive"
                  title={t("停止生成", "Stop generation")}
                >
                  <Square className="h-4 w-4 fill-current" />
                </Button>
              ) : isOtherStreaming ? (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              ) : (
                <Button
                  type="button"
                  onClick={handleSend}
                  disabled={!canSend}
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                  title={t("发送消息", "Send message")}
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Right: Voice message */}
            <button
              onClick={() => startRecording("voice-message")}
              className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title={t("发送语音消息", "Send voice message")}
            >
              <Mic size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
