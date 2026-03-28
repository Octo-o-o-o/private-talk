import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Conversation,
  LocalOpenClawDetection,
  LocalProviderScanResult,
  Message,
  OpenClawInstance,
  Provider,
} from "@/lib/types";
import { useAppStore } from "@/stores/appStore";

const mockedInvoke = vi.mocked(invoke);
const initialAppState = useAppStore.getState();

const mockConversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: "conversation-1",
  title: "Conversation",
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
  id: "provider-1",
  name: "Provider",
  api_type: "openai",
  base_url: "https://api.example.com/v1",
  api_key: "sk-test",
  models: ["gpt-4.1"],
  is_default: true,
  created_at: "2024-01-01T00:00:00Z",
  ...overrides,
});

const mockMessage = (overrides: Partial<Message> = {}): Message => ({
  id: "message-1",
  conversation_id: "conversation-1",
  role: "user",
  content: "hello",
  is_pinned: false,
  created_at: "2024-01-01T00:00:00Z",
  attachments: [],
  ...overrides,
});

function resetAppStore() {
  useAppStore.setState({
    ...initialAppState,
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
  localStorage.clear();
}

describe("appStore extended behaviors", () => {
  beforeEach(() => {
    resetAppStore();
    vi.clearAllMocks();
  });

  it("updates a draft conversation when selecting another assistant", async () => {
    useAppStore.setState({
      currentConversationId: "conversation-1",
      conversations: [mockConversation({ id: "conversation-1" })],
      messages: [mockMessage({ role: "system", content: "draft context" })],
    });
    mockedInvoke
      .mockResolvedValueOnce(
        mockConversation({
          id: "conversation-1",
          assistant_id: "assistant-1",
          scenario_id: "assistant-1",
          updated_at: "2024-01-02T00:00:00Z",
        })
      )
      .mockResolvedValueOnce([
        mockConversation({
          id: "conversation-1",
          assistant_id: "assistant-1",
          scenario_id: "assistant-1",
        }),
      ]);

    await useAppStore.getState().selectAssistant("assistant-1");

    const state = useAppStore.getState();
    expect(state.currentAssistantId).toBe("assistant-1");
    expect(state.conversations[0].assistant_id).toBe("assistant-1");
    expect(state.messages).toEqual([]);
    expect(mockedInvoke).toHaveBeenCalledWith("update_conversation_assistant", {
      id: "conversation-1",
      assistantId: "assistant-1",
    });
  });

  it("starts a fresh chat when changing assistant for a non-draft conversation", async () => {
    useAppStore.setState({
      currentConversationId: "conversation-1",
      messages: [mockMessage({ role: "user" })],
    });

    await useAppStore.getState().selectAssistant("assistant-2");

    expect(useAppStore.getState().currentAssistantId).toBe("assistant-2");
    expect(useAppStore.getState().currentConversationId).toBeNull();
    expect(useAppStore.getState().messages).toEqual([]);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("selects a conversation and clears stale streaming UI when switching away", async () => {
    useAppStore.setState({
      conversations: [
        mockConversation({ id: "conversation-1", assistant_id: "assistant-1" }),
        mockConversation({ id: "conversation-2", assistant_id: null }),
      ],
      isStreaming: true,
      streamingConversationId: "conversation-1",
      streamingContent: "partial reply",
      streamingError: "old error",
    });
    mockedInvoke.mockResolvedValueOnce([]);

    await useAppStore.getState().selectConversation("conversation-2");

    expect(useAppStore.getState().currentConversationId).toBe("conversation-2");
    expect(useAppStore.getState().currentAssistantId).toBeNull();
    expect(useAppStore.getState().streamingContent).toBe("");
    expect(useAppStore.getState().streamingError).toBe("");
  });

  it("marks streaming as finished when the backend already contains the final assistant message", async () => {
    useAppStore.setState({
      conversations: [mockConversation({ id: "conversation-1", assistant_id: "assistant-1" })],
      isStreaming: true,
      streamingConversationId: "conversation-1",
      streamingContent: "partial reply",
    });
    mockedInvoke.mockResolvedValueOnce([
      mockMessage({
        id: "assistant-message",
        role: "assistant",
        content: "final reply",
      }),
    ]);

    await useAppStore.getState().selectConversation("conversation-1");

    expect(useAppStore.getState().isStreaming).toBe(false);
    expect(useAppStore.getState().streamingConversationId).toBeNull();
    expect(useAppStore.getState().streamingContent).toBe("");
  });

  it("creates a new conversation for the selected assistant", async () => {
    useAppStore.setState({
      currentAssistantId: "assistant-1",
      conversations: [mockConversation({ id: "existing-conversation" })],
      messages: [mockMessage()],
    });
    mockedInvoke
      .mockResolvedValueOnce(
        mockConversation({
          id: "new-conversation",
          assistant_id: "assistant-1",
          scenario_id: "assistant-1",
        })
      )
      .mockResolvedValueOnce([
        mockConversation({
          id: "new-conversation",
          assistant_id: "assistant-1",
          scenario_id: "assistant-1",
        }),
      ]);

    const id = await useAppStore.getState().createConversation();

    expect(id).toBe("new-conversation");
    expect(useAppStore.getState().currentConversationId).toBe("new-conversation");
    expect(useAppStore.getState().currentAssistantId).toBe("assistant-1");
    expect(useAppStore.getState().messages).toEqual([]);
  });

  it("does not delete messages when there is no current conversation", async () => {
    await useAppStore.getState().deleteMessagesFrom("message-1");

    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("normalizes invalid saved speech settings and clears missing STT providers", async () => {
    useAppStore.setState({
      providers: [mockProvider({ id: "provider-1" })],
    });
    mockedInvoke.mockImplementation(async (command: string, args?: unknown) => {
      const payload = args as Record<string, unknown> | undefined;
      if (command === "get_setting" && payload?.key === "stt_provider_id") {
        return "missing-provider";
      }
      if (command === "get_setting" && payload?.key === "stt_model") {
        return "   ";
      }
      return undefined;
    });

    await useAppStore.getState().loadSpeechSettings();

    expect(useAppStore.getState().selectedSttProviderId).toBeNull();
    expect(useAppStore.getState().sttModel).toBe("whisper-1");
    expect(mockedInvoke).toHaveBeenCalledWith("set_setting", {
      key: "stt_provider_id",
      value: "",
    });
  });

  it("creates OpenClaw conversations without binding an assistant", async () => {
    mockedInvoke
      .mockResolvedValueOnce(
        mockConversation({
          id: "openclaw-conversation",
          openclaw_instance_id: "instance-1",
          openclaw_agent_id: "agent-1",
        })
      )
      .mockResolvedValueOnce([
        mockConversation({
          id: "openclaw-conversation",
          openclaw_instance_id: "instance-1",
          openclaw_agent_id: "agent-1",
        }),
      ]);

    const id = await useAppStore
      .getState()
      .createOpenClawConversation("instance-1", "agent-1", "Debugger");

    expect(id).toBe("openclaw-conversation");
    expect(useAppStore.getState().currentAssistantId).toBeNull();
    expect(mockedInvoke).toHaveBeenCalledWith("create_conversation", {
      title: "Debugger",
      assistantId: undefined,
      openclawInstanceId: "instance-1",
      openclawAgentId: "agent-1",
    });
  });

  it("updates the conversation title when generation succeeds", async () => {
    useAppStore.setState({
      conversations: [mockConversation({ id: "conversation-1", title: "Old" })],
      selectedProviderId: "provider-1",
      selectedModel: "gpt-4.1",
    });
    mockedInvoke.mockResolvedValue("New title");

    await useAppStore.getState().generateTitle("conversation-1");

    expect(useAppStore.getState().conversations[0].title).toBe("New title");
    expect(mockedInvoke).toHaveBeenCalledWith("generate_title", {
      conversationId: "conversation-1",
      providerId: "provider-1",
      model: "gpt-4.1",
    });
  });

  it("loads providers and clears a missing saved STT provider", async () => {
    useAppStore.setState({
      selectedSttProviderId: "missing-provider",
    });
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "list_providers") {
        return [mockProvider({ id: "provider-1" })];
      }
      return undefined;
    });

    await useAppStore.getState().loadProviders();

    expect(useAppStore.getState().selectedSttProviderId).toBeNull();
    expect(mockedInvoke).toHaveBeenCalledWith("set_setting", {
      key: "stt_provider_id",
      value: "",
    });
  });

  it("persists explicit STT provider and model updates", async () => {
    mockedInvoke.mockResolvedValue(undefined);

    await useAppStore.getState().setSelectedSttProvider("provider-1");
    await useAppStore.getState().setSttModel("  whisper-large-v3  ");

    expect(useAppStore.getState().selectedSttProviderId).toBe("provider-1");
    expect(useAppStore.getState().sttModel).toBe("whisper-large-v3");
    expect(mockedInvoke).toHaveBeenCalledWith("set_setting", {
      key: "stt_provider_id",
      value: "provider-1",
    });
    expect(mockedInvoke).toHaveBeenCalledWith("set_setting", {
      key: "stt_model",
      value: "whisper-large-v3",
    });
  });

  it("skips local service scans when the user dismissed them permanently", async () => {
    localStorage.setItem("private-talk-local-scan-dismiss", "true");

    await useAppStore.getState().scanLocalServices();

    expect(useAppStore.getState().localScanComplete).toBe(true);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("deduplicates known local services while keeping new detections", async () => {
    const providerResults: LocalProviderScanResult[] = [
      {
        framework: "Ollama",
        name: "Ollama",
        base_url: "http://localhost:11434/v1",
        api_key: "",
        models: ["qwen"],
        detection: "running",
      },
      {
        framework: "LM Studio",
        name: "LM Studio",
        base_url: "http://127.0.0.1:1234/v1",
        api_key: "",
        models: ["llama"],
        detection: "running",
      },
    ];
    const openclawDetection: LocalOpenClawDetection = {
      cli_available: true,
      cli_version: "1.0.0",
      config_dir_exists: true,
      gateway_url: "ws://127.0.0.1:18789",
      gateway_token: "token",
      gateway_running: true,
    };
    const existingInstance: OpenClawInstance = {
      id: "instance-1",
      name: "Existing Gateway",
      gateway_url: "ws://127.0.0.1:18789",
      token: "token",
      agents_cache: "[]",
      is_remote: false,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    };

    useAppStore.setState({
      providers: [
        mockProvider({
          base_url: "HTTP://LOCALHOST:11434/v1/",
        }),
      ],
      openclawInstances: [existingInstance],
    });

    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "scan_local_providers") return providerResults;
      if (command === "detect_local_openclaw") return openclawDetection;
      if (command === "list_openclaw_instances") return [existingInstance];
      return undefined;
    });

    await useAppStore.getState().scanLocalServices();

    expect(useAppStore.getState().localScanComplete).toBe(true);
    expect(useAppStore.getState().pendingLocalDetections).toEqual([
      {
        key: "http://127.0.0.1:1234/v1",
        name: "LM Studio",
        type: "provider",
        framework: "LM Studio",
        detail: "http://127.0.0.1:1234/v1",
        providerScan: providerResults[1],
      },
    ]);
  });

  it("removes a consumed local detection by key", () => {
    useAppStore.setState({
      pendingLocalDetections: [
        {
          key: "first",
          name: "First",
          type: "provider",
          framework: "Test",
          detail: "one",
        },
        {
          key: "second",
          name: "Second",
          type: "provider",
          framework: "Test",
          detail: "two",
        },
      ],
    });

    useAppStore.getState().consumePendingDetection("first");

    expect(useAppStore.getState().pendingLocalDetections).toEqual([
      {
        key: "second",
        name: "Second",
        type: "provider",
        framework: "Test",
        detail: "two",
      },
    ]);
  });

  it("persists permanent dismissal for local detections", () => {
    useAppStore.setState({
      pendingLocalDetections: [
        {
          key: "http://127.0.0.1:1234/v1",
          name: "LM Studio",
          type: "provider",
          framework: "LM Studio",
          detail: "http://127.0.0.1:1234/v1",
        },
      ],
    });

    useAppStore.getState().dismissAllDetections(true);

    expect(useAppStore.getState().pendingLocalDetections).toEqual([]);
    expect(localStorage.getItem("private-talk-local-scan-dismiss")).toBe("true");
  });
});
