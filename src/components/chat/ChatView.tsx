import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  MessageSquarePlus,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n";
import {
  getProviderModelsForPurpose,
  getProvidersForPurpose,
} from "../../lib/providerModels";
import * as api from "../../lib/tauri";
import type {
  Attachment,
  Assistant,
  Message as ChatMessageRecord,
  MessageResendPayload,
  ProviderModelRegistry,
  Provider,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload,
} from "../../lib/types";
import { useAppStore } from "../../stores/appStore";
import type { LayoutMode } from "../layout/useLayoutMode";
import {
  ChatInput,
  type ChatInputDraft,
  type ChatInputSubmission,
} from "./ChatInput";
import { MessageItem } from "./MessageItem";

interface ChatViewProps {
  layout: LayoutMode;
  onBack?: () => void;
  onOpenSettings: () => void;
  onRequestNewConversation: () => void;
}

type Unlisten = () => void;
const EMPTY_ATTACHMENTS: Attachment[] = [];

function createEmptyDraft(): ChatInputDraft {
  return {
    content: "",
    mode: "chat",
    referenceImage: null,
    attachments: [],
  };
}

function stripImagePrefix(value: string): string {
  return value.replace(/^\/img\b\s*/iu, "").replace(/^🖼\s*/u, "").trim();
}

function optimisticAttachmentType(mimeType: string): string {
  if (mimeType === "application/pdf") {
    return "pdf";
  }
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return "text_file";
  }
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  return "file";
}

function looksLikeAttachmentSummary(value: string, attachmentCount: number): boolean {
  const trimmed = value.trim();
  if (!trimmed || attachmentCount === 0) {
    return false;
  }

  if (attachmentCount === 1) {
    return /^已附加文件：.+$/u.test(trimmed) || /^Attached file: .+$/iu.test(trimmed);
  }

  return /^已附加 \d+ 个文件$/u.test(trimmed) || /^Attached \d+ files?$/iu.test(trimmed);
}

function normalizeStoredUserInput(
  message: ChatMessageRecord,
  payload: MessageResendPayload,
): string {
  let rawContent: string;
  if (payload.raw_content.trim()) {
    rawContent = payload.raw_content;
  } else if (message.raw_content?.trim()) {
    rawContent = message.raw_content;
  } else {
    rawContent = message.content;
  }

  if (
    payload.attachments_upload.length > 0 &&
    looksLikeAttachmentSummary(rawContent, payload.attachments_upload.length)
  ) {
    return "";
  }

  return rawContent;
}

function isStoredImageRequest(rawContent: string, displayContent: string): boolean {
  const candidate = rawContent.trim() || displayContent.trim();
  return candidate.startsWith("/img") || candidate.startsWith("🖼");
}

function buildSubmissionFromHistoryMessage(
  message: ChatMessageRecord,
  payload: MessageResendPayload,
): ChatInputSubmission {
  const rawContent = normalizeStoredUserInput(message, payload);
  if (isStoredImageRequest(rawContent, message.content)) {
    const referenceAttachment =
      payload.attachments_upload.find((attachment) => attachment.mime_type.startsWith("image/")) ??
      null;

    return {
      content: stripImagePrefix(rawContent || message.content),
      mode: "image",
      referenceImage: referenceAttachment
        ? {
            name: referenceAttachment.file_name,
            mimeType: referenceAttachment.mime_type,
            base64: referenceAttachment.data_base64,
          }
        : null,
      attachments: referenceAttachment
        ? payload.attachments_upload.filter((attachment) => attachment !== referenceAttachment)
        : payload.attachments_upload,
    };
  }

  return {
    content: rawContent,
    mode: "chat",
    referenceImage: null,
    attachments: payload.attachments_upload,
  };
}

function draftFromSubmission(submission: ChatInputSubmission): ChatInputDraft {
  return {
    content: submission.content,
    mode: submission.mode,
    referenceImage: submission.referenceImage,
    attachments: submission.attachments,
  };
}

export function ChatView({
  layout,
  onBack,
  onOpenSettings,
  onRequestNewConversation,
}: ChatViewProps) {
  const { t } = useI18n();
  const messages = useAppStore((state) => state.messages);
  const conversations = useAppStore((state) => state.conversations);
  const currentConversationId = useAppStore(
    (state) => state.currentConversationId,
  );
  const currentAssistantId = useAppStore((state) => state.currentAssistantId);
  const isStreaming = useAppStore((state) => state.isStreaming);
  const setStreaming = useAppStore((state) => state.setStreaming);
  const addMessage = useAppStore((state) => state.addMessage);
  const selectedProviderId = useAppStore((state) => state.selectedProviderId);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const providers = useAppStore((state) => state.providers);
  const providerModelRegistry = useAppStore(
    (state) => state.providerModelRegistry,
  );
  const assistants = useAppStore((state) => state.assistants);
  const imageGenConfig = useAppStore((state) => state.imageGenConfig);
  const createConversation = useAppStore((state) => state.createConversation);
  const selectAssistant = useAppStore((state) => state.selectAssistant);
  const openSettings = useAppStore((state) => state.openSettings);
  const loadMessages = useAppStore((state) => state.loadMessages);
  const loadConversations = useAppStore((state) => state.loadConversations);
  const setSelectedProvider = useAppStore(
    (state) => state.setSelectedProvider,
  );
  const setSelectedModel = useAppStore((state) => state.setSelectedModel);

  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const isPhone = layout === "phone";
  const [isImageGenerating, setIsImageGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [composerDraft, setComposerDraft] = useState<ChatInputDraft | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [messageAction, setMessageAction] = useState<{
    messageId: string;
    kind: "edit" | "retry" | "delete";
  } | null>(null);
  const imageEnabled =
    imageGenConfig.enabled &&
    imageGenConfig.provider_id.trim().length > 0 &&
    imageGenConfig.model.trim().length > 0;
  const textProviders = getProvidersForPurpose(
    providers,
    providerModelRegistry,
    "chat",
  );
  const hasTextProviders = textProviders.length > 0;

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

  function scheduleAutoScroll(): void {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const element = scrollRef.current;
      if (!element || !autoScrollRef.current) {
        return;
      }

      element.scrollTop = element.scrollHeight;
    });
  }

  useEffect(() => {
    if (!autoScrollRef.current || !scrollRef.current) {
      return;
    }

    scheduleAutoScroll();
  }, [messages, streamingContent]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (textProviders.length === 0) {
      return;
    }

    const fallbackProvider =
      textProviders.find((provider) => provider.is_default) ?? textProviders[0];

    if (!selectedProviderId) {
      setSelectedProvider(fallbackProvider.id);
      return;
    }

    const activeProvider =
      textProviders.find((provider) => provider.id === selectedProviderId) ?? null;

    if (!activeProvider) {
      setSelectedProvider(fallbackProvider.id);
      return;
    }

    const availableModels = getProviderModelsForPurpose(
      activeProvider,
      providerModelRegistry,
      "chat",
    );

    if (!selectedModel || !availableModels.includes(selectedModel)) {
      const nextModel = availableModels[0] ?? null;
      if (nextModel) {
        setSelectedModel(nextModel);
      }
    }
  }, [
    providerModelRegistry,
    selectedModel,
    selectedProviderId,
    setSelectedModel,
    setSelectedProvider,
    textProviders,
  ]);

  useEffect(() => {
    setStreamingContent("");
    setIsImageGenerating(false);
    autoScrollRef.current = true;
    setEditingMessageId(null);
    setMessageAction(null);
    setComposerDraft(createEmptyDraft());
  }, [currentConversationId]);

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
        setStreamingContent((current) => current + event.payload.content);
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
        setStreamingContent("");
        autoScrollRef.current = true;
      }),
      listen<StreamErrorPayload>("chat-stream-error", (event) => {
        if (!matchesConversation(event.payload)) {
          return;
        }

        setStreaming(false);
        setStreamingContent("");
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

  function clearMessageRewriteState(): void {
    setEditingMessageId(null);
    setComposerDraft(createEmptyDraft());
  }

  async function truncateConversationAtMessage(messageId: string): Promise<void> {
    if (!currentConversationId) {
      return;
    }

    await api.truncateConversationFromMessage(messageId);
    await Promise.all([
      loadMessages(currentConversationId),
      loadConversations(),
    ]);
  }

  async function loadSubmissionFromMessage(
    message: ChatMessageRecord,
  ): Promise<ChatInputSubmission> {
    const payload = await api.getMessageResendPayload(message.id);
    return buildSubmissionFromHistoryMessage(message, payload);
  }

  async function performSend(submission: ChatInputSubmission): Promise<void> {
    const rawContent = submission.content.trim();
    const isImageRequest = submission.mode === "image" || rawContent.startsWith("/img");
    const fallbackProvider =
      textProviders.find((provider) => provider.is_default) ?? textProviders[0];
    const activeProvider =
      textProviders.find((provider) => provider.id === selectedProviderId) ?? fallbackProvider;
    const activeProviderId = activeProvider?.id ?? null;
    const availableTextModels = activeProvider
      ? getProviderModelsForPurpose(activeProvider, providerModelRegistry, "chat")
      : [];
    const activeModel =
      availableTextModels.includes(selectedModel ?? "")
        ? selectedModel
        : availableTextModels[0] ?? null;

    if (isImageRequest && !imageEnabled) {
      const conversationId = currentConversationId ?? (await createConversation());
      addMessage({
        id: crypto.randomUUID(),
        conversation_id: conversationId,
        role: "assistant",
        content: t(
          "图片生成当前还没有配置完成。先去“模型与能力”里启用图片路由并选择服务商，再继续发送 /img 请求。",
          "Image generation is not configured yet. Enable image routing in Models & Capabilities and choose a provider before sending /img requests.",
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
      file_type: optimisticAttachmentType(attachment.mime_type),
      file_name: attachment.file_name,
      file_path: "",
      mime_type: attachment.mime_type,
      file_size: Math.round((attachment.data_base64.length * 3) / 4),
      created_at: new Date().toISOString(),
    }));
    const normalizedImagePrompt =
      rawContent ||
      t("按参考图生成一张图片", "Generate an image from the reference image");
    const fallbackReferenceFromAttachments = submission.attachments.find((attachment) =>
      attachment.mime_type.startsWith("image/"),
    );
    const effectiveReferenceImage =
      submission.referenceImage ??
      (fallbackReferenceFromAttachments
        ? {
            name: fallbackReferenceFromAttachments.file_name,
            mimeType: fallbackReferenceFromAttachments.mime_type,
            base64: fallbackReferenceFromAttachments.data_base64,
          }
        : null);
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

    setStreamingContent("");
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
        setStreamingContent("");
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
      setStreamingContent("");
      const rawMessage =
        error instanceof Error
          ? error.message.trim()
          : typeof error === "string"
            ? error.trim()
            : "";
      const fallback = t(
        "请求失败，请检查当前服务商配置。",
        "Request failed. Check the current provider configuration.",
      );
      const content = rawMessage || fallback;
      addMessage({
        id: crypto.randomUUID(),
        conversation_id: conversationId,
        role: "assistant",
        content,
        attachments: [],
        created_at: new Date().toISOString(),
      });
      console.error("Send failed:", error);
    }
  }

  async function handleSend(submission: ChatInputSubmission): Promise<void> {
    if (editingMessageId) {
      await truncateConversationAtMessage(editingMessageId);
      clearMessageRewriteState();
    }

    await performSend(submission);
  }

  async function handleEditMessage(message: ChatMessageRecord): Promise<void> {
    setMessageAction({ messageId: message.id, kind: "edit" });
    try {
      const submission = await loadSubmissionFromMessage(message);
      setEditingMessageId(message.id);
      setComposerDraft(draftFromSubmission(submission));
    } catch (error) {
      console.error("Failed to prepare message edit:", error);
    } finally {
      setMessageAction(null);
    }
  }

  async function handleRetryMessage(message: ChatMessageRecord): Promise<void> {
    setMessageAction({ messageId: message.id, kind: "retry" });
    try {
      const submission = await loadSubmissionFromMessage(message);
      await truncateConversationAtMessage(message.id);
      clearMessageRewriteState();
      await performSend(submission);
    } catch (error) {
      console.error("Failed to retry message:", error);
    } finally {
      setMessageAction(null);
    }
  }

  async function handleDeleteMessage(message: ChatMessageRecord): Promise<void> {
    const confirmed = window.confirm(
      t(
        "删除这条消息后，它以及后面的所有输入和回复都会一起删除。确定继续吗？",
        "Deleting this message also removes everything after it. Continue?",
      ),
    );
    if (!confirmed) {
      return;
    }

    setMessageAction({ messageId: message.id, kind: "delete" });
    try {
      await truncateConversationAtMessage(message.id);
      clearMessageRewriteState();
    } catch (error) {
      console.error("Failed to delete message:", error);
    } finally {
      setMessageAction(null);
    }
  }

  function handleBack(): void {
    if (isStreaming) {
      void api.stopGeneration();
    }
    onBack?.();
  }

  const currentProvider = textProviders.find(
    (provider) => provider.id === selectedProviderId,
  );
  const effectiveProvider =
    currentProvider ??
    textProviders.find((provider) => provider.is_default) ??
    textProviders[0];
  const effectiveProviderId = effectiveProvider?.id ?? null;
  const effectiveProviderModels = effectiveProvider
    ? getProviderModelsForPurpose(effectiveProvider, providerModelRegistry, "chat")
    : [];
  const effectiveModel =
    effectiveProviderModels.includes(selectedModel ?? "")
      ? selectedModel
      : effectiveProviderModels[0] ?? null;
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
  const messageActionsDisabled = !!messageAction || isStreaming || isImageGenerating;
  const title = hasConversation
    ? currentConversation?.title.trim() || t("新对话", "New Conversation")
    : "Private Talk";
  const subtitle = hasConversation
    ? [currentAssistant?.name, effectiveModel ?? effectiveProvider?.name ?? t("选择模型", "Choose a model")]
        .filter(Boolean)
        .join(" · ")
    : hasTextProviders
      ? t("一切都只保留在当前设备。", "Everything stays on this device.")
      : providers.length > 0
        ? t(
            "先去设置里把一个模型标记成文本用途。",
            "Mark one model as text in Settings before you start.",
          )
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
          providers={textProviders}
          currentProvider={effectiveProvider}
          selectedProviderId={effectiveProviderId}
          selectedModel={effectiveModel}
          providerModelRegistry={providerModelRegistry}
          onProviderChange={setSelectedProvider}
          onModelChange={setSelectedModel}
        />
      )}

      {isPhone && hasConversation ? (
        <ProviderSelectBar
          layout={layout}
          providers={textProviders}
          currentProvider={effectiveProvider}
          selectedProviderId={effectiveProviderId}
          selectedModel={effectiveModel}
          providerModelRegistry={providerModelRegistry}
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
                  onEdit={
                    message.role === "user"
                      ? () => void handleEditMessage(message)
                      : null
                  }
                  onRetry={
                    message.role === "user"
                      ? () => void handleRetryMessage(message)
                      : null
                  }
                  onDelete={
                    message.role === "user"
                      ? () => void handleDeleteMessage(message)
                      : null
                  }
                  actionsDisabled={messageActionsDisabled}
                  pendingAction={
                    messageAction?.messageId === message.id ? messageAction.kind : null
                  }
                />
              ))}

              {isStreaming && streamingContent ? (
                <MessageItem
                  role="assistant"
                  content={streamingContent}
                  attachments={EMPTY_ATTACHMENTS}
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
              hasTextProviders={hasTextProviders}
              onSelectAssistant={selectAssistant}
              onCreateConversation={onRequestNewConversation}
              onOpenSettings={
                hasTextProviders
                  ? onOpenSettings
                  : () =>
                      openSettings(
                        "models",
                        providers.length === 0 ? "create-provider" : "repair-chat",
                      )
              }
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
        canSendOverride={!!effectiveProviderId && !!effectiveModel}
        imageEnabled={imageEnabled}
        draft={composerDraft}
        editingLabel={
          editingMessageId
            ? t(
                "编辑后会覆盖后续对话",
                "Sending replaces the later thread",
              )
            : null
        }
        onCancelEdit={editingMessageId ? clearMessageRewriteState : undefined}
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
  providerModelRegistry,
  onProviderChange,
  onModelChange,
}: {
  title: string;
  subtitle: string;
  providers: Provider[];
  currentProvider: Provider | undefined;
  selectedProviderId: string | null;
  selectedModel: string | null;
  providerModelRegistry: ProviderModelRegistry;
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
          providerModelRegistry={providerModelRegistry}
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
  providerModelRegistry,
  onProviderChange,
  onModelChange,
}: {
  layout: LayoutMode;
  providers: Provider[];
  currentProvider: Provider | undefined;
  selectedProviderId: string | null;
  selectedModel: string | null;
  providerModelRegistry: ProviderModelRegistry;
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
        providerModelRegistry={providerModelRegistry}
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
  providerModelRegistry,
  onProviderChange,
  onModelChange,
  compact = false,
}: {
  providers: Provider[];
  currentProvider: Provider | undefined;
  selectedProviderId: string | null;
  selectedModel: string | null;
  providerModelRegistry: ProviderModelRegistry;
  onProviderChange: (id: string) => void;
  onModelChange: (model: string) => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  if (providers.length === 0) {
    return <span className="pt-status-pill">{t("没有文本模型", "No text model")}</span>;
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
          {getProviderModelsForPurpose(
            currentProvider,
            providerModelRegistry,
            "chat",
          ).map((model) => (
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
  hasTextProviders,
  onSelectAssistant,
  onCreateConversation,
  onOpenSettings,
}: {
  assistants: Assistant[];
  currentAssistant: Assistant | null;
  currentAssistantId: string | null;
  hasTextProviders: boolean;
  onSelectAssistant: (id: string | null) => void | Promise<void>;
  onCreateConversation: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="pt-welcome">
      <div className="pt-welcome__icon">
        {hasTextProviders ? <MessageSquarePlus size={28} /> : <Sparkles size={28} />}
      </div>
      <h2 className="pt-welcome__title">
        {hasTextProviders
          ? t("开始一段私密对话", "Start a private conversation")
          : t("配置一个文本模型", "Configure a text model")}
      </h2>
      <p className="pt-welcome__copy">
        {hasTextProviders
          ? t(
              "创建一个线程，你的下一条消息会成为这段对话的第一轮。",
              "Create a thread and your next message becomes the first turn.",
            )
          : t(
              "先到“模型与能力”里添加服务商，并把至少一个模型标记为文本用途，聊天页才会出现可用路由。",
              "Go to Models & Capabilities, add a provider, and mark at least one model as text before chat routing becomes available.",
            )}
      </p>
      <div className="pt-welcome__actions">
        {hasTextProviders ? (
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
