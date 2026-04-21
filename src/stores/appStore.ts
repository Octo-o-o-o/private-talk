import { create } from "zustand";
import * as api from "../lib/tauri";
import type { Conversation, Message, Provider } from "../lib/types";

type View = "chat" | "settings";

function updateConversationPreview(
  conversations: Conversation[],
  message: Message,
): Conversation[] {
  const match = conversations.find(
    (conversation) => conversation.id === message.conversation_id,
  );

  if (!match) {
    return conversations;
  }

  const nextConversation: Conversation = {
    ...match,
    preview: message.content,
    updated_at: message.created_at,
  };

  return [
    nextConversation,
    ...conversations.filter(
      (conversation) => conversation.id !== message.conversation_id,
    ),
  ];
}

interface AppState {
  // UI
  view: View;
  setView: (view: View) => void;

  // Conversations
  conversations: Conversation[];
  currentConversationId: string | null;
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  clearConversationSelection: () => void;
  createConversation: () => Promise<string>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;

  // Messages
  messages: Message[];
  loadMessages: (conversationId: string) => Promise<void>;
  addMessage: (msg: Message) => void;
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
    set({ conversations: await api.listConversations() });
  },
  selectConversation: async (id) => {
    set({ currentConversationId: id, view: "chat" });
    await get().loadMessages(id);
  },
  clearConversationSelection: () => {
    set({
      currentConversationId: null,
      messages: [],
      view: "chat",
      isStreaming: false,
      streamingContent: "",
    });
  },
  createConversation: async () => {
    const conv = await api.createConversation();
    await get().loadConversations();
    set({
      currentConversationId: conv.id,
      messages: [],
      view: "chat",
    });
    return conv.id;
  },
  deleteConversation: async (id) => {
    await api.deleteConversation(id);
    if (get().currentConversationId === id) {
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
    set({ messages: await api.getMessages(conversationId) });
  },
  addMessage: (msg) =>
    set((state) => ({
      messages: [...state.messages, msg],
      conversations: updateConversationPreview(state.conversations, msg),
    })),
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
    // Prefer the default provider, otherwise fall back to the first one.
    const active = providers.find((p) => p.is_default) ?? providers[0];
    set({
      providers,
      selectedProviderId: active?.id ?? null,
      selectedModel: active?.models[0] ?? null,
    });
  },
  setSelectedProvider: (id) => {
    const provider = get().providers.find((p) => p.id === id);
    set({
      selectedProviderId: id,
      selectedModel: provider?.models[0] ?? null,
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
