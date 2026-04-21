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
import type { Conversation } from "../../lib/types";
import { useAppStore } from "../../stores/appStore";
import type { LayoutMode } from "./useLayoutMode";

function stop(event: React.MouseEvent): void {
  event.stopPropagation();
}

function formatConversationTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Recently updated";
  }

  const now = new Date();
  const isSameYear = date.getFullYear() === now.getFullYear();

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(isSameYear ? {} : { year: "numeric" }),
  }).format(date);
}

function conversationTitle(title: string): string {
  return title.trim() || "New Conversation";
}

function conversationPreview(preview: string): string {
  const normalized = preview
    .replace(/```[\s\S]*?```/g, "Code snippet")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || "No messages yet.";
}

function conversationAvatar(title: string): string {
  const normalized = conversationTitle(title)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return normalized || "PT";
}

export function Sidebar({ layout }: { layout: LayoutMode }) {
  const conversations = useAppStore((s) => s.conversations);
  const providers = useAppStore((s) => s.providers);
  const view = useAppStore((s) => s.view);
  const createConversation = useAppStore((s) => s.createConversation);
  const setView = useAppStore((s) => s.setView);
  const isPhone = layout === "phone";
  const showProviderNotice = providers.length === 0;

  return (
    <div className={`pt-sidebar pt-sidebar--${layout}`}>
      <header className={`pt-sidebar__header${isPhone ? "" : " pt-drag"}`}>
        <div>
          <p className="pt-sidebar__eyebrow">Private Talk</p>
          <h1 className="pt-sidebar__title">Chats</h1>
        </div>

        {isPhone ? (
          <button
            type="button"
            className={`pt-icon-button${view === "settings" ? " is-active" : ""}`}
            onClick={() => setView("settings")}
            aria-label="Open settings"
          >
            <Settings size={18} />
          </button>
        ) : (
          <div className="pt-sidebar__header-spacer" data-no-drag />
        )}
      </header>

      <div className="pt-sidebar__content">
        {showProviderNotice ? (
          <section className="pt-sidebar__notice">
            <div className="pt-sidebar__notice-icon">
              <Sparkles size={16} />
            </div>
            <div>
              <p className="pt-sidebar__notice-title">Add a model provider</p>
              <p className="pt-sidebar__notice-copy">
                Configure an OpenAI-compatible endpoint in Settings before you
                send your first message.
              </p>
            </div>
          </section>
        ) : null}

        <div className="pt-sidebar__section">
          <div className="pt-sidebar__section-header">
            <span className="pt-sidebar__section-title">Recent</span>
            <span className="pt-sidebar__section-count">
              {conversations.length}
            </span>
          </div>

          <ConversationList />
        </div>

        <button
          type="button"
          className="pt-inline-button"
          onClick={() => void createConversation()}
        >
          <Plus size={17} strokeWidth={2.6} />
          New Chat
        </button>
      </div>

      {!isPhone ? (
        <footer className="pt-sidebar__footer">
          <button
            type="button"
            className={`pt-nav-button${view === "settings" ? " is-active" : ""}`}
            onClick={() => setView("settings")}
            aria-label="Open settings"
          >
            <Settings size={16} />
            <span>Settings</span>
          </button>
        </footer>
      ) : null}
    </div>
  );
}

function ConversationList() {
  const {
    conversations,
    currentConversationId,
    selectConversation,
    deleteConversation,
    renameConversation,
    view,
  } = useAppStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  function beginRename(conversation: Conversation): void {
    setEditingId(conversation.id);
    setEditTitle(conversationTitle(conversation.title));
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
        <p>No conversations yet.</p>
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
        <span>{conversationAvatar(conversation.title)}</span>
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
                aria-label="Confirm rename"
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
                aria-label="Cancel rename"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="pt-conversation-row__title-line">
              <p className="pt-conversation-row__title">
                {conversationTitle(conversation.title)}
              </p>
              <span className="pt-conversation-row__time">
                {formatConversationTime(conversation.updated_at)}
              </span>
            </div>
            <p className="pt-conversation-row__preview">
              {conversationPreview(conversation.preview)}
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
            aria-label="Rename conversation"
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
            aria-label="Delete conversation"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
