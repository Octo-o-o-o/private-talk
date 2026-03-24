import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  User,
  Bot,
  Copy,
  Check,
  Pin,
  PinOff,
  Pencil,
  RefreshCw,
  Trash2,
  FileText,
  X,
} from "lucide-react";
import { lazy, Suspense, useState, useRef, useEffect, useMemo, useCallback } from "react";

const CodeBlock = lazy(() => import("./CodeBlock").then(m => ({ default: m.CodeBlock })));
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useTts, TtsPlaybackBar, TtsTriggerButton } from "../audio/TtsPlayButton";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Attachment } from "../../lib/types";
import * as api from "../../lib/tauri";
import { AttachmentImage } from "./AttachmentImage";
import { VoiceBubble } from "./VoiceBubble";

interface Props {
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
  showTts?: boolean;
  assistantId?: string | null;
  messageId?: string;
  isPinned?: boolean;
  attachments?: Attachment[];
  onRetry?: (messageId: string, role: "user" | "assistant") => void;
  onDelete?: (messageId: string) => void;
  onEditSubmit?: (messageId: string, newContent: string) => void;
}

export function MessageItem({
  role,
  content,
  isStreaming,
  showTts,
  assistantId,
  messageId,
  isPinned,
  attachments,
  onRetry,
  onDelete,
  onEditSubmit,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [pinned, setPinned] = useState(isPinned ?? false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const { t } = useI18n();

  const tts = useTts({
    messageContent: content,
    assistantId: assistantId ?? undefined,
    voiceId: undefined,
  });

  const imageAttachments = useMemo(
    () => (attachments ?? []).filter((a) => a.file_type === "image"),
    [attachments]
  );
  const fileAttachments = useMemo(
    () => (attachments ?? []).filter((a) => a.file_type === "text_file"),
    [attachments]
  );
  const audioAttachments = useMemo(
    () => (attachments ?? []).filter((a) => a.file_type === "audio"),
    [attachments]
  );

  const closeLightbox = useCallback(() => setLightboxSrc(null), []);

  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus();
      editRef.current.setSelectionRange(editContent.length, editContent.length);
    }
  }, [isEditing]);

  const handleTogglePin = async () => {
    if (!messageId) return;
    try {
      const newState = await api.togglePinMessage(messageId);
      setPinned(newState);
    } catch (e) {
      console.error("Toggle pin failed:", e);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEditSave = () => {
    if (!messageId || !editContent.trim()) return;
    onEditSubmit?.(messageId, editContent.trim());
    setIsEditing(false);
  };

  const handleEditCancel = () => {
    setEditContent(content);
    setIsEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleEditSave();
    }
    if (e.key === "Escape") {
      handleEditCancel();
    }
  };

  const isUser = role === "user";
  const hasActions = messageId && !isStreaming;

  const actionBtnClass =
    "rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

  // Memoize markdown components to avoid re-creating on every chunk render
  const markdownComponents: Components = useMemo(
    () => ({
      code({ className, children, ...props }) {
        const match = /language-(\w+)/.exec(className || "");
        const codeStr = String(children).replace(/\n$/, "");
        if (match) {
          return (
            <Suspense
              fallback={
                <pre className="my-3 overflow-auto rounded-lg border border-border bg-[#101727] p-3 font-mono text-[0.78rem] text-foreground">
                  <code>{codeStr}</code>
                </pre>
              }
            >
              <CodeBlock language={match[1]} code={codeStr} />
            </Suspense>
          );
        }
        return (
          <code
            className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.8em]"
            {...props}
          >
            {children}
          </code>
        );
      },
      p({ children }) {
        return <p className="mb-2.5 last:mb-0">{children}</p>;
      },
      ul({ children }) {
        return <ul className="mb-2.5 ml-4 list-disc">{children}</ul>;
      },
      ol({ children }) {
        return <ol className="mb-2.5 ml-4 list-decimal">{children}</ol>;
      },
      blockquote({ children }) {
        return (
          <blockquote className="my-2.5 border-l-2 border-primary/40 pl-3 italic text-muted-foreground">
            {children}
          </blockquote>
        );
      },
      a({ href, children }) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {children}
          </a>
        );
      },
    }),
    []
  );

  return (
    <div className={cn("group flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={cn("flex max-w-[80%] flex-col", isUser && "items-end")}
      >
        {/* Message bubble or edit mode */}
        {isEditing ? (
          <div className="w-full min-w-[280px]">
            <textarea
              ref={editRef}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleEditKeyDown}
              className="w-full resize-none rounded-2xl rounded-tr-md border border-primary/40 bg-primary/5 px-4 py-3 text-sm leading-relaxed text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              rows={Math.max(2, editContent.split("\n").length)}
            />
            <div className="mt-1.5 flex items-center justify-end gap-2">
              <span className="mr-auto text-[11px] text-muted-foreground">
                Esc {t("取消", "cancel")} · Enter {t("保存", "save")}
              </span>
              <button
                onClick={handleEditCancel}
                className="rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {t("取消", "Cancel")}
              </button>
              <button
                onClick={handleEditSave}
                className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {t("保存并发送", "Save & Send")}
              </button>
            </div>
          </div>
        ) : (
          <>
          <div className={cn("flex gap-2", isUser && "flex-row-reverse")}>
            <div
              className={cn(
                "rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs",
                isUser
                  ? "rounded-tr-md bg-primary text-primary-foreground"
                  : "rounded-tl-md border border-border bg-card",
                pinned && !isUser && "ring-1 ring-primary/40"
              )}
            >
              {/* Image attachments */}
              {imageAttachments.length > 0 && (() => {
                const generatedImages = imageAttachments.filter(
                  (a) => (a.metadata as Record<string, unknown> | undefined)?.source === "generated"
                );
                const useGrid = generatedImages.length >= 2;
                return (
                  <div className={cn(
                    useGrid ? "grid grid-cols-2 gap-1.5" : "flex flex-wrap gap-1.5",
                    content && "mb-2"
                  )}>
                    {imageAttachments.map((att) => {
                      const src = convertFileSrc(att.file_path);
                      const isGenerated = (att.metadata as Record<string, unknown> | undefined)?.source === "generated";
                      return (
                        <button
                          key={att.id}
                          onClick={() => setLightboxSrc(src)}
                          className="relative overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                        >
                          <AttachmentImage
                            filePath={att.file_path}
                            alt={att.file_name}
                            className="max-h-48 max-w-[220px] rounded-lg object-cover transition-opacity hover:opacity-90"
                            fallbackClassName="flex h-24 w-24"
                            loading="lazy"
                          />
                          {isGenerated && (
                            <span className="absolute top-1 right-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white">
                              AI
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
              {/* Audio attachments */}
              {audioAttachments.length > 0 && (
                <div className={cn("flex flex-col gap-2", content && "mb-2")}>
                  {audioAttachments.map((att) => (
                    <VoiceBubble
                      key={att.id}
                      attachment={att}
                      transcript={content || undefined}
                      isUser={isUser}
                    />
                  ))}
                </div>
              )}
              {/* File attachments */}
              {fileAttachments.length > 0 && (
                <div className={cn("flex flex-col gap-1", content && "mb-2")}>
                  {fileAttachments.map((att) => (
                    <div
                      key={att.id}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1 text-xs",
                        isUser
                          ? "bg-primary-foreground/10"
                          : "bg-muted"
                      )}
                    >
                      <FileText size={13} className="shrink-0 opacity-60" />
                      <span className="truncate max-w-[200px]">{att.file_name}</span>
                      <span className="ml-auto shrink-0 opacity-50">
                        {att.file_size < 1024
                          ? `${att.file_size} B`
                          : att.file_size < 1024 * 1024
                            ? `${(att.file_size / 1024).toFixed(1)} KB`
                            : `${(att.file_size / (1024 * 1024)).toFixed(1)} MB`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {isUser ? (
                audioAttachments.length > 0
                  ? null
                  : content
                    ? <p className="whitespace-pre-wrap">{content}</p>
                    : null
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {content}
                </ReactMarkdown>
              )}
              {isStreaming ? (
                <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse rounded-full bg-primary align-middle" />
              ) : null}
            </div>
            {/* Side actions for assistant (Pin only — TTS is below bubble) */}
            {!isUser && !isStreaming ? (
              <div className="mt-1 flex shrink-0 flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                {messageId ? (
                  <button
                    onClick={handleTogglePin}
                    className={cn(
                      "rounded-md p-1 transition-colors",
                      pinned
                        ? "text-primary hover:text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                    title={
                      pinned
                        ? t("取消置顶", "Unpin")
                        : t("置顶消息", "Pin message")
                    }
                  >
                    {pinned ? <PinOff size={13} /> : <Pin size={13} />}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          </>
        )}

        {/* Action bar — shown on hover below the bubble */}
        {hasActions && !isEditing ? (
          <div
            className={cn(
              "mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100",
              isUser && "flex-row-reverse"
            )}
          >
            {isUser ? (
              <button
                onClick={() => {
                  setEditContent(content);
                  setIsEditing(true);
                }}
                className={actionBtnClass}
                title={t("编辑", "Edit")}
              >
                <Pencil size={13} />
              </button>
            ) : (
              <button
                onClick={() => copyToClipboard(content)}
                className={actionBtnClass}
                title={t("复制", "Copy")}
              >
                {copied ? (
                  <Check size={13} className="text-emerald-400" />
                ) : (
                  <Copy size={13} />
                )}
              </button>
            )}
            {showTts && !isUser ? (
              <TtsTriggerButton phase={tts.phase} onClick={tts.toggle} />
            ) : null}
            <button
              onClick={() => messageId && onRetry?.(messageId, role as "user" | "assistant")}
              className={actionBtnClass}
              title={t("重试", "Retry")}
            >
              <RefreshCw size={13} />
            </button>
            <button
              onClick={() => messageId && onDelete?.(messageId)}
              className={cn(actionBtnClass, "hover:text-destructive")}
              title={t("删除", "Delete")}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ) : null}
        {/* TTS playback bar — always visible when active */}
        {showTts && !isUser ? (
          <TtsPlaybackBar
            phase={tts.phase}
            progress={tts.progress}
            elapsed={tts.elapsed}
            totalDuration={tts.totalDuration}
            onStop={tts.toggle}
          />
        ) : null}
      </div>

      {/* Image lightbox */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={closeLightbox}
        >
          <button
            onClick={closeLightbox}
            className="absolute right-4 top-4 rounded-full bg-foreground/20 p-2 text-white transition-colors hover:bg-foreground/40"
          >
            <X size={20} />
          </button>
          <img
            src={lightboxSrc}
            alt=""
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
