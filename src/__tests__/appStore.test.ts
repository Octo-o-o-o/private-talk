import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";
import type { Conversation, Provider } from "@/lib/types";

const mockedInvoke = vi.mocked(invoke);

const mockConversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: "c1",
  title: "Test Conversation",
  assistant_id: null,
  scenario_id: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  openclaw_instance_id: null,
  openclaw_agent_id: null,
  openclaw_session_key: null,
  ...overrides,
});

const mockProvider = (overrides: Partial<Provider> = {}): Provider => ({
  id: "p1",
  name: "Test Provider",
  api_type: "openai",
  base_url: "https://api.example.com/v1",
  api_key: "sk-test",
  models: ["gpt-4", "gpt-3.5"],
  is_default: true,
  created_at: "2024-01-01T00:00:00Z",
  ...overrides,
});

function resetStore() {
  useAppStore.setState({
    sidebarOpen: true,
    assistants: [],
    currentAssistantId: null,
    conversations: [],
    currentConversationId: null,
    messages: [],
    isStreaming: false,
    streamingConversationId: null,
    streamingContent: "",
    streamingError: "",
    providers: [],
    selectedProviderId: null,
    selectedModel: null,
    selectedSttProviderId: null,
    sttModel: "whisper-1",
    voices: [],
    isTtsPlaying: false,
    ttsStopGeneration: 0,
    openclawInstances: [],
    pendingLocalDetections: [],
    localScanComplete: false,
    isLocked: false,
    pinEnabled: false,
  });
}

describe("appStore", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  describe("UI state", () => {
    it("should toggle sidebar", () => {
      expect(useAppStore.getState().sidebarOpen).toBe(true);
      useAppStore.getState().toggleSidebar();
      expect(useAppStore.getState().sidebarOpen).toBe(false);
      useAppStore.getState().toggleSidebar();
      expect(useAppStore.getState().sidebarOpen).toBe(true);
    });

    it("should set sidebar open state", () => {
      useAppStore.getState().setSidebarOpen(false);
      expect(useAppStore.getState().sidebarOpen).toBe(false);
    });
  });

  describe("streaming state", () => {
    it("should set streaming state", () => {
      useAppStore.getState().setStreaming(true, "c1");

      const state = useAppStore.getState();
      expect(state.isStreaming).toBe(true);
      expect(state.streamingConversationId).toBe("c1");
    });

    it("should clear streaming conversation when stopping", () => {
      useAppStore.getState().setStreaming(true, "c1");
      useAppStore.getState().setStreaming(false);

      const state = useAppStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.streamingConversationId).toBeNull();
    });

    it("should append streaming content", () => {
      useAppStore.getState().appendStreamingContent("Hello");
      useAppStore.getState().appendStreamingContent(" World");

      expect(useAppStore.getState().streamingContent).toBe("Hello World");
    });

    it("should clear streaming content", () => {
      useAppStore.getState().appendStreamingContent("Hello");
      useAppStore.getState().clearStreamingContent();

      expect(useAppStore.getState().streamingContent).toBe("");
    });

    it("should set streaming error", () => {
      useAppStore.getState().setStreamingError("Connection failed");
      expect(useAppStore.getState().streamingError).toBe("Connection failed");
    });
  });

  describe("TTS state", () => {
    it("should toggle TTS playing state", () => {
      useAppStore.getState().setTtsPlaying(true);
      expect(useAppStore.getState().isTtsPlaying).toBe(true);

      useAppStore.getState().setTtsPlaying(false);
      expect(useAppStore.getState().isTtsPlaying).toBe(false);
    });

    it("should stop all TTS and increment generation counter", () => {
      useAppStore.getState().setTtsPlaying(true);
      const before = useAppStore.getState().ttsStopGeneration;

      useAppStore.getState().stopAllTts();

      expect(useAppStore.getState().isTtsPlaying).toBe(false);
      expect(useAppStore.getState().ttsStopGeneration).toBe(before + 1);
    });
  });

  describe("messages", () => {
    it("should add a message", () => {
      const msg = {
        id: "m1",
        conversation_id: "c1",
        role: "user" as const,
        content: "Hello",
        is_pinned: false,
        created_at: "2024-01-01T00:00:00Z",
        attachments: [],
      };

      useAppStore.getState().addMessage(msg);

      expect(useAppStore.getState().messages).toHaveLength(1);
      expect(useAppStore.getState().messages[0].content).toBe("Hello");
    });

    it("should load messages from backend", async () => {
      const messages = [
        {
          id: "m1",
          conversation_id: "c1",
          role: "user",
          content: "Hi",
          is_pinned: false,
          created_at: "2024-01-01",
          attachments: [],
        },
      ];
      mockedInvoke.mockResolvedValue(messages);

      await useAppStore.getState().loadMessages("c1");

      expect(useAppStore.getState().messages).toEqual(messages);
      expect(mockedInvoke).toHaveBeenCalledWith("get_messages", { conversationId: "c1" });
    });

    it("should update message content", async () => {
      useAppStore.setState({
        messages: [
          {
            id: "m1",
            conversation_id: "c1",
            role: "user",
            content: "old",
            is_pinned: false,
            created_at: "2024-01-01",
            attachments: [],
          },
        ],
      });
      mockedInvoke.mockResolvedValue(undefined);

      await useAppStore.getState().updateMessageContent("m1", "new content");

      expect(useAppStore.getState().messages[0].content).toBe("new content");
      expect(mockedInvoke).toHaveBeenCalledWith("update_message_content", {
        messageId: "m1",
        content: "new content",
      });
    });
  });

  describe("conversations", () => {
    it("should load conversations", async () => {
      const convs = [mockConversation()];
      mockedInvoke.mockResolvedValue(convs);

      await useAppStore.getState().loadConversations();

      expect(useAppStore.getState().conversations).toHaveLength(1);
    });

    it("should delete conversation and clear if current", async () => {
      useAppStore.setState({
        conversations: [mockConversation({ id: "c1" }), mockConversation({ id: "c2" })],
        currentConversationId: "c1",
        messages: [{ id: "m1", conversation_id: "c1", role: "user", content: "hi", is_pinned: false, created_at: "", attachments: [] }],
      });
      mockedInvoke.mockResolvedValue(undefined);
      // Mock the loadConversations call that follows
      mockedInvoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce([mockConversation({ id: "c2" })]);

      await useAppStore.getState().deleteConversation("c1");

      const state = useAppStore.getState();
      expect(state.conversations.find((c) => c.id === "c1")).toBeUndefined();
      expect(state.currentConversationId).toBeNull();
      expect(state.messages).toEqual([]);
    });

    it("should rename conversation", async () => {
      useAppStore.setState({
        conversations: [mockConversation({ id: "c1", title: "Old Title" })],
      });
      mockedInvoke.mockResolvedValue(undefined);
      // Mock loadConversations
      mockedInvoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce([mockConversation({ id: "c1", title: "New Title" })]);

      await useAppStore.getState().renameConversation("c1", "New Title");

      expect(useAppStore.getState().conversations[0].title).toBe("New Title");
    });

    it("should bulk delete conversations", async () => {
      useAppStore.setState({
        conversations: [
          mockConversation({ id: "c1" }),
          mockConversation({ id: "c2" }),
          mockConversation({ id: "c3" }),
        ],
        currentConversationId: "c2",
      });
      mockedInvoke.mockResolvedValue(undefined);

      await useAppStore.getState().deleteConversations(["c1", "c2"]);

      const state = useAppStore.getState();
      expect(state.conversations).toHaveLength(1);
      expect(state.conversations[0].id).toBe("c3");
      expect(state.currentConversationId).toBeNull();
    });
  });

  describe("providers", () => {
    it("should load providers and auto-select default", async () => {
      const providers = [
        mockProvider({ id: "p1", is_default: true, models: ["gpt-4"] }),
        mockProvider({ id: "p2", is_default: false, models: ["claude-3"] }),
      ];
      mockedInvoke.mockResolvedValue(providers);

      await useAppStore.getState().loadProviders();

      const state = useAppStore.getState();
      expect(state.providers).toHaveLength(2);
      expect(state.selectedProviderId).toBe("p1");
      expect(state.selectedModel).toBe("gpt-4");
    });

    it("should fallback to first provider when no default", async () => {
      const providers = [
        mockProvider({ id: "p1", is_default: false, models: ["m1"] }),
      ];
      mockedInvoke.mockResolvedValue(providers);

      await useAppStore.getState().loadProviders();

      expect(useAppStore.getState().selectedProviderId).toBe("p1");
      expect(useAppStore.getState().selectedModel).toBe("m1");
    });

    it("should not re-select if current provider still exists", async () => {
      useAppStore.setState({ selectedProviderId: "p2", selectedModel: "my-model" });
      const providers = [
        mockProvider({ id: "p1", is_default: true }),
        mockProvider({ id: "p2", is_default: false }),
      ];
      mockedInvoke.mockResolvedValue(providers);

      await useAppStore.getState().loadProviders();

      // Should keep existing selection
      expect(useAppStore.getState().selectedProviderId).toBe("p2");
      expect(useAppStore.getState().selectedModel).toBe("my-model");
    });

    it("should set selected provider and auto-select first model", () => {
      useAppStore.setState({
        providers: [mockProvider({ id: "p1", models: ["m1", "m2"] })],
      });

      useAppStore.getState().setSelectedProvider("p1");

      expect(useAppStore.getState().selectedProviderId).toBe("p1");
      expect(useAppStore.getState().selectedModel).toBe("m1");
    });
  });

  describe("PIN", () => {
    it("should check PIN status and lock if enabled", async () => {
      mockedInvoke.mockResolvedValue(true);

      await useAppStore.getState().checkPinStatus();

      expect(useAppStore.getState().pinEnabled).toBe(true);
      expect(useAppStore.getState().isLocked).toBe(true);
    });

    it("should not lock when PIN is disabled", async () => {
      mockedInvoke.mockResolvedValue(false);

      await useAppStore.getState().checkPinStatus();

      expect(useAppStore.getState().pinEnabled).toBe(false);
      expect(useAppStore.getState().isLocked).toBe(false);
    });
  });
});
