import {
  Check,
  MessageSquare,
  Pencil,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../lib/i18n";
import { getProvidersForPurpose } from "../../lib/providerModels";
import type { Conversation } from "../../lib/types";
import { useAppStore } from "../../stores/appStore";
import type { LayoutMode } from "./useLayoutMode";

function stop(event: React.MouseEvent): void {
  event.stopPropagation();
}

function formatConversationTime(
  timestamp: string,
  locale: "zh-CN" | "en",
  fallbackLabel: string,
): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return fallbackLabel;
  }

  const now = new Date();
  const isSameYear = date.getFullYear() === now.getFullYear();

  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    ...(isSameYear ? {} : { year: "numeric" }),
  }).format(date);
}

function conversationTitle(title: string, fallbackLabel: string): string {
  return title.trim() || fallbackLabel;
}

function conversationPreview(preview: string, emptyLabel: string): string {
  const normalized = preview
    .replace(/```[\s\S]*?```/g, "Code snippet")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || emptyLabel;
}

function conversationAvatar(title: string, fallbackLabel: string): string {
  const normalized = conversationTitle(title, fallbackLabel)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return normalized || "PT";
}

export function Sidebar({
  layout,
  onRequestNewConversation,
}: {
  layout: LayoutMode;
  onRequestNewConversation: () => void;
}) {
  const { t } = useI18n();
  const conversations = useAppStore((s) => s.conversations);
  const providers = useAppStore((s) => s.providers);
  const providerModelRegistry = useAppStore((s) => s.providerModelRegistry);
  const view = useAppStore((s) => s.view);
  const openSettings = useAppStore((s) => s.openSettings);
  const isPhone = layout === "phone";
  const hasTextProviders =
    getProvidersForPurpose(providers, providerModelRegistry, "chat").length > 0;
  const showProviderNotice = !hasTextProviders;
  const desktopDragProps = !isPhone ? { "data-tauri-drag-region": true } : {};

  return (
    <div className={`pt-sidebar pt-sidebar--${layout}`}>
      <header
        className={`pt-sidebar__header${isPhone ? "" : " pt-drag"}`}
        {...desktopDragProps}
      >
        <div {...desktopDragProps}>
          <p className="pt-sidebar__eyebrow" {...desktopDragProps}>
            Private Talk
          </p>
          <h1 className="pt-sidebar__title" {...desktopDragProps}>
            {t("聊天", "Chats")}
          </h1>
        </div>

        {isPhone ? (
          <button
            type="button"
            className={`pt-icon-button${view === "settings" ? " is-active" : ""}`}
            onClick={() => openSettings()}
            aria-label={t("打开设置", "Open settings")}
          >
            <Settings size={18} />
          </button>
        ) : (
          <div className="pt-sidebar__header-spacer" {...desktopDragProps} />
        )}
      </header>

      <div className="pt-sidebar__content">
        {showProviderNotice ? (
          <section className="pt-sidebar__notice">
            <div className="pt-sidebar__notice-icon">
              <Sparkles size={16} />
            </div>
            <div>
              <p className="pt-sidebar__notice-title">
                {providers.length === 0
                  ? t("添加模型服务商", "Add a model provider")
                  : t("标记一个文本模型", "Mark a text model")}
              </p>
              <p className="pt-sidebar__notice-copy">
                {providers.length === 0
                  ? t(
                      "先在设置中配置一个 OpenAI 兼容端点，再开始发送第一条消息。",
                      "Configure an OpenAI-compatible endpoint in Settings before you send your first message.",
                    )
                  : t(
                      "已有服务商，但还没有可用于聊天的文本模型。去“模型与服务商”里给一个模型标记“文本”用途。",
                      "A provider already exists, but there is no text model for chat yet. Go to Models & Providers and mark one model as text.",
                    )}
              </p>
            </div>
          </section>
        ) : null}

        <div className="pt-sidebar__section">
          <div className="pt-sidebar__section-header">
            <span className="pt-sidebar__section-title">{t("最近", "Recent")}</span>
            <span className="pt-sidebar__section-count">
              {conversations.length}
            </span>
          </div>

          <ConversationList />
        </div>

        <button
          type="button"
          className="pt-inline-button"
          onClick={onRequestNewConversation}
        >
          <Plus size={17} strokeWidth={2.6} />
          {t("新建聊天", "New Chat")}
        </button>
      </div>

      {!isPhone ? (
        <footer className="pt-sidebar__footer">
          <button
            type="button"
            className={`pt-nav-button${view === "settings" ? " is-active" : ""}`}
            onClick={() => openSettings()}
            aria-label={t("打开设置", "Open settings")}
          >
            <Settings size={16} />
            <span>{t("设置", "Settings")}</span>
          </button>
        </footer>
      ) : null}
    </div>
  );
}

function ConversationList() {
  const { t, locale } = useI18n();
  const conversations = useAppStore((state) => state.conversations);
  const currentConversationId = useAppStore(
    (state) => state.currentConversationId,
  );
  const selectConversation = useAppStore((state) => state.selectConversation);
  const deleteConversation = useAppStore((state) => state.deleteConversation);
  const renameConversation = useAppStore((state) => state.renameConversation);
  const view = useAppStore((state) => state.view);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  function beginRename(conversation: Conversation): void {
    setEditingId(conversation.id);
    setEditTitle(conversationTitle(conversation.title, t("新对话", "New Conversation")));
  }

  function cancelRename(): void {
    setEditingId(null);
    setEditTitle("");
  }

  async function confirmRename(): Promise<void> {
    if (!editingId) {
      return;
    }

    const nextTitle = editTitle.trim();
    if (nextTitle) {
      await renameConversation(editingId, nextTitle);
    }
    cancelRename();
  }

  if (conversations.length === 0) {
    return (
      <div className="pt-sidebar__empty">
        <MessageSquare size={20} />
        <p>{t("还没有对话。", "No conversations yet.")}</p>
      </div>
    );
  }

  return (
    <div className="pt-conversation-list">
      {conversations.map((conversation) => (
        <ConversationRow
          key={conversation.id}
          conversation={conversation}
          active={
            currentConversationId === conversation.id && view === "chat"
          }
          editing={editingId === conversation.id}
          editTitle={editTitle}
          onSelect={() => void selectConversation(conversation.id)}
          onStartRename={() => beginRename(conversation)}
          onEditTitleChange={setEditTitle}
          onConfirmRename={() => void confirmRename()}
          onCancelRename={cancelRename}
          onDelete={() => void deleteConversation(conversation.id)}
          locale={locale}
          untitledLabel={t("新对话", "New Conversation")}
          emptyPreviewLabel={t("还没有消息。", "No messages yet.")}
          recentlyUpdatedLabel={t("最近更新", "Recently updated")}
          renameLabel={t("重命名对话", "Rename conversation")}
          deleteLabel={t("删除对话", "Delete conversation")}
          confirmRenameLabel={t("确认重命名", "Confirm rename")}
          cancelRenameLabel={t("取消重命名", "Cancel rename")}
        />
      ))}
    </div>
  );
}

interface ConversationRowProps {
  conversation: Conversation;
  active: boolean;
  editing: boolean;
  editTitle: string;
  onSelect: () => void;
  onStartRename: () => void;
  onEditTitleChange: (value: string) => void;
  onConfirmRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  locale: "zh-CN" | "en";
  untitledLabel: string;
  emptyPreviewLabel: string;
  recentlyUpdatedLabel: string;
  renameLabel: string;
  deleteLabel: string;
  confirmRenameLabel: string;
  cancelRenameLabel: string;
}

function ConversationRow({
  conversation,
  active,
  editing,
  editTitle,
  onSelect,
  onStartRename,
  onEditTitleChange,
  onConfirmRename,
  onCancelRename,
  onDelete,
  locale,
  untitledLabel,
  emptyPreviewLabel,
  recentlyUpdatedLabel,
  renameLabel,
  deleteLabel,
  confirmRenameLabel,
  cancelRenameLabel,
}: ConversationRowProps) {
  return (
    <div
      className={`pt-conversation-row${active ? " is-active" : ""}${
        editing ? " is-editing" : ""
      }`}
      onClick={editing ? undefined : onSelect}
      role={editing ? undefined : "button"}
      tabIndex={editing ? undefined : 0}
      onKeyDown={
        editing
          ? undefined
          : (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect();
              }
            }
      }
    >
      <div className="pt-conversation-row__avatar">
        <span>{conversationAvatar(conversation.title, untitledLabel)}</span>
      </div>

      <div className="pt-conversation-row__body">
        {editing ? (
          <div className="pt-conversation-row__editing">
            <input
              value={editTitle}
              className="pt-input pt-input--compact"
              onChange={(event) => onEditTitleChange(event.target.value)}
              onClick={stop}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onConfirmRename();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelRename();
                }
              }}
              autoFocus
            />

            <div className="pt-conversation-row__editing-actions">
              <button
                type="button"
                className="pt-row-icon pt-row-icon--success"
                onClick={(event) => {
                  stop(event);
                  onConfirmRename();
                }}
                aria-label={confirmRenameLabel}
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                className="pt-row-icon"
                onClick={(event) => {
                  stop(event);
                  onCancelRename();
                }}
                aria-label={cancelRenameLabel}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="pt-conversation-row__title-line">
              <p className="pt-conversation-row__title">
                {conversationTitle(conversation.title, untitledLabel)}
              </p>
              <span className="pt-conversation-row__time">
                {formatConversationTime(
                  conversation.updated_at,
                  locale,
                  recentlyUpdatedLabel,
                )}
              </span>
            </div>
            <p className="pt-conversation-row__preview">
              {conversationPreview(conversation.preview, emptyPreviewLabel)}
            </p>
          </>
        )}
      </div>

      {!editing ? (
        <div className="pt-conversation-row__actions">
          <button
            type="button"
            className="pt-row-icon"
            onClick={(event) => {
              stop(event);
              onStartRename();
            }}
            aria-label={renameLabel}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            className="pt-row-icon pt-row-icon--danger"
            onClick={(event) => {
              stop(event);
              onDelete();
            }}
            aria-label={deleteLabel}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
