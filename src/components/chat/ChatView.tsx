import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  MessageSquarePlus,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef } from "react";
import * as api from "../../lib/tauri";
import type {
  Provider,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload,
} from "../../lib/types";
import { useAppStore } from "../../stores/appStore";
import type { LayoutMode } from "../layout/useLayoutMode";
import { ChatInput } from "./ChatInput";
import { MessageItem } from "./MessageItem";

interface ChatViewProps {
  layout: LayoutMode;
  onBack?: () => void;
  onOpenSettings: () => void;
}

export function ChatView({ layout, onBack, onOpenSettings }: ChatViewProps) {
  const {
    messages,
    conversations,
    currentConversationId,
    isStreaming,
    streamingContent,
    setStreaming,
    appendStreamingContent,
    clearStreamingContent,
    addMessage,
    selectedProviderId,
    selectedModel,
    providers,
    createConversation,
    setSelectedProvider,
    setSelectedModel,
  } = useAppStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const isPhone = layout === "phone";

  useEffect(() => {
    if (!autoScrollRef.current || !scrollRef.current) {
      return;
    }

    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamingContent]);

  useEffect(() => {
    if (!currentConversationId) {
      return;
    }

    const matchesConversation = <T extends { conversation_id: string }>(
      payload: T,
    ): boolean => payload.conversation_id === currentConversationId;

    const subscriptions: Promise<UnlistenFn>[] = [
      listen<StreamChunkPayload>("chat-stream-chunk", (event) => {
        if (!matchesConversation(event.payload)) {
          return;
        }
        appendStreamingContent(event.payload.content);
      }),
      listen<StreamDonePayload>("chat-stream-done", (event) => {
        if (!matchesConversation(event.payload)) {
          return;
        }

        setStreaming(false);
        addMessage({
          id: event.payload.message_id,
          conversation_id: event.payload.conversation_id,
          role: "assistant",
          content: event.payload.full_content,
          created_at: new Date().toISOString(),
        });
        clearStreamingContent();
        autoScrollRef.current = true;
      }),
      listen<StreamErrorPayload>("chat-stream-error", (event) => {
        if (!matchesConversation(event.payload)) {
          return;
        }

        setStreaming(false);
        clearStreamingContent();
        console.error("Stream error:", event.payload.error);
      }),
    ];

    return () => {
      for (const subscription of subscriptions) {
        void subscription.then((off) => off());
      }
    };
  }, [
    addMessage,
    appendStreamingContent,
    clearStreamingContent,
    currentConversationId,
    setStreaming,
  ]);

  function handleScroll(): void {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    autoScrollRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 100;
  }

  async function handleSend(content: string): Promise<void> {
    if (!selectedProviderId || !selectedModel) {
      console.error("No provider/model selected");
      return;
    }

    const conversationId = currentConversationId ?? (await createConversation());

    addMessage({
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      role: "user",
      content,
      created_at: new Date().toISOString(),
    });

    setStreaming(true);
    clearStreamingContent();
    autoScrollRef.current = true;

    try {
      await api.sendMessage(
        conversationId,
        content,
        selectedProviderId,
        selectedModel,
      );
    } catch (error) {
      setStreaming(false);
      clearStreamingContent();
      console.error("Send failed:", error);
    }
  }

  function handleBack(): void {
    if (isStreaming) {
      void api.stopGeneration();
    }
    onBack?.();
  }

  const currentProvider = providers.find(
    (provider) => provider.id === selectedProviderId,
  );
  const currentConversation = conversations.find(
    (conversation) => conversation.id === currentConversationId,
  );
  const hasConversation = !!currentConversationId;
  const title = hasConversation
    ? currentConversation?.title.trim() || "New Conversation"
    : "Private Talk";
  const subtitle = hasConversation
    ? selectedModel ?? currentProvider?.name ?? "Choose a model"
    : providers.length > 0
      ? "Everything stays on this device."
      : "Add a provider to begin.";

  return (
    <div className={`pt-chat pt-chat--${layout}`}>
      {isPhone ? (
        <MobileChatHeader
          title={hasConversation ? title : "New Chat"}
          subtitle={hasConversation ? subtitle : "Private, on-device threads"}
          canGoBack={hasConversation}
          onBack={handleBack}
          onOpenSettings={onOpenSettings}
        />
      ) : (
        <DesktopChatHeader
          title={title}
          subtitle={subtitle}
          providers={providers}
          currentProvider={currentProvider}
          selectedProviderId={selectedProviderId}
          selectedModel={selectedModel}
          onProviderChange={setSelectedProvider}
          onModelChange={setSelectedModel}
        />
      )}

      {isPhone && hasConversation ? (
        <ProviderSelectBar
          layout={layout}
          providers={providers}
          currentProvider={currentProvider}
          selectedProviderId={selectedProviderId}
          selectedModel={selectedModel}
          onProviderChange={setSelectedProvider}
          onModelChange={setSelectedModel}
        />
      ) : null}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="pt-chat__scroll"
      >
        <div className="pt-chat__column">
          {hasConversation ? (
            <>
              {messages.length === 0 && !isStreaming ? (
                <ConversationStarterCard />
              ) : null}

              {messages.map((message) => (
                <MessageItem
                  key={message.id}
                  role={message.role}
                  content={message.content}
                />
              ))}

              {isStreaming && streamingContent ? (
                <MessageItem
                  role="assistant"
                  content={streamingContent}
                  isStreaming
                />
              ) : null}

              {isStreaming && !streamingContent ? <TypingIndicator /> : null}
            </>
          ) : (
            <WelcomePanel
              hasProviders={providers.length > 0}
              onCreateConversation={() => void createConversation()}
              onOpenSettings={onOpenSettings}
            />
          )}
        </div>
      </div>

      <ChatInput layout={layout} onSend={handleSend} onStop={api.stopGeneration} />
    </div>
  );
}

function DesktopChatHeader({
  title,
  subtitle,
  providers,
  currentProvider,
  selectedProviderId,
  selectedModel,
  onProviderChange,
  onModelChange,
}: {
  title: string;
  subtitle: string;
  providers: Provider[];
  currentProvider: Provider | undefined;
  selectedProviderId: string | null;
  selectedModel: string | null;
  onProviderChange: (id: string) => void;
  onModelChange: (model: string) => void;
}) {
  return (
    <header className="pt-pane-header pt-pane-header--desktop pt-drag">
      <div className="pt-pane-header__copy">
        <p className="pt-pane-header__title">{title}</p>
        <p className="pt-pane-header__subtitle">{subtitle}</p>
      </div>

      <div className="pt-pane-header__actions" data-no-drag>
        <ProviderControls
          providers={providers}
          currentProvider={currentProvider}
          selectedProviderId={selectedProviderId}
          selectedModel={selectedModel}
          onProviderChange={onProviderChange}
          onModelChange={onModelChange}
        />
      </div>
    </header>
  );
}

function MobileChatHeader({
  title,
  subtitle,
  canGoBack,
  onBack,
  onOpenSettings,
}: {
  title: string;
  subtitle: string;
  canGoBack: boolean;
  onBack: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <header className="pt-pane-header pt-pane-header--mobile">
      {canGoBack ? (
        <button
          type="button"
          className="pt-icon-button"
          onClick={onBack}
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
      ) : (
        <div className="pt-pane-header__spacer" />
      )}

      <div className="pt-pane-header__copy pt-pane-header__copy--center">
        <p className="pt-pane-header__title">{title}</p>
        <p className="pt-pane-header__subtitle">{subtitle}</p>
      </div>

      <button
        type="button"
        className="pt-icon-button"
        onClick={onOpenSettings}
        aria-label="Open settings"
      >
        <Settings2 size={18} />
      </button>
    </header>
  );
}

function ProviderSelectBar({
  layout,
  providers,
  currentProvider,
  selectedProviderId,
  selectedModel,
  onProviderChange,
  onModelChange,
}: {
  layout: LayoutMode;
  providers: Provider[];
  currentProvider: Provider | undefined;
  selectedProviderId: string | null;
  selectedModel: string | null;
  onProviderChange: (id: string) => void;
  onModelChange: (model: string) => void;
}) {
  return (
    <div className={`pt-provider-bar pt-provider-bar--${layout}`}>
      <ProviderControls
        providers={providers}
        currentProvider={currentProvider}
        selectedProviderId={selectedProviderId}
        selectedModel={selectedModel}
        onProviderChange={onProviderChange}
        onModelChange={onModelChange}
        compact
      />
    </div>
  );
}

function ProviderControls({
  providers,
  currentProvider,
  selectedProviderId,
  selectedModel,
  onProviderChange,
  onModelChange,
  compact = false,
}: {
  providers: Provider[];
  currentProvider: Provider | undefined;
  selectedProviderId: string | null;
  selectedModel: string | null;
  onProviderChange: (id: string) => void;
  onModelChange: (model: string) => void;
  compact?: boolean;
}) {
  if (providers.length === 0) {
    return <span className="pt-status-pill">No provider</span>;
  }

  return (
    <div className={`pt-provider-controls${compact ? " is-compact" : ""}`}>
      <select
        value={selectedProviderId ?? ""}
        onChange={(event) => onProviderChange(event.target.value)}
        className="pt-select"
        aria-label="Provider"
      >
        {providers.map((provider) => (
          <option key={provider.id} value={provider.id}>
            {provider.name}
          </option>
        ))}
      </select>

      {currentProvider ? (
        <select
          value={selectedModel ?? ""}
          onChange={(event) => onModelChange(event.target.value)}
          className="pt-select"
          aria-label="Model"
        >
          {currentProvider.models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

function WelcomePanel({
  hasProviders,
  onCreateConversation,
  onOpenSettings,
}: {
  hasProviders: boolean;
  onCreateConversation: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <section className="pt-welcome">
      <div className="pt-welcome__icon">
        {hasProviders ? <MessageSquarePlus size={28} /> : <Sparkles size={28} />}
      </div>
      <h2 className="pt-welcome__title">
        {hasProviders ? "Start a private conversation" : "Add a model provider"}
      </h2>
      <p className="pt-welcome__copy">
        {hasProviders
          ? "Create a thread and your next message becomes the first turn."
          : "Private Talk keeps conversations local, but it still needs an endpoint you trust before it can send messages."}
      </p>
      <div className="pt-welcome__actions">
        {hasProviders ? (
          <button type="button" className="pt-btn pt-btn--primary" onClick={onCreateConversation}>
            New Chat
          </button>
        ) : (
          <button type="button" className="pt-btn pt-btn--primary" onClick={onOpenSettings}>
            Open Settings
          </button>
        )}
      </div>
    </section>
  );
}

function ConversationStarterCard() {
  return (
    <section className="pt-helper-card">
      <div className="pt-helper-card__icon">
        <MessageSquarePlus size={20} />
      </div>
      <div>
        <p className="pt-helper-card__title">Ask anything to begin</p>
        <p className="pt-helper-card__copy">
          Your next message becomes the first turn in this conversation.
        </p>
      </div>
    </section>
  );
}

function TypingIndicator() {
  return (
    <div className="pt-message pt-message--assistant">
      <div className="pt-message__bubble pt-message__bubble--assistant">
        <div className="pt-typing">
          <span className="pt-typing__dot" />
          <span className="pt-typing__dot" />
          <span className="pt-typing__dot" />
        </div>
      </div>
    </div>
  );
}
