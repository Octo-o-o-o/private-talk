import { create } from "zustand";
import type { Conversation, DetectedLocalService, Message, OpenClawInstance, Provider, Scenario, Voice } from "../lib/types";
import type { LocalOpenClawDetection, LocalProviderScanResult } from "../lib/types";
import * as api from "../lib/tauri";

const LOCAL_SCAN_DISMISS_KEY = "private-talk-local-scan-dismiss";

function normalizeUrl(url: string) {
  return url.replace(/\/+$/, "").toLowerCase();
}

interface AppState {
  // UI
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  // Scenarios
  scenarios: Scenario[];
  currentScenarioId: string | null; // null = free chat
  loadScenarios: () => Promise<void>;
  selectScenario: (id: string | null) => Promise<void>;

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
  loadProviders: () => Promise<void>;
  setSelectedProvider: (id: string) => void;
  setSelectedModel: (model: string) => void;

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

  // Scenarios
  scenarios: [],
  currentScenarioId: null,
  loadScenarios: async () => {
    const scenarios = await api.listScenarios();
    set({ scenarios });
  },
  selectScenario: async (id) => {
    const { currentConversationId, messages } = get();
    const isDraftConversation =
      currentConversationId !== null &&
      messages.every((message) => message.role === "system");

    if (isDraftConversation) {
      await api.updateConversationScenario(currentConversationId, id ?? undefined);
      await get().loadConversations();
      set({ currentScenarioId: id });
      await get().loadMessages(currentConversationId);
      return;
    }

    set({ currentScenarioId: id, currentConversationId: null, messages: [] });
  },

  // Conversations
  conversations: [],
  currentConversationId: null,
  loadConversations: async () => {
    // Always load all conversations (no filtering by scenario)
    const conversations = await api.listConversations();
    set({ conversations });
  },
  selectConversation: async (id) => {
    // Sync scenario to match the conversation's scenario_id
    const conversation = get().conversations.find((c) => c.id === id);
    const { streamingConversationId } = get();
    // Clear streaming display state when switching away from the streaming conversation
    const isTargetStreaming = streamingConversationId === id;
    set({
      currentConversationId: id,
      currentScenarioId: conversation?.scenario_id ?? null,
      // Keep streamingContent only if switching TO the streaming conversation
      streamingContent: isTargetStreaming ? get().streamingContent : "",
      streamingError: "",
    });
    await get().loadMessages(id);
  },
  createConversation: async () => {
    const { currentScenarioId } = get();
    const conv = await api.createConversation(
      undefined,
      currentScenarioId ?? undefined
    );
    await get().loadConversations();
    set({ currentConversationId: conv.id });
    // Load messages (may include system prompt snapshot)
    await get().loadMessages(conv.id);
    return conv.id;
  },
  deleteConversation: async (id) => {
    await api.deleteConversation(id);
    const { currentConversationId } = get();
    if (currentConversationId === id) {
      set({ currentConversationId: null, messages: [] });
    }
    await get().loadConversations();
  },
  deleteConversations: async (ids) => {
    await api.deleteConversations(ids);
    const { currentConversationId } = get();
    if (currentConversationId && ids.includes(currentConversationId)) {
      set({ currentConversationId: null, messages: [] });
    }
    await get().loadConversations();
  },
  renameConversation: async (id, title) => {
    await api.renameConversation(id, title);
    await get().loadConversations();
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
  loadProviders: async () => {
    const providers = await api.listProviders();
    set({ providers });
    // Only auto-select if current selection is null or no longer valid
    const { selectedProviderId } = get();
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
  },
  setSelectedProvider: (id) => {
    const provider = get().providers.find((p) => p.id === id);
    set({
      selectedProviderId: id,
      selectedModel: provider?.models[0] || null,
    });
  },
  setSelectedModel: (model) => set({ selectedModel: model }),

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
    await get().loadConversations();
    set({ currentConversationId: conv.id, currentScenarioId: null });
    await get().loadMessages(conv.id);
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
    const { providers } = get();
    const currentInstances = await api.listOpenClawInstances().catch(() => [] as OpenClawInstance[]);

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
