import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { File, FileImage, FileText, Loader2, Square, Volume2 } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n";
import * as api from "../../lib/tauri";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Attachment, Role } from "../../lib/types";
import { useAppStore } from "../../stores/appStore";

const LazyMarkdownCodeBlock = lazy(async () => {
  const module = await import("./MarkdownCodeBlock");
  return { default: module.MarkdownCodeBlock };
});

interface MessageItemProps {
  role: Role;
  content: string;
  attachments?: Attachment[];
  isStreaming?: boolean;
}

export function MessageItem({
  role,
  content,
  attachments = [],
  isStreaming = false,
}: MessageItemProps) {
  if (role === "user") {
    return (
      <div className="pt-message pt-message--user">
        <div className="pt-message__bubble pt-message__bubble--user">
          {content ? <p className="pt-message__plain">{content}</p> : null}
          {attachments.length > 0 ? <AttachmentList attachments={attachments} /> : null}
        </div>
      </div>
    );
  }

  return (
    <AssistantMessage
      content={content}
      attachments={attachments}
      isStreaming={isStreaming}
    />
  );
}

function AssistantMessage({
  content,
  attachments,
  isStreaming,
}: {
  content: string;
  attachments: Attachment[];
  isStreaming: boolean;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const ttsProviderId = useAppStore((state) => state.ttsProviderId);
  const ttsModel = useAppStore((state) => state.ttsModel);
  const ttsVoice = useAppStore((state) => state.ttsVoice);
  const selectedProviderId = useAppStore((state) => state.selectedProviderId);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const activeTtsProviderId = ttsProviderId ?? selectedProviderId;

  function copyToClipboard(value: string): void {
    navigator.clipboard.writeText(value).catch((error) => {
      console.warn("Failed to copy code block:", error);
    });
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
      audioRef.current = null;
      audioUrlRef.current = null;
    };
  }, []);

  function speechText(markdown: string): string {
    return markdown
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[#>*_-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function base64ToBlob(base64: string, mimeType: string): Blob {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    return new Blob([bytes], { type: mimeType });
  }

  async function toggleSpeech(): Promise<void> {
    if (isSpeaking) {
      audioRef.current?.pause();
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
      audioRef.current = null;
      audioUrlRef.current = null;
      setIsSpeaking(false);
      return;
    }

    if (!activeTtsProviderId) {
      return;
    }

    const text = speechText(content);
    if (!text) {
      return;
    }

    setIsSpeaking(true);

    try {
      const result = await api.ttsSynthesize(text, activeTtsProviderId, ttsModel, ttsVoice, "mp3");
      const blob = base64ToBlob(result.audio_base64, result.content_type);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audioUrlRef.current = url;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setIsSpeaking(false);
        audioRef.current = null;
        audioUrlRef.current = null;
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setIsSpeaking(false);
        audioRef.current = null;
        audioUrlRef.current = null;
      };
      await audio.play();
    } catch (error) {
      setIsSpeaking(false);
      console.warn("Failed to synthesize speech:", error);
    }
  }

  return (
    <div className="pt-message pt-message--assistant">
      <div className="pt-message__bubble pt-message__bubble--assistant">
        {activeTtsProviderId ? (
          <div className="pt-message__bubble-toolbar">
            <button
              type="button"
              className="pt-message__tool"
              onClick={() => void toggleSpeech()}
              aria-label={isSpeaking ? t("停止朗读", "Stop playback") : t("朗读消息", "Speak message")}
              title={isSpeaking ? t("停止朗读", "Stop playback") : t("朗读消息", "Speak message")}
            >
              {isSpeaking ? (
                <Square size={13} fill="currentColor" />
              ) : isStreaming ? (
                <Loader2 size={14} className="pt-spinner" />
              ) : (
                <Volume2 size={14} />
              )}
            </button>
          </div>
        ) : null}

        <div className="pt-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={buildMarkdownComponents(copied, copyToClipboard, t)}
          >
            {content}
          </ReactMarkdown>
          {attachments.length > 0 ? <AttachmentList attachments={attachments} /> : null}
          {isStreaming ? <span className="pt-message__cursor" /> : null}
        </div>
      </div>
    </div>
  );
}

function attachmentHref(path: string): string | null {
  if (!path) {
    return null;
  }
  return isTauri() ? convertFileSrc(path) : path;
}

function formatFileSize(size: number): string {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${size} B`;
}

function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  return (
    <div className="pt-attachment-list">
      {attachments.map((attachment) => (
        <AttachmentCard key={attachment.id} attachment={attachment} />
      ))}
    </div>
  );
}

function AttachmentCard({ attachment }: { attachment: Attachment }) {
  const href = attachmentHref(attachment.file_path);
  const isImage = attachment.file_type === "image" && !!href;
  const icon =
    attachment.file_type === "image"
      ? <FileImage size={16} />
      : attachment.file_type === "pdf" || attachment.file_type === "text_file"
        ? <FileText size={16} />
        : <File size={16} />;

  async function handleOpen(): Promise<void> {
    if (!attachment.file_path) {
      return;
    }
    if (isTauri()) {
      await openPath(attachment.file_path);
      return;
    }
    if (href) {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <button
      type="button"
      className={`pt-attachment-card${isImage ? " is-image" : ""}`}
      onClick={() => void handleOpen()}
      disabled={!href && !attachment.file_path}
    >
      {isImage ? (
        <img
          className="pt-attachment-card__image"
          src={href ?? undefined}
          alt={attachment.file_name}
        />
      ) : (
        <div className="pt-attachment-card__icon">{icon}</div>
      )}
      <div className="pt-attachment-card__copy">
        <span className="pt-attachment-card__title">{attachment.file_name}</span>
        <span className="pt-attachment-card__meta">
          {attachment.file_type} · {formatFileSize(attachment.file_size)}
        </span>
      </div>
    </button>
  );
}

function decodeLocalImagePath(value: string): string | null {
  if (!value.startsWith("localb64://")) {
    return null;
  }

  try {
    const payload = value.slice("localb64://".length);
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch (error) {
    console.warn("Failed to decode local image path:", error);
    return null;
  }
}

function resolveMarkdownImageSrc(src?: string): string | undefined {
  if (!src) {
    return undefined;
  }

  const localPath = decodeLocalImagePath(src);
  if (!localPath) {
    return src;
  }

  return isTauri() ? convertFileSrc(localPath) : localPath;
}

function buildMarkdownComponents(
  copied: boolean,
  onCopy: (value: string) => void,
  t: (zh: string, en: string) => string,
): Components {
  return {
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || "");
      const code = String(children).replace(/\n$/, "");

      if (!match) {
        return (
          <code className="pt-markdown__inline-code" {...props}>
            {children}
          </code>
        );
      }

      return (
        <Suspense fallback={<CodeBlockFallback code={code} language={match[1]} />}>
          <LazyMarkdownCodeBlock
            code={code}
            copied={copied}
            language={match[1]}
            onCopy={onCopy}
            copyLabel={copied ? t("已复制", "Copied") : t("复制代码", "Copy code")}
          />
        </Suspense>
      );
    },
    p({ children }) {
      return <p>{children}</p>;
    },
    ul({ children }) {
      return <ul>{children}</ul>;
    },
    ol({ children }) {
      return <ol>{children}</ol>;
    },
    blockquote({ children }) {
      return <blockquote>{children}</blockquote>;
    },
    a({ href, children }) {
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    },
    img({ src, alt }) {
      const resolvedSrc = resolveMarkdownImageSrc(src);
      if (!resolvedSrc) {
        return null;
      }

      return <img src={resolvedSrc} alt={alt ?? ""} className="pt-markdown__image" loading="lazy" />;
    },
    table({ children }) {
      return (
        <div className="pt-markdown__table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  };
}

function CodeBlockFallback({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  return (
    <div className="pt-code-block">
      <div className="pt-code-block__toolbar">
        <span>{language}</span>
      </div>
      <pre className="pt-code-block__fallback">
        <code>{code}</code>
      </pre>
    </div>
  );
}
