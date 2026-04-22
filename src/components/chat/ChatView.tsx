import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  MessageSquarePlus,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n";
import * as api from "../../lib/tauri";
import type {
  Attachment,
  Assistant,
  Provider,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload,
} from "../../lib/types";
import { useAppStore } from "../../stores/appStore";
import type { LayoutMode } from "../layout/useLayoutMode";
import { ChatInput, type ChatInputSubmission } from "./ChatInput";
import { MessageItem } from "./MessageItem";

interface ChatViewProps {
  layout: LayoutMode;
  onBack?: () => void;
  onOpenSettings: () => void;
  onRequestNewConversation: () => void;
}

type Unlisten = () => void;

export function ChatView({
  layout,
  onBack,
  onOpenSettings,
  onRequestNewConversation,
}: ChatViewProps) {
  const { t } = useI18n();
  const {
    messages,
    conversations,
    currentConversationId,
    currentAssistantId,
    isStreaming,
    streamingContent,
    setStreaming,
    appendStreamingContent,
    clearStreamingContent,
    addMessage,
    selectedProviderId,
    selectedModel,
    providers,
    assistants,
    imageGenConfig,
    createConversation,
    selectAssistant,
    setSelectedProvider,
    setSelectedModel,
  } = useAppStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const isPhone = layout === "phone";
  const [isImageGenerating, setIsImageGenerating] = useState(false);
  const imageEnabled =
    imageGenConfig.enabled &&
    imageGenConfig.provider_id.trim().length > 0 &&
    imageGenConfig.model.trim().length > 0;

  function normalizeImageContent(content: string): string {
    return content.trim().startsWith("/img") ? content.trim() : `/img ${content.trim()}`;
  }

  function attachmentSummary(attachments: Attachment[]): string {
    if (attachments.length === 1) {
      return t(
        `已附加文件：${attachments[0]?.file_name ?? "未命名文件"}`,
        `Attached file: ${attachments[0]?.file_name ?? "Untitled file"}`,
      );
    }
    return t(`已附加 ${attachments.length} 个文件`, `Attached ${attachments.length} files`);
  }

  useEffect(() => {
    if (!autoScrollRef.current || !scrollRef.current) {
      return;
    }

    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamingContent]);

  useEffect(() => {
    if (providers.length === 0) {
      return;
    }

    const fallbackProvider =
      providers.find((provider) => provider.is_default) ?? providers[0];

    if (!selectedProviderId) {
      setSelectedProvider(fallbackProvider.id);
      return;
    }

    const activeProvider =
      providers.find((provider) => provider.id === selectedProviderId) ?? null;

    if (!activeProvider) {
      setSelectedProvider(fallbackProvider.id);
      return;
    }

    if (!selectedModel || !activeProvider.models.includes(selectedModel)) {
      const nextModel = activeProvider.models[0] ?? null;
      if (nextModel) {
        setSelectedModel(nextModel);
      }
    }
  }, [
    providers,
    selectedModel,
    selectedProviderId,
    setSelectedModel,
    setSelectedProvider,
  ]);

  useEffect(() => {
    if (!currentConversationId) {
      return;
    }

    const matchesConversation = <T extends { conversation_id: string }>(
      payload: T,
    ): boolean => payload.conversation_id === currentConversationId;

    const subscriptions: Promise<Unlisten>[] = [
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
          attachments: [],
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
        setIsImageGenerating(false);
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

  async function handleSend(submission: ChatInputSubmission): Promise<void> {
    const rawContent = submission.content.trim();
    const isImageRequest = submission.mode === "image" || rawContent.startsWith("/img");
    const fallbackProvider =
      providers.find((provider) => provider.is_default) ?? providers[0];
    const activeProvider =
      providers.find((provider) => provider.id === selectedProviderId) ?? fallbackProvider;
    const activeProviderId = activeProvider?.id ?? null;
    const activeModel =
      activeProvider?.models.includes(selectedModel ?? "")
        ? selectedModel
        : activeProvider?.models[0] ?? null;

    if (isImageRequest && !imageEnabled) {
      const conversationId = currentConversationId ?? (await createConversation());
      addMessage({
        id: crypto.randomUUID(),
        conversation_id: conversationId,
        role: "assistant",
        content: t(
          "图片生成当前还没有配置完成。先去 Settings > Image Generation 里启用并选择服务商，再继续发送 /img 请求。",
          "Image generation is not configured yet. Enable it in Settings > Image Generation and choose a provider before sending /img requests.",
        ),
        attachments: [],
        created_at: new Date().toISOString(),
      });
      return;
    }

    if (!isImageRequest && (!activeProviderId || !activeModel)) {
      console.error("No provider/model selected");
      return;
    }

    const conversationId = currentConversationId ?? (await createConversation());
    const userMessageId = crypto.randomUUID();
    const optimisticAttachments: Attachment[] = submission.attachments.map((attachment, index) => ({
      id: `pending-${index}`,
      message_id: userMessageId,
      file_type:
        attachment.mime_type === "application/pdf"
          ? "pdf"
          : attachment.mime_type.startsWith("text/") || attachment.mime_type === "application/json"
            ? "text_file"
            : attachment.mime_type.startsWith("image/")
              ? "image"
              : "file",
      file_name: attachment.file_name,
      file_path: "",
      mime_type: attachment.mime_type,
      file_size: Math.round((attachment.data_base64.length * 3) / 4),
      created_at: new Date().toISOString(),
    }));
    const normalizedImagePrompt =
      rawContent ||
      t("按参考图生成一张图片", "Generate an image from the reference image");
    const effectiveReferenceImage =
      submission.referenceImage ??
      (() => {
        const imageAttachment = submission.attachments.find((attachment) =>
          attachment.mime_type.startsWith("image/"),
        );
        return imageAttachment
          ? {
              name: imageAttachment.file_name,
              mimeType: imageAttachment.mime_type,
              base64: imageAttachment.data_base64,
            }
          : null;
      })();
    const displayAttachments = isImageRequest ? [] : optimisticAttachments;
    const userContent = isImageRequest
      ? `🖼 ${normalizedImagePrompt}`
      : rawContent || attachmentSummary(optimisticAttachments);

    addMessage({
      id: userMessageId,
      conversation_id: conversationId,
      role: "user",
      content: userContent,
      attachments: displayAttachments,
      created_at: new Date().toISOString(),
    });

    clearStreamingContent();
    autoScrollRef.current = true;

    try {
      if (isImageRequest) {
        setIsImageGenerating(true);
        const assistantMessage = await api.generateImageMessage(
          conversationId,
          normalizeImageContent(normalizedImagePrompt),
          userContent,
          effectiveReferenceImage?.base64,
          effectiveReferenceImage?.mimeType,
        );
        addMessage({
          ...assistantMessage,
          role: "assistant",
          attachments: [],
        });
        setIsImageGenerating(false);
        clearStreamingContent();
        return;
      }

      setStreaming(true);
      await api.sendMessage(
        conversationId,
        rawContent,
        userContent,
        activeProviderId!,
        activeModel!,
        userMessageId,
        submission.attachments,
      );
    } catch (error) {
      setStreaming(false);
      setIsImageGenerating(false);
      clearStreamingContent();
      const message =
        error instanceof Error
          ? error.message
          : t("请求失败，请检查当前服务商配置。", "Request failed. Check the current provider configuration.");
      addMessage({
        id: crypto.randomUUID(),
        conversation_id: conversationId,
        role: "assistant",
        content: t(
          `请求失败：${message}`,
          `Request failed: ${message}`,
        ),
        attachments: [],
        created_at: new Date().toISOString(),
      });
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
  const effectiveProvider =
    currentProvider ??
    providers.find((provider) => provider.is_default) ??
    providers[0];
  const effectiveProviderId = effectiveProvider?.id ?? null;
  const effectiveModel =
    effectiveProvider?.models.includes(selectedModel ?? "")
      ? selectedModel
      : effectiveProvider?.models[0] ?? null;
  const currentConversation = conversations.find(
    (conversation) => conversation.id === currentConversationId,
  );
  const currentAssistant =
    assistants.find(
      (assistant) =>
        assistant.id ===
        (currentConversation?.assistant_id ?? currentAssistantId ?? null),
    ) ?? null;
  const hasConversation = !!currentConversationId;
  const title = hasConversation
    ? currentConversation?.title.trim() || t("新对话", "New Conversation")
    : "Private Talk";
  const subtitle = hasConversation
    ? [currentAssistant?.name, effectiveModel ?? effectiveProvider?.name ?? t("选择模型", "Choose a model")]
        .filter(Boolean)
        .join(" · ")
    : providers.length > 0
      ? t("一切都只保留在当前设备。", "Everything stays on this device.")
      : t("先添加服务商，再开始使用。", "Add a provider to begin.");

  return (
    <div className={`pt-chat pt-chat--${layout}`}>
      {isPhone ? (
        <MobileChatHeader
          title={hasConversation ? title : t("新建聊天", "New Chat")}
          subtitle={hasConversation ? subtitle : t("私密、本地优先的对话", "Private, on-device threads")}
          canGoBack={hasConversation}
          onBack={handleBack}
          onOpenSettings={onOpenSettings}
        />
      ) : (
        <DesktopChatHeader
          title={title}
          subtitle={subtitle}
          providers={providers}
          currentProvider={effectiveProvider}
          selectedProviderId={effectiveProviderId}
          selectedModel={effectiveModel}
          onProviderChange={setSelectedProvider}
          onModelChange={setSelectedModel}
        />
      )}

      {isPhone && hasConversation ? (
        <ProviderSelectBar
          layout={layout}
          providers={providers}
          currentProvider={effectiveProvider}
          selectedProviderId={effectiveProviderId}
          selectedModel={effectiveModel}
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
                <ConversationStarterCard
                  assistants={assistants}
                  currentAssistant={currentAssistant}
                  currentAssistantId={currentAssistantId}
                  onSelectAssistant={selectAssistant}
                />
              ) : null}

              {messages.map((message) => (
                <MessageItem
                  key={message.id}
                  role={message.role}
                  content={message.content}
                  attachments={message.attachments}
                />
              ))}

              {isStreaming && streamingContent ? (
                <MessageItem
                  role="assistant"
                  content={streamingContent}
                  attachments={[]}
                  isStreaming
                />
              ) : null}

              {(isStreaming && !streamingContent) || isImageGenerating ? <TypingIndicator /> : null}
            </>
          ) : (
            <WelcomePanel
              assistants={assistants}
              currentAssistant={currentAssistant}
              currentAssistantId={currentAssistantId}
              hasProviders={providers.length > 0}
              onSelectAssistant={selectAssistant}
              onCreateConversation={onRequestNewConversation}
              onOpenSettings={onOpenSettings}
            />
          )}
        </div>
      </div>

      <ChatInput
        layout={layout}
        onSend={handleSend}
        onStop={api.stopGeneration}
        isBusy={isImageGenerating}
        showStop={isStreaming}
        canSendOverride={providers.length > 0 && !!effectiveProviderId && !!effectiveModel}
        imageEnabled={imageEnabled}
      />
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
  const dragRegionProps = { "data-tauri-drag-region": true } as const;

  return (
    <header
      className="pt-pane-header pt-pane-header--desktop pt-drag"
      {...dragRegionProps}
    >
      <div className="pt-pane-header__copy" {...dragRegionProps}>
        <p className="pt-pane-header__title" {...dragRegionProps}>
          {title}
        </p>
        <p className="pt-pane-header__subtitle" {...dragRegionProps}>
          {subtitle}
        </p>
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
  const { t } = useI18n();
  return (
    <header className="pt-pane-header pt-pane-header--mobile">
      {canGoBack ? (
        <button
          type="button"
          className="pt-icon-button"
          onClick={onBack}
          aria-label={t("返回", "Back")}
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
        aria-label={t("打开设置", "Open settings")}
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
  const { t } = useI18n();
  if (providers.length === 0) {
    return <span className="pt-status-pill">{t("没有服务商", "No provider")}</span>;
  }

  return (
    <div className={`pt-provider-controls${compact ? " is-compact" : ""}`}>
      <select
        value={selectedProviderId ?? ""}
        onChange={(event) => onProviderChange(event.target.value)}
        className="pt-select"
        aria-label={t("服务商", "Provider")}
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
          aria-label={t("模型", "Model")}
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
  assistants,
  currentAssistant,
  currentAssistantId,
  hasProviders,
  onSelectAssistant,
  onCreateConversation,
  onOpenSettings,
}: {
  assistants: Assistant[];
  currentAssistant: Assistant | null;
  currentAssistantId: string | null;
  hasProviders: boolean;
  onSelectAssistant: (id: string | null) => void | Promise<void>;
  onCreateConversation: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="pt-welcome">
      <div className="pt-welcome__icon">
        {hasProviders ? <MessageSquarePlus size={28} /> : <Sparkles size={28} />}
      </div>
      <h2 className="pt-welcome__title">
        {hasProviders
          ? t("开始一段私密对话", "Start a private conversation")
          : t("添加一个模型服务商", "Add a model provider")}
      </h2>
      <p className="pt-welcome__copy">
        {hasProviders
          ? t(
              "创建一个线程，你的下一条消息会成为这段对话的第一轮。",
              "Create a thread and your next message becomes the first turn.",
            )
          : t(
              "Private Talk 会把对话保留在本地，但在发送消息前仍然需要你信任的模型端点。",
              "Private Talk keeps conversations local, but it still needs an endpoint you trust before it can send messages.",
            )}
      </p>
      <div className="pt-welcome__actions">
        {hasProviders ? (
          <>
            <AssistantSelector
              assistants={assistants}
              currentAssistant={currentAssistant}
              currentAssistantId={currentAssistantId}
              onSelectAssistant={onSelectAssistant}
            />
            <button type="button" className="pt-btn pt-btn--primary" onClick={onCreateConversation}>
              {t("新建聊天", "New Chat")}
            </button>
          </>
        ) : (
          <button type="button" className="pt-btn pt-btn--primary" onClick={onOpenSettings}>
            {t("打开设置", "Open Settings")}
          </button>
        )}
      </div>
    </section>
  );
}

function ConversationStarterCard({
  assistants,
  currentAssistant,
  currentAssistantId,
  onSelectAssistant,
}: {
  assistants: Assistant[];
  currentAssistant: Assistant | null;
  currentAssistantId: string | null;
  onSelectAssistant: (id: string | null) => void | Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <section className="pt-helper-card">
      <div className="pt-helper-card__icon">
        <MessageSquarePlus size={20} />
      </div>
      <div>
        <p className="pt-helper-card__title">{t("从任意问题开始", "Ask anything to begin")}</p>
        <p className="pt-helper-card__copy">
          {t(
            "你的下一条消息会成为这段对话的第一轮。",
            "Your next message becomes the first turn in this conversation.",
          )}
        </p>
        <AssistantSelector
          assistants={assistants}
          currentAssistant={currentAssistant}
          currentAssistantId={currentAssistantId}
          onSelectAssistant={onSelectAssistant}
          compact
        />
      </div>
    </section>
  );
}

function AssistantSelector({
  assistants,
  currentAssistant,
  currentAssistantId,
  onSelectAssistant,
  compact = false,
}: {
  assistants: Assistant[];
  currentAssistant: Assistant | null;
  currentAssistantId: string | null;
  onSelectAssistant: (id: string | null) => void | Promise<void>;
  compact?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className={`pt-assistant-inline${compact ? " is-compact" : ""}`}>
      <div className="pt-assistant-inline__header">
        <span className="pt-assistant-inline__label">
          {t("会话助手", "Conversation Assistant")}
        </span>
        {currentAssistant?.is_preset ? (
          <span className="pt-badge">{t("预设", "Preset")}</span>
        ) : null}
      </div>

      <select
        className="pt-select"
        value={currentAssistantId ?? "__free__"}
        onChange={(event) =>
          void onSelectAssistant(
            event.target.value === "__free__" ? null : event.target.value,
          )
        }
        aria-label={t("选择会话助手", "Choose conversation assistant")}
      >
        <option value="__free__">{t("自由对话", "Free Chat")}</option>
        {assistants.map((assistant) => (
          <option key={assistant.id} value={assistant.id}>
            {assistant.name}
          </option>
        ))}
      </select>

      <p className="pt-assistant-inline__detail">
        {currentAssistant?.description ||
          t(
            "不绑定额外系统提示词，按当前全局助手偏好回复。",
            "No extra system prompt is attached. Replies follow the current global assistant defaults.",
          )}
      </p>
    </div>
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
