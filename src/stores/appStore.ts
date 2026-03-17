import { create } from "zustand";
import type { Conversation, Message, Provider } from "../lib/types";
import * as api from "../lib/tauri";

type View = "chat" | "settings";

interface AppState {
  // UI
  view: View;
  setView: (view: View) => void;

  // Conversations
  conversations: Conversation[];
  currentConversationId: string | null;
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  createConversation: () => Promise<string>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;

  // Messages
  messages: Message[];
  loadMessages: (conversationId: string) => Promise<void>;
  addMessage: (msg: Message) => void;
  updateLastAssistantContent: (content: string) => void;
  clearStreamingContent: () => void;

  // Streaming
  isStreaming: boolean;
  streamingContent: string;
  setStreaming: (streaming: boolean) => void;
  appendStreamingContent: (chunk: string) => void;

  // Providers
  providers: Provider[];
  selectedProviderId: string | null;
  selectedModel: string | null;
  loadProviders: () => Promise<void>;
  setSelectedProvider: (id: string) => void;
  setSelectedModel: (model: string) => void;

  // PIN
  isLocked: boolean;
  pinEnabled: boolean;
  setLocked: (locked: boolean) => void;
  checkPinStatus: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  // UI
  view: "chat",
  setView: (view) => set({ view }),

  // Conversations
  conversations: [],
  currentConversationId: null,
  loadConversations: async () => {
    const conversations = await api.listConversations();
    set({ conversations });
  },
  selectConversation: async (id) => {
    set({ currentConversationId: id, view: "chat" });
    await get().loadMessages(id);
  },
  createConversation: async () => {
    const conv = await api.createConversation();
    await get().loadConversations();
    set({ currentConversationId: conv.id, messages: [], view: "chat" });
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
  renameConversation: async (id, title) => {
    await api.renameConversation(id, title);
    await get().loadConversations();
  },

  // Messages
  messages: [],
  loadMessages: async (conversationId) => {
    const messages = await api.getMessages(conversationId);
    set({ messages });
  },
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  updateLastAssistantContent: (content) =>
    set((s) => {
      const msgs = [...s.messages];
      const lastIdx = msgs.length - 1;
      if (lastIdx >= 0 && msgs[lastIdx].role === "assistant") {
        msgs[lastIdx] = { ...msgs[lastIdx], content };
      }
      return { messages: msgs };
    }),
  clearStreamingContent: () => set({ streamingContent: "" }),

  // Streaming
  isStreaming: false,
  streamingContent: "",
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  appendStreamingContent: (chunk) =>
    set((s) => ({ streamingContent: s.streamingContent + chunk })),

  // Providers
  providers: [],
  selectedProviderId: null,
  selectedModel: null,
  loadProviders: async () => {
    const providers = await api.listProviders();
    set({ providers });
    // Auto-select default provider
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
  },
  setSelectedProvider: (id) => {
    const provider = get().providers.find((p) => p.id === id);
    set({
      selectedProviderId: id,
      selectedModel: provider?.models[0] || null,
    });
  },
  setSelectedModel: (model) => set({ selectedModel: model }),

  // PIN
  isLocked: false,
  pinEnabled: false,
  setLocked: (locked) => set({ isLocked: locked }),
  checkPinStatus: async () => {
    const enabled = await api.isPinEnabled();
    set({ pinEnabled: enabled, isLocked: enabled });
  },
}));
