import { useEffect, useRef, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown, Settings, Sparkles, ArrowDown, AlertCircle } from "lucide-react";
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
  const { t } = useI18n();
  const {
    messages,
    conversations,
    currentConversationId,
    currentScenarioId,
    scenarios,
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
    selectScenario,
    setSelectedProvider,
    setSelectedModel,
    generateTitle,
    deleteMessagesFrom,
    streamingError,
    setStreamingError,
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

  const currentScenario = scenarios.find((scenario) => scenario.id === currentScenarioId);
  const currentProvider = providers.find((provider) => provider.id === selectedProviderId);
  const ttsEnabled = currentScenario?.tts_enabled ?? false;
  const canSelectScenario = !messages.some((message) => message.role !== "system");

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

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
      chunkBufferRef.current = "";
      unlistenChunk.then((fn) => fn());
      unlistenDone.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, [
    currentConversationId,
    appendStreamingContent,
    setStreaming,
    addMessage,
    clearStreamingContent,
    setStreamingError,
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
    await deleteMessagesFrom(messageId);
    const editMsgId = crypto.randomUUID();
    setStreaming(true, currentConversationId);
    clearStreamingContent();
    setStreamingError("");
    try {
      await sendViaCorrectApi(currentConversationId, newContent, editMsgId);
    } catch (error) {
      setStreaming(false);
      clearStreamingContent();
      setStreamingError(String(error));
      console.error("Edit+send failed:", error);
    }
  };

  const handleSend = async (content: string, attachmentJsons?: string[]) => {
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
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 items-center justify-between gap-3 border-b border-border bg-muted/30 px-4">
        {/* Left: Scenario selector (local) or Agent name (OpenClaw) */}
        <div className="flex min-w-0 items-center gap-2">
          {isOpenClawConversation ? (
            <div className="flex h-7 items-center gap-2 rounded-md px-2">
              <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-600 text-[11px]">
                OpenClaw
              </Badge>
              <span className="truncate text-sm font-medium">
                {currentConversation?.title ?? "Agent"}
              </span>
            </div>
          ) : canSelectScenario ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-2 bg-background/50 hover:bg-background"
                >
                  <span className="truncate text-sm">
                    {currentScenario?.name ?? t("自由对话", "Free Chat")}
                  </span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem
                  onClick={() => void selectScenario(null)}
                  className={cn(currentScenarioId === null && "bg-accent")}
                >
                  <span className="text-sm">{t("自由对话", "Free Chat")}</span>
                </DropdownMenuItem>
                {scenarios.map((scenario) => (
                  <DropdownMenuItem
                    key={scenario.id}
                    onClick={() => void selectScenario(scenario.id)}
                    className={cn(scenario.id === currentScenarioId && "bg-accent")}
                  >
                    <div className="flex-1">
                      <span className="text-sm">{scenario.name}</span>
                      {scenario.is_preset ? (
                        <span className="ml-2 text-xs text-primary">{t("预设", "Preset")}</span>
                      ) : null}
                    </div>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/scenarios")}>
                  <Settings className="mr-2 h-4 w-4" />
                  {t("管理场景", "Manage")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex h-7 items-center gap-2 rounded-md px-2 text-muted-foreground">
              <span className="truncate text-sm">
                {currentScenario?.name ?? t("自由对话", "Free Chat")}
              </span>
            </div>
          )}
        </div>

        {/* Right: Model selector + Context slider (local mode only) */}
        {isOpenClawConversation ? null : (
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

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollContainerRef}
          onScroll={checkIfNearBottom}
          className="h-full overflow-y-auto p-4"
          style={{ willChange: "scroll-position" }}
        >
          <div className="mx-auto max-w-3xl space-y-6 pb-2">
            {!currentConversationId ? (
              <div className="flex min-h-[calc(100vh-220px)] items-center justify-center">
                <div className="flex max-w-md flex-col items-center text-center">
                  <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                    <Sparkles className="h-7 w-7 text-primary" />
                  </div>
                  <h2 className="text-xl font-semibold tracking-tight">Private Talk</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t(
                      "选择一个会话，或者新建会话开始聊天。",
                      "Select a conversation or create a new session to start chatting."
                    )}
                  </p>
                  {providers.length === 0 ? (
                    <div className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
                      {t(
                        "还没有配置服务商。打开设置先添加一个。",
                        "No providers configured. Open Settings to add one."
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                {messages
                  .filter((message) => message.role !== "system")
                  .map((message) => (
                    <MessageItem
                      key={message.id}
                      role={message.role as "user" | "assistant"}
                      content={message.content}
                      showTts={ttsEnabled && message.role === "assistant"}
                      scenarioId={currentScenarioId}
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
                {isCurrentStreaming && !streamingContent ? (
                  <div className="flex gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                      <Sparkles className="h-4 w-4 text-muted-foreground" />
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

      <ChatInput onSend={handleSend} onStop={handleStop} />
    </div>
  );
}
