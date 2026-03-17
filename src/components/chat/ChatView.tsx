import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../../stores/appStore";
import { MessageItem } from "./MessageItem";
import { ChatInput } from "./ChatInput";
import * as api from "../../lib/tauri";
import type { StreamChunkPayload, StreamDonePayload, StreamErrorPayload } from "../../lib/types";
import { MessageSquarePlus } from "lucide-react";

export function ChatView() {
  const {
    messages,
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
  } = useAppStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  // Handle scroll — disable auto-scroll if user scrolls up
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 100;
  };

  // Listen for streaming events
  useEffect(() => {
    const unlistenChunk = listen<StreamChunkPayload>("chat-stream-chunk", (e) => {
      if (e.payload.conversation_id === currentConversationId) {
        appendStreamingContent(e.payload.content);
      }
    });

    const unlistenDone = listen<StreamDonePayload>("chat-stream-done", (e) => {
      if (e.payload.conversation_id === currentConversationId) {
        setStreaming(false);
        // Replace streaming content with final message
        addMessage({
          id: e.payload.message_id,
          conversation_id: e.payload.conversation_id,
          role: "assistant",
          content: e.payload.full_content,
          created_at: new Date().toISOString(),
        });
        clearStreamingContent();
        autoScrollRef.current = true;
      }
    });

    const unlistenError = listen<StreamErrorPayload>("chat-stream-error", (e) => {
      if (e.payload.conversation_id === currentConversationId) {
        setStreaming(false);
        clearStreamingContent();
        console.error("Stream error:", e.payload.error);
      }
    });

    return () => {
      unlistenChunk.then((f) => f());
      unlistenDone.then((f) => f());
      unlistenError.then((f) => f());
    };
  }, [currentConversationId, appendStreamingContent, setStreaming, addMessage, clearStreamingContent]);

  const handleSend = async (content: string) => {
    let convId = currentConversationId;

    // Auto-create conversation if none selected
    if (!convId) {
      convId = await createConversation();
    }

    if (!selectedProviderId || !selectedModel) {
      console.error("No provider/model selected");
      return;
    }

    // Add user message to UI immediately
    addMessage({
      id: crypto.randomUUID(),
      conversation_id: convId,
      role: "user",
      content,
      created_at: new Date().toISOString(),
    });

    setStreaming(true);
    clearStreamingContent();
    autoScrollRef.current = true;

    try {
      await api.sendMessage(convId, content, selectedProviderId, selectedModel);
    } catch (e) {
      setStreaming(false);
      clearStreamingContent();
      console.error("Send failed:", e);
    }
  };

  const handleStop = () => {
    api.stopGeneration();
  };

  // No conversation selected — show welcome
  if (!currentConversationId) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-500">
        <MessageSquarePlus size={48} className="mb-4 text-zinc-600" />
        <h2 className="text-xl font-medium text-zinc-300 mb-2">Private Talk</h2>
        <p className="text-sm">Select a conversation or start a new one</p>
        {providers.length === 0 && (
          <p className="text-sm text-amber-500 mt-4">
            ⚠ No providers configured. Go to Settings to add one.
          </p>
        )}
      </div>
    );
  }

  // Model selector bar
  const currentProvider = providers.find((p) => p.id === selectedProviderId);

  return (
    <div className="h-full flex flex-col">
      {/* Model selector bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 text-sm">
        <select
          value={selectedProviderId || ""}
          onChange={(e) => useAppStore.getState().setSelectedProvider(e.target.value)}
          className="bg-zinc-800 text-zinc-300 rounded-lg px-2 py-1 text-xs border border-zinc-700 outline-none"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {currentProvider && (
          <select
            value={selectedModel || ""}
            onChange={(e) => useAppStore.getState().setSelectedModel(e.target.value)}
            className="bg-zinc-800 text-zinc-300 rounded-lg px-2 py-1 text-xs border border-zinc-700 outline-none"
          >
            {currentProvider.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        <div className="max-w-3xl mx-auto">
          {messages.map((msg) => (
            <MessageItem
              key={msg.id}
              role={msg.role as "user" | "assistant"}
              content={msg.content}
            />
          ))}
          {isStreaming && streamingContent && (
            <MessageItem role="assistant" content={streamingContent} isStreaming />
          )}
          {isStreaming && !streamingContent && (
            <div className="flex mb-4">
              <div className="flex items-center gap-1 px-4 py-3 text-sm text-zinc-500">
                <span className="animate-pulse">●</span>
                <span className="animate-pulse delay-100">●</span>
                <span className="animate-pulse delay-200">●</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} onStop={handleStop} />
    </div>
  );
}
