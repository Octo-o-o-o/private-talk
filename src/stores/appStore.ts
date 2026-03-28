import { create } from "zustand";
import type { Conversation, DetectedLocalService, Message, OpenClawInstance, Provider, Assistant, Voice } from "../lib/types";
import type { LocalOpenClawDetection, LocalProviderScanResult } from "../lib/types";
import * as api from "../lib/tauri";
import { normalizeUrl } from "../lib/utils";

const LOCAL_SCAN_DISMISS_KEY = "private-talk-local-scan-dismiss";

function refreshConversations(get: () => AppState) {
  void get().loadConversations().catch((error) => {
    console.error("Failed to refresh conversations:", error);
  });
}

interface AppState {
  // UI
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  // Assistants
  assistants: Assistant[];
  currentAssistantId: string | null; // null = free chat
  loadAssistants: () => Promise<void>;
  selectAssistant: (id: string | null) => Promise<void>;

  // Conversations
  conversations: Conversation[];
  currentConversationId: string | null;
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  createConversation: () => Promise<string>;
  deleteConversation: (id: string) => Promise<void>;
  deleteConversations: (ids: string[]) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  generateTitle: (conversationId: string) => Promise<void>;

  // Messages
  messages: Message[];
  loadMessages: (conversationId: string) => Promise<void>;
  addMessage: (msg: Message) => void;
  deleteMessagesFrom: (messageId: string) => Promise<void>;
  updateMessageContent: (messageId: string, content: string) => Promise<void>;
  clearStreamingContent: () => void;

  // Streaming
  isStreaming: boolean;
  streamingConversationId: string | null;
  streamingContent: string;
  streamingError: string;
  setStreaming: (streaming: boolean, conversationId?: string | null) => void;
  appendStreamingContent: (chunk: string) => void;
  setStreamingError: (error: string) => void;

  // Providers
  providers: Provider[];
  selectedProviderId: string | null;
  selectedModel: string | null;
  selectedSttProviderId: string | null;
  sttModel: string;
  loadProviders: () => Promise<void>;
  loadSpeechSettings: () => Promise<void>;
  setSelectedProvider: (id: string) => void;
  setSelectedModel: (model: string) => void;
  setSelectedSttProvider: (id: string | null) => Promise<void>;
  setSttModel: (model: string) => Promise<void>;

  // Voices
  voices: Voice[];
  loadVoices: () => Promise<void>;

  // TTS playback
  isTtsPlaying: boolean;
  ttsStopGeneration: number; // incremented to signal all buttons to stop
  setTtsPlaying: (playing: boolean) => void;
  stopAllTts: () => void;

  // OpenClaw
  openclawInstances: OpenClawInstance[];
  loadOpenClawInstances: () => Promise<void>;
  createOpenClawConversation: (
    instanceId: string,
    agentId: string,
    agentName: string
  ) => Promise<string>;

  // Local service detection (runs at startup)
  pendingLocalDetections: DetectedLocalService[];
  localScanComplete: boolean;
  scanLocalServices: () => Promise<void>;
  consumePendingDetection: (key: string) => void;
  dismissAllDetections: (permanent: boolean) => void;

  // PIN
  isLocked: boolean;
  pinEnabled: boolean;
  setLocked: (locked: boolean) => void;
  checkPinStatus: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  // UI
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  // Assistants
  assistants: [],
  currentAssistantId: null,
  loadAssistants: async () => {
    const assistants = await api.listAssistants();
    set({ assistants });
  },
  selectAssistant: async (id) => {
    const { currentConversationId, messages } = get();
    const isDraftConversation =
      currentConversationId !== null &&
      messages.every((message) => message.role === "system");

    if (isDraftConversation) {
      const updatedConversation = await api.updateConversationAssistant(
        currentConversationId,
        id ?? undefined
      );
      set((s) => ({
        currentAssistantId: id,
        conversations: s.conversations.map((conversation) =>
          conversation.id === currentConversationId
            ? {
                ...conversation,
                assistant_id: updatedConversation.assistant_id,
                updated_at: updatedConversation.updated_at,
              }
            : conversation
        ),
        messages: [],
      }));
      refreshConversations(get);
      return;
    }

    set({ currentAssistantId: id, currentConversationId: null, messages: [] });
  },

  // Conversations
  conversations: [],
  currentConversationId: null,
  loadConversations: async () => {
    const conversations = await api.listConversations();
    set({ conversations });
  },
  selectConversation: async (id) => {
    const conversation = get().conversations.find((c) => c.id === id);
    const { streamingConversationId } = get();
    const isTargetStreaming = streamingConversationId === id;
    set({
      currentConversationId: id,
      currentAssistantId: conversation?.assistant_id ?? null,
      // Keep streamingContent only if switching TO the streaming conversation
      streamingContent: isTargetStreaming ? get().streamingContent : "",
      streamingError: "",
    });
    await get().loadMessages(id);

    // If this conversation was marked as streaming, check whether the backend
    // already has the complete assistant reply. This handles the case where
    // chat-stream-done fired while the ChatView was unmounted (e.g. user
    // navigated to another page), so the event listener missed it.
    if (isTargetStreaming && get().isStreaming) {
      const msgs = get().messages;
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        set({
          isStreaming: false,
          streamingConversationId: null,
          streamingContent: "",
        });
      }
    }
  },
  createConversation: async () => {
    const { currentAssistantId } = get();
    const conv = await api.createConversation(
      undefined,
      currentAssistantId ?? undefined
    );
    set((s) => ({
      conversations: [conv, ...s.conversations.filter((item) => item.id !== conv.id)],
      currentConversationId: conv.id,
      currentAssistantId: conv.assistant_id,
      messages: [],
    }));
    refreshConversations(get);
    return conv.id;
  },
  deleteConversation: async (id) => {
    await api.deleteConversation(id);
    set((s) => ({
      conversations: s.conversations.filter((conversation) => conversation.id !== id),
      currentConversationId:
        s.currentConversationId === id ? null : s.currentConversationId,
      messages: s.currentConversationId === id ? [] : s.messages,
    }));
    refreshConversations(get);
  },
  deleteConversations: async (ids) => {
    await api.deleteConversations(ids);
    set((s) => {
      const shouldClearCurrent =
        s.currentConversationId !== null && ids.includes(s.currentConversationId);
      return {
        conversations: s.conversations.filter(
          (conversation) => !ids.includes(conversation.id)
        ),
        currentConversationId: shouldClearCurrent ? null : s.currentConversationId,
        messages: shouldClearCurrent ? [] : s.messages,
      };
    });
    refreshConversations(get);
  },
  renameConversation: async (id, title) => {
    await api.renameConversation(id, title);
    set((s) => ({
      conversations: s.conversations.map((conversation) =>
        conversation.id === id ? { ...conversation, title } : conversation
      ),
    }));
    refreshConversations(get);
  },
  generateTitle: async (conversationId) => {
    const { selectedProviderId, selectedModel } = get();
    if (!selectedProviderId || !selectedModel) return;
    try {
      const title = await api.generateTitle(conversationId, selectedProviderId, selectedModel);
      // Update the conversation title in local state immediately
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === conversationId ? { ...c, title } : c
        ),
      }));
    } catch (e) {
      console.error("Failed to generate title:", e);
    }
  },

  // Messages
  messages: [],
  loadMessages: async (conversationId) => {
    const messages = await api.getMessages(conversationId);
    set({ messages });
  },
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  deleteMessagesFrom: async (messageId) => {
    const { currentConversationId } = get();
    if (!currentConversationId) return;
    await api.deleteMessagesFrom(currentConversationId, messageId);
    // Reload messages from DB to get accurate state
    await get().loadMessages(currentConversationId);
  },
  updateMessageContent: async (messageId, content) => {
    await api.updateMessageContent(messageId, content);
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, content } : m
      ),
    }));
  },
  clearStreamingContent: () => set({ streamingContent: "" }),

  // Streaming
  isStreaming: false,
  streamingConversationId: null,
  streamingContent: "",
  streamingError: "",
  setStreaming: (streaming, conversationId) =>
    set({
      isStreaming: streaming,
      streamingConversationId: streaming ? (conversationId ?? null) : null,
    }),
  appendStreamingContent: (chunk) =>
    set((s) => ({ streamingContent: s.streamingContent + chunk })),
  setStreamingError: (error) => set({ streamingError: error }),

  // Providers
  providers: [],
  selectedProviderId: null,
  selectedModel: null,
  selectedSttProviderId: null,
  sttModel: "whisper-1",
  loadProviders: async () => {
    const providers = await api.listProviders();
    set({ providers });
    // Only auto-select if current selection is null or no longer valid
    const { selectedProviderId, selectedSttProviderId } = get();
    const currentStillExists = selectedProviderId && providers.some((p) => p.id === selectedProviderId);
    if (!currentStillExists) {
      const defaultProvider = providers.find((p) => p.is_default);
      if (defaultProvider) {
        set({
          selectedProviderId: defaultProvider.id,
          selectedModel: defaultProvider.models[0] || null,
        });
      } else if (providers.length > 0) {
        set({
          selectedProviderId: providers[0].id,
          selectedModel: providers[0].models[0] || null,
        });
      }
    }

    const sttProviderStillExists =
      selectedSttProviderId &&
      providers.some((provider) => provider.id === selectedSttProviderId);
    if (selectedSttProviderId && !sttProviderStillExists) {
      set({ selectedSttProviderId: null });
      void api.setSetting("stt_provider_id", "").catch((error) => {
        console.error("Failed to clear missing STT provider setting:", error);
      });
    }
  },
  loadSpeechSettings: async () => {
    const [sttProviderId, sttModel] = await Promise.all([
      api.getSetting("stt_provider_id"),
      api.getSetting("stt_model"),
    ]);

    const normalizedProviderId = sttProviderId?.trim() ? sttProviderId : null;
    const currentProviders = get().providers;
    const providerIsValid =
      !normalizedProviderId ||
      currentProviders.length === 0 ||
      currentProviders.some((provider) => provider.id === normalizedProviderId);

    set({
      selectedSttProviderId: providerIsValid ? normalizedProviderId : null,
      sttModel: sttModel?.trim() || "whisper-1",
    });

    if (normalizedProviderId && !providerIsValid) {
      await api.setSetting("stt_provider_id", "");
    }
  },
  setSelectedProvider: (id) => {
    const provider = get().providers.find((p) => p.id === id);
    set({
      selectedProviderId: id,
      selectedModel: provider?.models[0] || null,
    });
  },
  setSelectedModel: (model) => set({ selectedModel: model }),
  setSelectedSttProvider: async (id) => {
    set({ selectedSttProviderId: id });
    await api.setSetting("stt_provider_id", id ?? "");
  },
  setSttModel: async (model) => {
    const normalized = model.trim() || "whisper-1";
    set({ sttModel: normalized });
    await api.setSetting("stt_model", normalized);
  },

  // Voices
  voices: [],
  loadVoices: async () => {
    const voices = await api.listVoices();
    set({ voices });
  },

  // TTS playback
  isTtsPlaying: false,
  ttsStopGeneration: 0,
  setTtsPlaying: (playing) => set({ isTtsPlaying: playing }),
  stopAllTts: () => set((s) => ({ ttsStopGeneration: s.ttsStopGeneration + 1, isTtsPlaying: false })),

  // OpenClaw
  openclawInstances: [],
  loadOpenClawInstances: async () => {
    const instances = await api.listOpenClawInstances();
    set({ openclawInstances: instances });
  },
  createOpenClawConversation: async (instanceId, agentId, agentName) => {
    const conv = await api.createConversation(
      agentName,
      undefined,
      instanceId,
      agentId
    );
    set((s) => ({
      conversations: [conv, ...s.conversations.filter((item) => item.id !== conv.id)],
      currentConversationId: conv.id,
      currentAssistantId: null,
      messages: [],
    }));
    refreshConversations(get);
    return conv.id;
  },

  // Local service detection
  pendingLocalDetections: [],
  localScanComplete: false,
  scanLocalServices: async () => {
    // Skip if permanently dismissed
    try {
      if (localStorage.getItem(LOCAL_SCAN_DISMISS_KEY) === "true") {
        set({ localScanComplete: true });
        return;
      }
    } catch { /* ignore */ }

    // Scan providers and OpenClaw in parallel
    const [scanResults, openclawResult] = await Promise.all([
      api.scanLocalProviders().catch(() => [] as LocalProviderScanResult[]),
      api.detectLocalOpenClaw().catch(() => null as LocalOpenClawDetection | null),
    ]);

    // Dedup against existing data
    const { providers, openclawInstances: currentInstances } = get();

    const existingProviderUrls = new Set(providers.map((p) => normalizeUrl(p.base_url)));
    const existingOpenClawUrls = new Set(currentInstances.map((i) => normalizeUrl(i.gateway_url)));

    const newServices: DetectedLocalService[] = [];

    for (const result of scanResults) {
      const url = normalizeUrl(result.base_url);
      if (!existingProviderUrls.has(url)) {
        newServices.push({
          key: url,
          name: result.name,
          type: "provider",
          framework: result.framework,
          detail: result.base_url,
          providerScan: result,
        });
      }
    }

    if (openclawResult?.gateway_running) {
      const gwUrl = normalizeUrl(openclawResult.gateway_url ?? "ws://127.0.0.1:18789");
      if (!existingOpenClawUrls.has(gwUrl)) {
        newServices.push({
          key: gwUrl,
          name: "OpenClaw Gateway",
          type: "openclaw",
          framework: "OpenClaw",
          detail: openclawResult.gateway_url ?? "ws://127.0.0.1:18789",
          openclawDetection: openclawResult,
        });
      }
    }

    set({ pendingLocalDetections: newServices, localScanComplete: true });
  },
  consumePendingDetection: (key) => {
    set((s) => ({
      pendingLocalDetections: s.pendingLocalDetections.filter((d) => d.key !== key),
    }));
  },
  dismissAllDetections: (permanent) => {
    if (permanent) {
      try { localStorage.setItem(LOCAL_SCAN_DISMISS_KEY, "true"); } catch { /* ignore */ }
    }
    set({ pendingLocalDetections: [] });
  },

  // PIN
  isLocked: false,
  pinEnabled: false,
  setLocked: (locked) => set({ isLocked: locked }),
  checkPinStatus: async () => {
    const enabled = await api.isPinEnabled();
    set({ pinEnabled: enabled, isLocked: enabled });
  },
}));
