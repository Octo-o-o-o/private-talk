import { create } from "zustand";
import {
  normalizeUiLanguage,
  resolveUiLanguage,
  type ResolvedUiLanguage,
  type UiLanguage,
} from "../lib/uiLanguage";
import * as api from "../lib/tauri";
import type {
  Conversation,
  ImageGenConfig,
  Message,
  Provider,
} from "../lib/types";

type View = "chat" | "settings";

const CHAT_PROVIDER_SETTING_KEY = "chat_provider_id";
const CHAT_MODEL_SETTING_KEY = "chat_model";
const UI_LANGUAGE_SETTING_KEY = "ui_language";
const CONTEXT_MAX_MESSAGES_SETTING_KEY = "context_max_messages";
const STT_PROVIDER_SETTING_KEY = "stt_provider_id";
const STT_MODEL_SETTING_KEY = "stt_model";
const TTS_PROVIDER_SETTING_KEY = "tts_provider_id";
const TTS_MODEL_SETTING_KEY = "tts_model";
const TTS_VOICE_SETTING_KEY = "tts_voice";
const DEFAULT_CONTEXT_MAX_MESSAGES = 50;
const DEFAULT_STT_MODEL = "whisper-1";
const DEFAULT_TTS_MODEL = "tts-1";
const DEFAULT_TTS_VOICE = "alloy";
const DEFAULT_IMAGE_GEN_CONFIG: ImageGenConfig = {
  enabled: false,
  provider_id: "",
  model: "",
  default_aspect_ratio: "1:1",
  default_quality: "standard",
  default_background: "auto",
  max_images_per_request: 4,
};

function previewFromContent(content: string): string {
  return content
    .replace(/!\[[^\]]*]\([^)]+\)/g, "🖼 Image")
    .replace(/\[[^\]]+]\(([^)]+)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function previewFromMessage(message: Message): string {
  const contentPreview = previewFromContent(message.content);
  if (contentPreview) {
    return contentPreview;
  }

  if (message.attachments.length === 1) {
    return message.attachments[0]?.file_name ?? "";
  }

  if (message.attachments.length > 1) {
    return `${message.attachments.length} attachments`;
  }

  return "";
}

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
    preview: previewFromMessage(message),
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
  uiLanguage: UiLanguage;
  resolvedLanguage: ResolvedUiLanguage;
  loadUiPreferences: () => Promise<void>;
  setUiLanguage: (language: UiLanguage) => Promise<void>;

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
  contextMaxMessages: number;
  sttProviderId: string | null;
  sttModel: string;
  ttsProviderId: string | null;
  ttsModel: string;
  ttsVoice: string;
  imageGenConfig: ImageGenConfig;
  loadProviders: () => Promise<void>;
  loadChatSettings: () => Promise<void>;
  loadImageGenConfig: () => Promise<void>;
  setImageGenConfig: (config: ImageGenConfig) => Promise<void>;
  setContextMaxMessages: (value: number) => Promise<void>;
  loadSpeechSettings: () => Promise<void>;
  setSttProviderId: (id: string | null) => Promise<void>;
  setSttModel: (model: string) => Promise<void>;
  setTtsProviderId: (id: string | null) => Promise<void>;
  setTtsModel: (model: string) => Promise<void>;
  setTtsVoice: (voice: string) => Promise<void>;
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
  uiLanguage: "auto",
  resolvedLanguage: resolveUiLanguage("auto"),
  loadUiPreferences: async () => {
    const nextLanguage = normalizeUiLanguage(
      await api.getSetting(UI_LANGUAGE_SETTING_KEY),
    );
    set({
      uiLanguage: nextLanguage,
      resolvedLanguage: resolveUiLanguage(nextLanguage),
    });
  },
  setUiLanguage: async (language) => {
    const nextLanguage = normalizeUiLanguage(language);
    set({
      uiLanguage: nextLanguage,
      resolvedLanguage: resolveUiLanguage(nextLanguage),
    });
    await api.setSetting(UI_LANGUAGE_SETTING_KEY, nextLanguage);
  },

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
  contextMaxMessages: DEFAULT_CONTEXT_MAX_MESSAGES,
  sttProviderId: null,
  sttModel: DEFAULT_STT_MODEL,
  ttsProviderId: null,
  ttsModel: DEFAULT_TTS_MODEL,
  ttsVoice: DEFAULT_TTS_VOICE,
  imageGenConfig: DEFAULT_IMAGE_GEN_CONFIG,
  loadProviders: async () => {
    const [providers, storedProviderId, storedModel] = await Promise.all([
      api.listProviders(),
      api.getSetting(CHAT_PROVIDER_SETTING_KEY),
      api.getSetting(CHAT_MODEL_SETTING_KEY),
    ]);
    const active =
      providers.find((provider) => provider.id === storedProviderId) ??
      providers.find((provider) => provider.is_default) ??
      providers[0];
    const nextModel = active?.models.includes(storedModel ?? "")
      ? storedModel
      : active?.models[0] ?? null;

    set({
      providers,
      selectedProviderId: active?.id ?? null,
      selectedModel: nextModel,
    });

    const persistedProviderId = active?.id ?? "";
    const persistedModel = nextModel ?? "";

    if ((storedProviderId ?? "") !== persistedProviderId) {
      void api.setSetting(CHAT_PROVIDER_SETTING_KEY, persistedProviderId).catch((error) => {
        console.warn("Failed to persist selected provider:", error);
      });
    }

    if ((storedModel ?? "") !== persistedModel) {
      void api.setSetting(CHAT_MODEL_SETTING_KEY, persistedModel).catch((error) => {
        console.warn("Failed to persist selected model:", error);
      });
    }
  },
  loadChatSettings: async () => {
    const storedLimit = await api.getSetting(CONTEXT_MAX_MESSAGES_SETTING_KEY);
    const parsed = Number.parseInt(storedLimit ?? "", 10);
    const nextLimit =
      Number.isFinite(parsed) && parsed > 0
        ? parsed
        : DEFAULT_CONTEXT_MAX_MESSAGES;

    set({ contextMaxMessages: nextLimit });

    if ((storedLimit ?? "") !== String(nextLimit)) {
      void api.setSetting(CONTEXT_MAX_MESSAGES_SETTING_KEY, String(nextLimit)).catch((error) => {
        console.warn("Failed to persist context limit:", error);
      });
    }
  },
  setContextMaxMessages: async (value) => {
    const nextLimit =
      Number.isFinite(value) && value > 0
        ? Math.round(value)
        : DEFAULT_CONTEXT_MAX_MESSAGES;
    set({ contextMaxMessages: nextLimit });
    await api.setSetting(CONTEXT_MAX_MESSAGES_SETTING_KEY, String(nextLimit));
  },
  loadImageGenConfig: async () => {
    const config = await api.getImageGenConfig();
    set({ imageGenConfig: config });
  },
  setImageGenConfig: async (config) => {
    set({ imageGenConfig: config });
    await api.setImageGenConfig(config);
  },
  loadSpeechSettings: async () => {
    const [storedProviderId, storedModel, storedTtsProviderId, storedTtsModel, storedTtsVoice] =
      await Promise.all([
      api.getSetting(STT_PROVIDER_SETTING_KEY),
      api.getSetting(STT_MODEL_SETTING_KEY),
      api.getSetting(TTS_PROVIDER_SETTING_KEY),
      api.getSetting(TTS_MODEL_SETTING_KEY),
      api.getSetting(TTS_VOICE_SETTING_KEY),
    ]);
    set({
      sttProviderId: storedProviderId?.trim() ? storedProviderId : null,
      sttModel: storedModel?.trim() || DEFAULT_STT_MODEL,
      ttsProviderId: storedTtsProviderId?.trim() ? storedTtsProviderId : null,
      ttsModel: storedTtsModel?.trim() || DEFAULT_TTS_MODEL,
      ttsVoice: storedTtsVoice?.trim() || DEFAULT_TTS_VOICE,
    });
  },
  setSttProviderId: async (id) => {
    set({ sttProviderId: id });
    await api.setSetting(STT_PROVIDER_SETTING_KEY, id ?? "");
  },
  setSttModel: async (model) => {
    const nextModel = model.trim() || DEFAULT_STT_MODEL;
    set({ sttModel: nextModel });
    await api.setSetting(STT_MODEL_SETTING_KEY, nextModel);
  },
  setTtsProviderId: async (id) => {
    set({ ttsProviderId: id });
    await api.setSetting(TTS_PROVIDER_SETTING_KEY, id ?? "");
  },
  setTtsModel: async (model) => {
    const nextModel = model.trim() || DEFAULT_TTS_MODEL;
    set({ ttsModel: nextModel });
    await api.setSetting(TTS_MODEL_SETTING_KEY, nextModel);
  },
  setTtsVoice: async (voice) => {
    const nextVoice = voice.trim() || DEFAULT_TTS_VOICE;
    set({ ttsVoice: nextVoice });
    await api.setSetting(TTS_VOICE_SETTING_KEY, nextVoice);
  },
  setSelectedProvider: (id) => {
    const provider = get().providers.find((p) => p.id === id);
    const nextModel = provider?.models[0] ?? null;

    set({
      selectedProviderId: id,
      selectedModel: nextModel,
    });

    void api.setSetting(CHAT_PROVIDER_SETTING_KEY, id).catch((error) => {
      console.warn("Failed to persist selected provider:", error);
    });
    void api.setSetting(CHAT_MODEL_SETTING_KEY, nextModel ?? "").catch((error) => {
      console.warn("Failed to persist selected model:", error);
    });
  },
  setSelectedModel: (model) => {
    set({ selectedModel: model });
    void api.setSetting(CHAT_MODEL_SETTING_KEY, model).catch((error) => {
      console.warn("Failed to persist selected model:", error);
    });
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
