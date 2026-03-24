import { useEffect, useRef, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown, Settings, ArrowDown, AlertCircle, ChevronUp, SlidersHorizontal, Bot, Upload, Loader2 } from "lucide-react";
import appIconUrl from "@/assets/app-icon.png";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { useAppStore } from "../../stores/appStore";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useMobileKeyboardInset } from "@/hooks/useMobileKeyboardInset";
import { MobileMenuButton } from "@/components/layout/MobileMenuButton";
import { MessageItem } from "./MessageItem";
import { ChatInput } from "./ChatInput";
import * as api from "../../lib/tauri";
import type {
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload,
} from "../../lib/types";

export function ChatView() {
  const navigate = useNavigate();
  const { t, tField } = useI18n();
  const isMobile = useIsMobile();
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const {
    messages,
    conversations,
    currentConversationId,
    currentAssistantId,
    assistants,
    isStreaming,
    streamingConversationId,
    streamingContent,
    setStreaming,
    appendStreamingContent,
    clearStreamingContent,
    addMessage,
    selectedProviderId,
    selectedModel,
    providers,
    createConversation,
    selectAssistant,
    setSelectedProvider,
    setSelectedModel,
    generateTitle,
    deleteMessagesFrom,
    streamingError,
    setStreamingError,
    voices,
    loadMessages,
  } = useAppStore();

  const currentConversation = conversations.find((c) => c.id === currentConversationId);
  const isOpenClawConversation = !!currentConversation?.openclaw_instance_id;

  // Only show streaming UI if the current conversation is the one streaming
  const isCurrentStreaming = isStreaming && streamingConversationId === currentConversationId;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [contextSize, setContextSize] = useState(20);
  const [imageGenPhase, setImageGenPhase] = useState<string | null>(null);
  const [imageGenStartTime, setImageGenStartTime] = useState<number | null>(null);
  const [mobileInputHeight, setMobileInputHeight] = useState(0);
  const mobileInputRef = useRef<HTMLDivElement>(null);
  const { keyboardInset: mobileKeyboardInset } = useMobileKeyboardInset(isMobile);

  const currentAssistant = assistants.find((assistant) => assistant.id === currentAssistantId);
  const currentProvider = providers.find((provider) => provider.id === selectedProviderId);
  const systemPromptSnapshot = messages.find((message) => message.role === "system")?.content ?? null;
  const ttsEnabled = isOpenClawConversation
    ? voices.length > 0
    : (currentAssistant?.tts_enabled ?? false);
  const canSelectAssistant = !messages.some((message) => message.role !== "system");

  // On mobile: auto-create a new conversation if providers exist but no conversation is active
  const hasAutoCreatedRef = useRef(false);
  useEffect(() => {
    if (isMobile && providers.length > 0 && !currentConversationId && !hasAutoCreatedRef.current) {
      hasAutoCreatedRef.current = true;
      void createConversation();
    }
  }, [isMobile, providers.length, currentConversationId, createConversation]);

  const checkIfNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 80;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    isNearBottomRef.current = nearBottom;
    setShowScrollDown(!nearBottom);
  }, []);

  const scrollToBottom = useCallback((instant?: boolean) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (instant) {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, []);

  // Auto-scroll during streaming — use instant scroll to avoid animation queue-up
  const scrollRafRef = useRef<number>(0);
  useEffect(() => {
    if (!isNearBottomRef.current) return;
    if (isCurrentStreaming && streamingContent) {
      // Use rAF to coalesce scroll updates within the same frame
      if (!scrollRafRef.current) {
        scrollRafRef.current = requestAnimationFrame(() => {
          scrollRafRef.current = 0;
          const el = scrollContainerRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    } else {
      // Non-streaming message changes: smooth scroll
      scrollToBottom();
    }
  }, [messages, streamingContent, isCurrentStreaming, scrollToBottom]);

  // Cleanup scroll rAF on unmount
  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setMobileInputHeight(0);
      return;
    }

    const inputElement = mobileInputRef.current;
    if (!inputElement || typeof ResizeObserver === "undefined") return;

    const updateMobileInputHeight = () => {
      setMobileInputHeight(inputElement.getBoundingClientRect().height);
    };

    updateMobileInputHeight();

    const observer = new ResizeObserver(() => {
      updateMobileInputHeight();
    });
    observer.observe(inputElement);

    return () => {
      observer.disconnect();
    };
  }, [isMobile]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    let rafId = 0;
    const keepBottomContentVisible = () => {
      if (!isNearBottomRef.current) return;
      if (rafId !== 0) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        scrollToBottom(true);
      });
    };

    viewport.addEventListener("resize", keepBottomContentVisible);
    viewport.addEventListener("scroll", keepBottomContentVisible);

    return () => {
      viewport.removeEventListener("resize", keepBottomContentVisible);
      viewport.removeEventListener("scroll", keepBottomContentVisible);
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [scrollToBottom]);

  // When a new user message is sent, always scroll to bottom
  const prevMessageCountRef = useRef(messages.length);
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    if (messages.length > prevCount) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === "user") {
        isNearBottomRef.current = true;
        setShowScrollDown(false);
        scrollToBottom(true);
      }
    }
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const load = async () => {
      const hotWindow = await api.getSetting("context_hot_size");
      setContextSize(hotWindow ? Number(hotWindow) : 20);
    };
    void load();
  }, []);

  // On mount (or when conversation changes), clear stale streaming state.
  // This handles the case where chat-stream-done fired while ChatView was
  // unmounted (e.g. user navigated to Settings and back), so the event
  // listener missed it and isStreaming was never cleared.
  useEffect(() => {
    // Always clear image-gen placeholder when switching conversations —
    // it is local UI state that does not belong to the new conversation.
    setImageGenPhase(null);
    setImageGenStartTime(null);

    if (
      isStreaming &&
      streamingConversationId === currentConversationId &&
      currentConversationId
    ) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        setStreaming(false);
        clearStreamingContent();
      }
    }
  }, [currentConversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Buffer stream chunks and flush once per animation frame for smooth rendering
  const chunkBufferRef = useRef("");
  const rafIdRef = useRef<number>(0);

  useEffect(() => {
    const flushBuffer = () => {
      rafIdRef.current = 0;
      if (chunkBufferRef.current) {
        const buffered = chunkBufferRef.current;
        chunkBufferRef.current = "";
        appendStreamingContent(buffered);
      }
    };

    const unlistenChunk = listen<StreamChunkPayload>("chat-stream-chunk", (event) => {
      if (event.payload.conversation_id === currentConversationId) {
        chunkBufferRef.current += event.payload.content;
        if (!rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(flushBuffer);
        }
      }
    });

    const unlistenDone = listen<StreamDonePayload>("chat-stream-done", (event) => {
      const isCurrentConv = event.payload.conversation_id === currentConversationId;
      // Always clear streaming flag (stream finished regardless of which conversation we're viewing)
      setStreaming(false);
      if (isCurrentConv) {
        // Cancel any pending flush and clear buffer
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = 0;
          chunkBufferRef.current = "";
        }
        addMessage({
          id: event.payload.message_id,
          conversation_id: event.payload.conversation_id,
          role: "assistant",
          content: event.payload.full_content,
          is_pinned: false,
          created_at: new Date().toISOString(),
          attachments: [],
        });
        clearStreamingContent();
      }
    });

    const unlistenError = listen<StreamErrorPayload>("chat-stream-error", (event) => {
      const isCurrentConv = event.payload.conversation_id === currentConversationId;
      // Always clear streaming flag
      setStreaming(false);
      if (isCurrentConv) {
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = 0;
          chunkBufferRef.current = "";
        }
        clearStreamingContent();
        setStreamingError(event.payload.error);
      }
      console.error("Stream error:", event.payload.error);
    });

    const unlistenImageGen = listen<{
      conversation_id: string;
      phase: string;
      message?: string;
    }>("image-gen-status", (event) => {
      if (event.payload.conversation_id !== currentConversationId) return;
      const phase = event.payload.phase;
      if (phase === "done") {
        setImageGenPhase(null);
        setImageGenStartTime(null);
        setStreaming(false);
        // Reload messages to get assistant message with image attachments
        if (currentConversationId) void loadMessages(currentConversationId);
      } else if (phase === "failed") {
        setImageGenPhase(null);
        setImageGenStartTime(null);
        setStreaming(false);
        setStreamingError(event.payload.message ?? "图片生成失败。\nImage generation failed.");
      } else {
        setImageGenPhase(phase);
        if (phase === "generating") {
          setImageGenStartTime(Date.now());
        }
      }
    });

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
      chunkBufferRef.current = "";
      unlistenChunk.then((fn) => fn());
      unlistenDone.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenImageGen.then((fn) => fn());
    };
  }, [
    currentConversationId,
    appendStreamingContent,
    setStreaming,
    addMessage,
    clearStreamingContent,
    setStreamingError,
    loadMessages,
  ]);

  const handleDelete = async (messageId: string) => {
    await deleteMessagesFrom(messageId);
  };

  // Helper: send via the correct API based on conversation type
  const sendViaCorrectApi = async (conversationId: string, content: string, userMsgId: string, attachmentJsons?: string[]) => {
    if (isOpenClawConversation) {
      await api.sendOpenClawMessage(conversationId, content, userMsgId, attachmentJsons);
    } else {
      await api.sendMessage(conversationId, content, selectedProviderId!, selectedModel!, userMsgId, attachmentJsons);
    }
  };

  const handleRetry = async (messageId: string, role: "user" | "assistant") => {
    if (!currentConversationId) return;
    if (!isOpenClawConversation && (!selectedProviderId || !selectedModel)) return;

    if (role === "user") {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return;
      const content = msg.content;
      const originalAttachments = msg.attachments ?? [];
      await deleteMessagesFrom(messageId);
      const retryMsgId = crypto.randomUUID();
      addMessage({
        id: retryMsgId,
        conversation_id: currentConversationId,
        role: "user",
        content,
        is_pinned: false,
        created_at: new Date().toISOString(),
        attachments: originalAttachments,
      });
      setStreaming(true, currentConversationId);
      clearStreamingContent();
      setStreamingError("");
      try {
        // Re-send with original attachments
        const attachmentJsons = originalAttachments.map((a) => JSON.stringify(a));
        await sendViaCorrectApi(currentConversationId, content, retryMsgId, attachmentJsons.length > 0 ? attachmentJsons : undefined);
      } catch (error) {
        setStreaming(false);
        clearStreamingContent();
        setStreamingError(String(error));
        console.error("Retry failed:", error);
      }
    } else {
      const idx = messages.findIndex((m) => m.id === messageId);
      const prevUserMsg = messages
        .slice(0, idx)
        .reverse()
        .find((m) => m.role === "user");
      if (!prevUserMsg) return;
      const userContent = prevUserMsg.content;
      const originalAttachments = prevUserMsg.attachments ?? [];
      await deleteMessagesFrom(messageId);
      const retryUserMsgId = crypto.randomUUID();
      setStreaming(true, currentConversationId);
      clearStreamingContent();
      setStreamingError("");
      try {
        const attachmentJsons = originalAttachments.map((a) => JSON.stringify(a));
        await sendViaCorrectApi(currentConversationId, userContent, retryUserMsgId, attachmentJsons.length > 0 ? attachmentJsons : undefined);
      } catch (error) {
        setStreaming(false);
        clearStreamingContent();
        setStreamingError(String(error));
        console.error("Retry failed:", error);
      }
    }
  };

  const handleEditSubmit = async (messageId: string, newContent: string) => {
    if (!currentConversationId) return;
    if (!isOpenClawConversation && (!selectedProviderId || !selectedModel)) return;
    const originalMsg = messages.find((m) => m.id === messageId);
    const originalAttachments = originalMsg?.attachments ?? [];
    await deleteMessagesFrom(messageId);
    const editMsgId = crypto.randomUUID();
    addMessage({
      id: editMsgId,
      conversation_id: currentConversationId,
      role: "user",
      content: newContent,
      is_pinned: false,
      created_at: new Date().toISOString(),
      attachments: originalAttachments,
    });
    setStreaming(true, currentConversationId);
    clearStreamingContent();
    setStreamingError("");
    try {
      const attachmentJsons = originalAttachments.map((a) => JSON.stringify(a));
      await sendViaCorrectApi(currentConversationId, newContent, editMsgId, attachmentJsons.length > 0 ? attachmentJsons : undefined);
    } catch (error) {
      setStreaming(false);
      clearStreamingContent();
      setStreamingError(String(error));
      console.error("Edit+send failed:", error);
    }
  };

  const handleSend = async (content: string, attachmentJsons?: string[]) => {
    setMobileSettingsOpen(false);
    let conversationId = currentConversationId;
    let isNewConversation = false;

    // For OpenClaw conversations, we don't need provider/model
    const conv = conversationId
      ? conversations.find((c) => c.id === conversationId)
      : null;
    const isAcp = !!conv?.openclaw_instance_id;

    if (!isAcp && (!selectedProviderId || !selectedModel)) {
      console.error("No provider/model selected");
      return;
    }

    if (!conversationId) {
      conversationId = await createConversation();
      isNewConversation = true;
    }

    // Check if this is the first user message (for title generation)
    const isFirstMessage =
      isNewConversation ||
      messages.filter((m) => m.role === "user").length === 0;

    // Parse attachment metadata for local display
    const parsedAttachments = (attachmentJsons ?? []).map((json) => {
      const att = JSON.parse(json);
      return {
        id: att.id,
        message_id: "",
        file_type: att.file_type as "image" | "text_file" | "audio",
        file_name: att.file_name,
        file_path: att.file_path,
        mime_type: att.mime_type,
        file_size: att.file_size,
        created_at: new Date().toISOString(),
      };
    });

    const userMsgId = crypto.randomUUID();
    addMessage({
      id: userMsgId,
      conversation_id: conversationId,
      role: "user",
      content,
      is_pinned: false,
      created_at: new Date().toISOString(),
      attachments: parsedAttachments,
    });

    setStreaming(true, conversationId);
    clearStreamingContent();
    setStreamingError("");

    try {
      if (isAcp) {
        await api.sendOpenClawMessage(conversationId, content, userMsgId, attachmentJsons);
      } else {
        await api.sendMessage(conversationId, content, selectedProviderId!, selectedModel!, userMsgId, attachmentJsons);
      }
      // Auto-generate title after first message (only for local LLM)
      if (isFirstMessage && !isAcp) {
        void generateTitle(conversationId);
      }
    } catch (error) {
      setStreaming(false);
      clearStreamingContent();
      setStreamingError(String(error));
      console.error("Send failed:", error);
    }
  };

  const handleStop = () => {
    if (isOpenClawConversation && currentConversationId) {
      void api.stopOpenClawGeneration(currentConversationId);
    } else {
      void api.stopGeneration();
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      {/* Header bar */}
      <div className="flex h-12 items-center justify-between gap-3 border-b border-border bg-muted/30 px-4">
        {/* Left: Menu button + Assistant selector */}
        <div className="flex min-w-0 items-center gap-2">
          <MobileMenuButton />
          {isOpenClawConversation ? (
            <div className="flex h-7 items-center gap-2 rounded-md px-2">
              <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-600 text-[11px]">
                OpenClaw
              </Badge>
              <span className="truncate text-sm font-medium">
                {currentConversation?.title ?? "Agent"}
              </span>
            </div>
          ) : canSelectAssistant ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-2 bg-background/50 hover:bg-background"
                >
                  <span className="truncate text-sm">
                    {currentAssistant ? tField(currentAssistant.name, currentAssistant.name_en) : t("自由对话", "Free Chat")}
                  </span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem
                  onClick={() => void selectAssistant(null)}
                  className={cn(currentAssistantId === null && "bg-accent")}
                >
                  <span className="text-sm">{t("自由对话", "Free Chat")}</span>
                </DropdownMenuItem>
                {assistants.map((assistant) => (
                  <DropdownMenuItem
                    key={assistant.id}
                    onClick={() => void selectAssistant(assistant.id)}
                    className={cn(assistant.id === currentAssistantId && "bg-accent")}
                  >
                    <div className="flex-1">
                      <span className="text-sm">{tField(assistant.name, assistant.name_en)}</span>
                      {assistant.is_preset ? (
                        <span className="ml-2 text-xs text-primary">{t("预设", "Preset")}</span>
                      ) : null}
                    </div>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/assistants")}>
                  <Settings className="mr-2 h-4 w-4" />
                  {t("管理助手", "Manage assistants")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex h-7 items-center gap-2 rounded-md px-2 text-muted-foreground">
              <span className="truncate text-sm">
                {currentAssistant ? tField(currentAssistant.name, currentAssistant.name_en) : t("自由对话", "Free Chat")}
              </span>
            </div>
          )}
        </div>

        {/* Right: Desktop = inline controls, Mobile = gear toggle */}
        {isOpenClawConversation ? null : isMobile ? (
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8 shrink-0", mobileSettingsOpen && "bg-accent")}
            onClick={() => setMobileSettingsOpen((prev) => !prev)}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        ) : (
        <div className="flex items-center gap-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1.5">
                <Badge variant="secondary" className="bg-primary/20 text-primary text-[11px]">
                  {currentProvider?.name || t("选择服务商", "Provider")}
                </Badge>
                <span className="max-w-[120px] truncate font-mono text-xs text-muted-foreground lg:max-w-[200px]">
                  {selectedModel || t("未选择", "No model")}
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              {providers.length === 0 ? (
                <DropdownMenuItem disabled>
                  {t("未配置服务商", "No providers configured")}
                </DropdownMenuItem>
              ) : null}
              {providers.flatMap((provider) =>
                provider.models.map((model) => (
                  <DropdownMenuItem
                    key={`${provider.id}-${model}`}
                    onClick={() => {
                      setSelectedProvider(provider.id);
                      setSelectedModel(model);
                    }}
                  >
                    <span className="mr-2 text-xs text-muted-foreground">{provider.name}</span>
                    <span className="truncate font-mono text-sm">{model}</span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">{t("上下文", "Ctx")}</span>
            <Slider
              value={[contextSize]}
              onValueChange={([value]) => setContextSize(value)}
              onValueCommit={([value]) => {
                void api.setSetting("context_hot_size", String(value));
              }}
              min={5}
              max={100}
              step={1}
              className="w-20"
            />
            <span className="w-8 text-[11px] text-muted-foreground">{contextSize}</span>
          </div>
        </div>
        )}
      </div>

      {/* Mobile collapsible settings panel — overlays content */}
      {isMobile && mobileSettingsOpen && !isOpenClawConversation && (
        <div className="absolute left-0 right-0 z-30 flex flex-col gap-3 border-b border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur" style={{ top: 48 }}>
          <div className="flex items-center gap-3">
            <span className="shrink-0 text-xs text-muted-foreground">{t("模型", "Model")}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 min-w-0 flex-1 justify-between gap-1.5">
                  <span className="truncate text-xs">
                    {currentProvider?.name && selectedModel
                      ? `${currentProvider.name} / ${selectedModel}`
                      : t("未选择", "Not selected")}
                  </span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                {providers.length === 0 ? (
                  <DropdownMenuItem disabled>
                    {t("未配置服务商", "No providers configured")}
                  </DropdownMenuItem>
                ) : null}
                {providers.flatMap((provider) =>
                  provider.models.map((model) => (
                    <DropdownMenuItem
                      key={`${provider.id}-${model}`}
                      onClick={() => {
                        setSelectedProvider(provider.id);
                        setSelectedModel(model);
                      }}
                    >
                      <span className="mr-2 text-xs text-muted-foreground">{provider.name}</span>
                      <span className="truncate font-mono text-sm">{model}</span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex items-center gap-3">
            <span className="shrink-0 text-xs text-muted-foreground">{t("上下文", "Context")}</span>
            <Slider
              value={[contextSize]}
              onValueChange={([value]) => setContextSize(value)}
              onValueCommit={([value]) => {
                void api.setSetting("context_hot_size", String(value));
              }}
              min={5}
              max={100}
              step={1}
              className="flex-1"
            />
            <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">{contextSize}</span>
          </div>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollContainerRef}
          onScroll={checkIfNearBottom}
          className="h-full overflow-y-auto p-4"
          style={{
            willChange: "scroll-position",
            paddingBottom: isMobile ? `${mobileInputHeight + 16}px` : undefined,
          }}
        >
          <div className="mx-auto max-w-3xl space-y-6 pb-2">
            {!currentConversationId ? (
              <div className="flex min-h-[calc(100dvh-220px)] items-center justify-center">
                <div className="flex max-w-md flex-col items-center text-center px-6">
                  <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl">
                    <img src={appIconUrl} alt="Private Talk" className="h-16 w-16 rounded-2xl" />
                  </div>
                  <h2 className="text-xl font-semibold tracking-tight">Private Talk</h2>
                  {providers.length === 0 ? (
                    <>
                      <p className="mt-3 text-sm text-muted-foreground">
                        {t(
                          "开始之前，需要先配置一个 AI 服务商。",
                          "To get started, configure an AI provider first."
                        )}
                      </p>
                      <div className="mt-5 flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
                        <Button
                          className="sm:min-w-40"
                          onClick={() => navigate("/settings?section=providers")}
                        >
                          <Settings className="mr-2 h-4 w-4" />
                          {t("添加服务商", "Add Provider")}
                        </Button>
                        <Button
                          variant="outline"
                          className="sm:min-w-40"
                          onClick={() => navigate("/settings?section=data")}
                        >
                          <Upload className="mr-2 h-4 w-4" />
                          {t("导入配置", "Import Configuration")}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t(
                        "选择一个会话，或者新建会话开始聊天。",
                        "Select a conversation or create a new session to start chatting."
                      )}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <>
                {(systemPromptSnapshot ?? currentAssistant?.system_prompt) ? (
                  <SystemPromptPreview
                    assistantName={
                      currentAssistant
                        ? tField(currentAssistant.name, currentAssistant.name_en)
                        : t("会话快照", "Conversation Snapshot")
                    }
                    systemPrompt={systemPromptSnapshot ?? currentAssistant?.system_prompt ?? ""}
                    isPreset={currentAssistant?.is_preset ?? false}
                  />
                ) : null}
                {messages
                  .filter((message) => message.role !== "system")
                  .map((message) => (
                    <MessageItem
                      key={message.id}
                      role={message.role as "user" | "assistant"}
                      content={message.content}
                      showTts={ttsEnabled && message.role === "assistant"}
                      assistantId={currentAssistantId}
                      messageId={message.id}
                      isPinned={message.is_pinned}
                      attachments={message.attachments}
                      onRetry={handleRetry}
                      onDelete={handleDelete}
                      onEditSubmit={handleEditSubmit}
                    />
                  ))}
                {isCurrentStreaming && streamingContent ? (
                  <MessageItem role="assistant" content={streamingContent} isStreaming />
                ) : null}
                {isCurrentStreaming && !streamingContent && !imageGenPhase ? (
                  <div className="flex gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {[0, 1, 2].map((index) => (
                          <span
                            key={index}
                            className="h-1.5 w-1.5 rounded-full bg-primary"
                            style={{
                              animation: `typing-dot 1.4s ease-in-out ${index * 0.2}s infinite`,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                {imageGenPhase ? (
                  <div className="flex gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {imageGenPhase === "generating" ? (
                          <ImageGenProgressLabel startTime={imageGenStartTime} t={t} />
                        ) : (
                          t("正在保存...", "Saving...")
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
                {!isCurrentStreaming && streamingError ? (
                  <div className="flex gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/20">
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    </div>
                    <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-destructive/30 bg-destructive/10 px-4 py-3">
                      <p className="mb-1 text-xs font-medium text-destructive">
                        {t("请求失败", "Request Failed")}
                      </p>
                      <p className="whitespace-pre-wrap break-words font-mono text-xs text-destructive/80">
                        {streamingError}
                      </p>
                    </div>
                  </div>
                ) : null}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>
        </div>
        {showScrollDown ? (
          <Button
            variant="secondary"
            size="icon"
            className="absolute bottom-4 right-4 h-8 w-8 rounded-full shadow-md"
            style={
              isMobile
                ? { bottom: `${mobileInputHeight + mobileKeyboardInset + 16}px` }
                : undefined
            }
            onClick={() => {
              isNearBottomRef.current = true;
              setShowScrollDown(false);
              scrollToBottom();
            }}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {isMobile ? (
        <div
          ref={mobileInputRef}
          className="fixed inset-x-0 z-20 bg-background"
          style={{
            bottom: `${mobileKeyboardInset}px`,
            paddingLeft: "env(safe-area-inset-left, 0px)",
            paddingRight: "env(safe-area-inset-right, 0px)",
          }}
        >
          <ChatInput onSend={handleSend} onStop={handleStop} />
        </div>
      ) : (
        <ChatInput onSend={handleSend} onStop={handleStop} />
      )}
    </div>
  );
}

function SystemPromptPreview({
  assistantName,
  systemPrompt,
  isPreset,
}: {
  assistantName: string;
  systemPrompt: string;
  isPreset: boolean;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex gap-3">
      {/* Same avatar as assistant messages */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Settings className="h-4 w-4" />
      </div>
      <div className="flex max-w-[80%] flex-col">
        <div className="rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3 text-sm leading-relaxed shadow-xs">
          {/* Header: clickable to collapse/expand */}
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left"
            onClick={() => setCollapsed((v) => !v)}
          >
            <span className="text-xs font-medium text-muted-foreground">
              {t("系统提示词", "System Prompt")}
            </span>
            <span className="text-xs font-medium text-foreground">{assistantName}</span>
            {isPreset ? (
              <span className="text-[10px] text-primary">{t("预设", "Preset")}</span>
            ) : null}
            <ChevronUp
              className={cn(
                "ml-auto h-3 w-3 text-muted-foreground transition-transform",
                collapsed && "rotate-180"
              )}
            />
          </button>
          {/* Body */}
          {!collapsed ? (
            <div className="mt-2 max-h-60 overflow-y-auto border-t border-border/50 pt-2">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {systemPrompt}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Image generation progress with easing ──────────────────────────────

const ESTIMATED_DURATION_MS = 120_000; // 2 minutes default estimate

/**
 * Easing curve: fast start → slow middle → caps at ~92%.
 * Uses 1 - 1/(1 + k*t) where t is progress ratio (0..1+).
 * Reaches ~85% at t=1 (estimated time), then slowly crawls toward 92%.
 */
function easedProgress(elapsedMs: number): number {
  const t = elapsedMs / ESTIMATED_DURATION_MS;
  // k controls curve steepness; higher = faster start
  const k = 5;
  const raw = 1 - 1 / (1 + k * t);
  // Cap at 92% so the jump to 100% is visible
  return Math.min(raw * 100, 92);
}

function ImageGenProgressLabel({
  startTime,
  t,
}: {
  startTime: number | null;
  t: (zh: string, en: string) => string;
}) {
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    if (!startTime) {
      setPercent(0);
      return;
    }
    let raf: number;
    const tick = () => {
      const elapsed = Date.now() - startTime;
      setPercent(Math.round(easedProgress(elapsed)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startTime]);

  return (
    <span>
      {t("正在生成图片", "Generating image")}
      {" "}
      <span className="tabular-nums">{percent}%</span>
    </span>
  );
}
