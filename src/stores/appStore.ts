import { create } from "zustand";
import {
  DEFAULT_APPEARANCE_MODE,
  DEFAULT_ZOOM_FACTOR,
  normalizeAppearanceMode,
  normalizeZoomFactor,
  resolveAppearanceTheme,
  serializeZoomFactor,
  type AppearanceMode,
  type ResolvedAppearanceTheme,
} from "../lib/appearance";
import {
  normalizeUiLanguage,
  resolveUiLanguage,
  type ResolvedUiLanguage,
  type UiLanguage,
} from "../lib/uiLanguage";
import {
  getProviderModelsForPurpose,
  parseProviderModelRegistry,
} from "../lib/providerModels";
import * as api from "../lib/tauri";
import type {
  Assistant,
  Conversation,
  ImageGenConfig,
  Message,
  ProviderModelRegistry,
  Provider,
} from "../lib/types";

type View = "chat" | "settings";
type SettingsTargetGroupId =
  | "general"
  | "assistants"
  | "models"
  | "media"
  | "data"
  | "about";

const CHAT_PROVIDER_SETTING_KEY = "chat_provider_id";
const CHAT_MODEL_SETTING_KEY = "chat_model";
const UI_LANGUAGE_SETTING_KEY = "ui_language";
const APPEARANCE_MODE_SETTING_KEY = "appearance_mode";
const UI_ZOOM_FACTOR_SETTING_KEY = "ui_zoom_factor";
const CONTEXT_MAX_MESSAGES_SETTING_KEY = "context_max_messages";
const STT_PROVIDER_SETTING_KEY = "stt_provider_id";
const STT_MODEL_SETTING_KEY = "stt_model";
const TTS_PROVIDER_SETTING_KEY = "tts_provider_id";
const TTS_MODEL_SETTING_KEY = "tts_model";
const TTS_VOICE_SETTING_KEY = "tts_voice";
const PROVIDER_MODEL_REGISTRY_SETTING_KEY = "provider_model_registry";
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
  settingsTargetGroupId: SettingsTargetGroupId | null;
  openSettings: (groupId?: SettingsTargetGroupId | null) => void;
  clearSettingsTargetGroup: () => void;
  uiLanguage: UiLanguage;
  resolvedLanguage: ResolvedUiLanguage;
  loadUiPreferences: () => Promise<void>;
  setUiLanguage: (language: UiLanguage) => Promise<void>;
  refreshResolvedLanguage: () => void;
  appearanceMode: AppearanceMode;
  systemTheme: ResolvedAppearanceTheme;
  resolvedTheme: ResolvedAppearanceTheme;
  zoomFactor: number;
  loadAppearancePreferences: () => Promise<void>;
  setAppearanceMode: (mode: AppearanceMode) => Promise<void>;
  setSystemTheme: (theme: ResolvedAppearanceTheme) => void;
  setZoomFactor: (zoomFactor: number) => Promise<void>;

  // Conversations
  conversations: Conversation[];
  assistants: Assistant[];
  currentAssistantId: string | null;
  currentConversationId: string | null;
  loadConversations: () => Promise<void>;
  loadAssistants: () => Promise<void>;
  selectAssistant: (id: string | null) => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  clearConversationSelection: () => void;
  createConversation: (assistantId?: string | null) => Promise<string>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;

  // Messages
  messages: Message[];
  loadMessages: (conversationId: string) => Promise<void>;
  addMessage: (msg: Message) => void;

  // Streaming
  isStreaming: boolean;
  setStreaming: (streaming: boolean) => void;

  // Providers
  providers: Provider[];
  providerModelRegistry: ProviderModelRegistry;
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
  settingsTargetGroupId: null,
  openSettings: (groupId) =>
    set({
      view: "settings",
      settingsTargetGroupId: groupId ?? null,
    }),
  clearSettingsTargetGroup: () => set({ settingsTargetGroupId: null }),
  uiLanguage: "auto",
  resolvedLanguage: resolveUiLanguage("auto"),
  appearanceMode: DEFAULT_APPEARANCE_MODE,
  systemTheme: "dark",
  resolvedTheme: resolveAppearanceTheme(DEFAULT_APPEARANCE_MODE, "dark"),
  zoomFactor: DEFAULT_ZOOM_FACTOR,
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
  refreshResolvedLanguage: () => {
    set((state) => ({
      resolvedLanguage: resolveUiLanguage(state.uiLanguage),
    }));
  },
  loadAppearancePreferences: async () => {
    const [storedAppearanceMode, storedZoomFactor] = await Promise.all([
      api.getSetting(APPEARANCE_MODE_SETTING_KEY),
      api.getSetting(UI_ZOOM_FACTOR_SETTING_KEY),
    ]);
    const nextAppearanceMode = normalizeAppearanceMode(storedAppearanceMode);
    const nextZoomFactor = normalizeZoomFactor(storedZoomFactor);

    set((state) => ({
      appearanceMode: nextAppearanceMode,
      zoomFactor: nextZoomFactor,
      resolvedTheme: resolveAppearanceTheme(
        nextAppearanceMode,
        state.systemTheme,
      ),
    }));

    if ((storedAppearanceMode ?? "") !== nextAppearanceMode) {
      void api
        .setSetting(APPEARANCE_MODE_SETTING_KEY, nextAppearanceMode)
        .catch((error) => {
          console.warn("Failed to persist appearance mode:", error);
        });
    }

    const serializedZoomFactor = serializeZoomFactor(nextZoomFactor);
    if ((storedZoomFactor ?? "") !== serializedZoomFactor) {
      void api
        .setSetting(UI_ZOOM_FACTOR_SETTING_KEY, serializedZoomFactor)
        .catch((error) => {
          console.warn("Failed to persist zoom factor:", error);
        });
    }
  },
  setAppearanceMode: async (mode) => {
    const nextAppearanceMode = normalizeAppearanceMode(mode);
    set((state) => ({
      appearanceMode: nextAppearanceMode,
      resolvedTheme: resolveAppearanceTheme(
        nextAppearanceMode,
        state.systemTheme,
      ),
    }));
    await api.setSetting(APPEARANCE_MODE_SETTING_KEY, nextAppearanceMode);
  },
  setSystemTheme: (theme) => {
    set((state) => ({
      systemTheme: theme,
      resolvedTheme: resolveAppearanceTheme(state.appearanceMode, theme),
    }));
  },
  setZoomFactor: async (zoomFactor) => {
    const nextZoomFactor = normalizeZoomFactor(zoomFactor);
    set({ zoomFactor: nextZoomFactor });
    await api.setSetting(
      UI_ZOOM_FACTOR_SETTING_KEY,
      serializeZoomFactor(nextZoomFactor),
    );
  },

  // Conversations
  conversations: [],
  assistants: [],
  currentAssistantId: null,
  currentConversationId: null,
  loadConversations: async () => {
    set({ conversations: await api.listConversations() });
  },
  loadAssistants: async () => {
    set({ assistants: await api.listAssistants() });
  },
  selectAssistant: async (id) => {
    const { currentConversationId, messages } = get();

    if (currentConversationId && messages.length === 0) {
      const updatedConversation = await api.updateConversationAssistant(
        currentConversationId,
        id ?? null,
      );
      set((state) => ({
        currentAssistantId: updatedConversation.assistant_id ?? null,
        conversations: state.conversations.map((conversation) =>
          conversation.id === currentConversationId
            ? {
                ...conversation,
                assistant_id: updatedConversation.assistant_id ?? null,
                updated_at: updatedConversation.updated_at,
              }
            : conversation,
        ),
      }));
      await get().loadConversations();
      return;
    }

    set({
      currentAssistantId: id ?? null,
      currentConversationId: null,
      messages: [],
      view: "chat",
      isStreaming: false,
    });
  },
  selectConversation: async (id) => {
    const conversation =
      get().conversations.find((item) => item.id === id) ?? null;
      set({ currentConversationId: id, view: "chat" });
    set({ currentAssistantId: conversation?.assistant_id ?? null });
    await get().loadMessages(id);
  },
  clearConversationSelection: () => {
    set({
      currentAssistantId: null,
      currentConversationId: null,
      messages: [],
      view: "chat",
      isStreaming: false,
    });
  },
  createConversation: async (assistantId) => {
    const nextAssistantId = assistantId ?? get().currentAssistantId ?? null;
    const conv = await api.createConversation(undefined, nextAssistantId);
    await get().loadConversations();
    set({
      currentAssistantId: conv.assistant_id ?? nextAssistantId,
      currentConversationId: conv.id,
      messages: [],
      view: "chat",
    });
    return conv.id;
  },
  deleteConversation: async (id) => {
    await api.deleteConversation(id);
    if (get().currentConversationId === id) {
      set({ currentAssistantId: null, currentConversationId: null, messages: [] });
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

  // Streaming
  isStreaming: false,
  setStreaming: (streaming) => set({ isStreaming: streaming }),

  // Providers
  providers: [],
  providerModelRegistry: {},
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
    const [providers, storedProviderId, storedModel, rawRegistry] = await Promise.all([
      api.listProviders(),
      api.getSetting(CHAT_PROVIDER_SETTING_KEY),
      api.getSetting(CHAT_MODEL_SETTING_KEY),
      api.getSetting(PROVIDER_MODEL_REGISTRY_SETTING_KEY),
    ]);
    const providerModelRegistry = parseProviderModelRegistry(rawRegistry);
    const chatProviders = providers.filter(
      (provider) =>
        getProviderModelsForPurpose(provider, providerModelRegistry, "chat").length > 0,
    );
    const active =
      chatProviders.find((provider) => provider.id === storedProviderId) ??
      chatProviders.find((provider) => provider.is_default) ??
      chatProviders[0] ??
      null;
    const availableChatModels = active
      ? getProviderModelsForPurpose(active, providerModelRegistry, "chat")
      : [];
    const nextModel = availableChatModels.includes(storedModel ?? "")
      ? storedModel
      : availableChatModels[0] ?? null;

    set({
      providers,
      providerModelRegistry,
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
    const { providers, providerModelRegistry } = get();
    const provider =
      providers.find((item) => item.id === config.provider_id) ?? null;
    const availableModels = provider
      ? getProviderModelsForPurpose(provider, providerModelRegistry, "image")
      : [];

    const nextConfig =
      !provider
        ? {
            ...config,
            enabled: false,
            provider_id: "",
            model: "",
          }
        : availableModels.length > 0
        ? {
            ...config,
            provider_id: provider.id,
            model:
              availableModels.includes(config.model) ? config.model : availableModels[0] ?? "",
          }
        : config;

    set({ imageGenConfig: nextConfig });

    if (JSON.stringify(config) !== JSON.stringify(nextConfig)) {
      void api.setImageGenConfig(nextConfig).catch((error) => {
        console.warn("Failed to persist image generation config:", error);
      });
    }
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
    const { providers, providerModelRegistry } = get();
    const sttProvider =
      providers.find((provider) => provider.id === storedProviderId) ?? null;
    const ttsProvider =
      providers.find((provider) => provider.id === storedTtsProviderId) ?? null;
    const availableSttModels = sttProvider
      ? getProviderModelsForPurpose(sttProvider, providerModelRegistry, "stt")
      : [];
    const availableTtsModels = ttsProvider
      ? getProviderModelsForPurpose(ttsProvider, providerModelRegistry, "tts")
      : [];
    const nextSttProviderId = sttProvider?.id ?? null;
    const nextTtsProviderId = ttsProvider?.id ?? null;
    const nextSttModel = nextSttProviderId
      ? availableSttModels.length > 0
        ? availableSttModels.includes(storedModel ?? "")
          ? storedModel?.trim() || DEFAULT_STT_MODEL
          : availableSttModels[0] ?? DEFAULT_STT_MODEL
        : storedModel?.trim() || DEFAULT_STT_MODEL
      : storedModel?.trim() || DEFAULT_STT_MODEL;
    const nextTtsModel = nextTtsProviderId
      ? availableTtsModels.length > 0
        ? availableTtsModels.includes(storedTtsModel ?? "")
          ? storedTtsModel?.trim() || DEFAULT_TTS_MODEL
          : availableTtsModels[0] ?? DEFAULT_TTS_MODEL
        : storedTtsModel?.trim() || DEFAULT_TTS_MODEL
      : storedTtsModel?.trim() || DEFAULT_TTS_MODEL;
    const nextTtsVoice = storedTtsVoice?.trim() || DEFAULT_TTS_VOICE;

    set({
      sttProviderId: nextSttProviderId,
      sttModel: nextSttModel,
      ttsProviderId: nextTtsProviderId,
      ttsModel: nextTtsModel,
      ttsVoice: nextTtsVoice,
    });

    if ((storedProviderId?.trim() || null) !== nextSttProviderId) {
      void api.setSetting(STT_PROVIDER_SETTING_KEY, nextSttProviderId ?? "").catch((error) => {
        console.warn("Failed to persist STT provider:", error);
      });
    }
    if ((storedModel?.trim() || DEFAULT_STT_MODEL) !== nextSttModel) {
      void api.setSetting(STT_MODEL_SETTING_KEY, nextSttModel).catch((error) => {
        console.warn("Failed to persist STT model:", error);
      });
    }
    if ((storedTtsProviderId?.trim() || null) !== nextTtsProviderId) {
      void api.setSetting(TTS_PROVIDER_SETTING_KEY, nextTtsProviderId ?? "").catch((error) => {
        console.warn("Failed to persist TTS provider:", error);
      });
    }
    if ((storedTtsModel?.trim() || DEFAULT_TTS_MODEL) !== nextTtsModel) {
      void api.setSetting(TTS_MODEL_SETTING_KEY, nextTtsModel).catch((error) => {
        console.warn("Failed to persist TTS model:", error);
      });
    }
    if ((storedTtsVoice?.trim() || DEFAULT_TTS_VOICE) !== nextTtsVoice) {
      void api.setSetting(TTS_VOICE_SETTING_KEY, nextTtsVoice).catch((error) => {
        console.warn("Failed to persist TTS voice:", error);
      });
    }
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
    const { providers, providerModelRegistry } = get();
    const provider = providers.find((p) => p.id === id);
    const nextModel = provider
      ? getProviderModelsForPurpose(provider, providerModelRegistry, "chat")[0] ?? null
      : null;

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
