import { useAppStore } from "../stores/appStore";
import {
  DEFAULT_APPEARANCE_MODE,
  DEFAULT_ZOOM_FACTOR,
  resolveAppearanceTheme,
} from "./appearance";
import type {
  Conversation,
  ImageGenConfig,
  Message,
  PreviewBootstrap,
  Provider,
} from "./types";
import type { ResolvedUiLanguage, UiLanguage } from "./uiLanguage";

function timestamp(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

const PREVIEW_PROVIDER: Provider = {
  id: "preview-provider-openai",
  name: "OpenAI",
  api_type: "openai-compatible",
  base_url: "https://api.openai.com/v1",
  api_key: "sk-preview",
  models: ["gpt-5.4", "gpt-5.4-mini", "o4-mini"],
  is_default: true,
  created_at: timestamp(180),
};

const PREVIEW_CONVERSATIONS_EN: Conversation[] = [
  {
    id: "preview-conversation-main",
    title: "Plan a weekend in Kyoto with a toddler",
    preview: "Shrines in the morning, riverside lunch, naps by 2pm. Low-stress routing.",
    assistant_id: null,
    created_at: timestamp(210),
    updated_at: timestamp(6),
  },
  {
    id: "preview-conversation-notes",
    title: "Review the Series A pitch narrative",
    preview: "Tighten the problem slide and move the traction chart earlier.",
    assistant_id: null,
    created_at: timestamp(330),
    updated_at: timestamp(38),
  },
  {
    id: "preview-conversation-cn",
    title: "Translate the contract section into Japanese",
    preview: "Keep the legal tone formal, match the original clause numbering.",
    assistant_id: null,
    created_at: timestamp(450),
    updated_at: timestamp(92),
  },
];

const PREVIEW_CONVERSATIONS_ZH: Conversation[] = [
  {
    id: "preview-conversation-main",
    title: "规划一趟京都亲子周末",
    preview: "上午去神社，中午河边吃饭，下午两点午休。不赶时间。",
    assistant_id: null,
    created_at: timestamp(210),
    updated_at: timestamp(6),
  },
  {
    id: "preview-conversation-notes",
    title: "复盘 A 轮路演讲稿",
    preview: "把问题页再收紧一点，数据图提前到第三页。",
    assistant_id: null,
    created_at: timestamp(330),
    updated_at: timestamp(38),
  },
  {
    id: "preview-conversation-cn",
    title: "把合同第 3 条翻成日语",
    preview: "保持法律文本语气，条款编号和原文对齐。",
    assistant_id: null,
    created_at: timestamp(450),
    updated_at: timestamp(92),
  },
];

const PREVIEW_MESSAGES_EN: Message[] = [
  {
    id: "preview-message-1",
    conversation_id: PREVIEW_CONVERSATIONS_EN[0].id,
    role: "user",
    content: "We land Friday night with a 3-year-old. Plan a calm Saturday in Kyoto.",
    attachments: [],
    created_at: timestamp(24),
  },
  {
    id: "preview-message-2",
    conversation_id: PREVIEW_CONVERSATIONS_EN[0].id,
    role: "assistant",
    content:
      "Here is a low-stress Saturday:\n\n- 8:30 — Fushimi Inari, take only the lower torii loop\n- 10:30 — Stroller break at Kamo river, sandwich and tea\n- 13:00 — Nap at the hotel (core rule, never skip)\n- 16:00 — Nishiki market, pointing-at-snacks mode\n- 18:30 — Early kid-friendly dinner near Gion",
    attachments: [],
    created_at: timestamp(23),
  },
  {
    id: "preview-message-3",
    conversation_id: PREVIEW_CONVERSATIONS_EN[0].id,
    role: "user",
    content: "Great. Give me a one-line packing reminder I can paste into Notes.",
    attachments: [],
    created_at: timestamp(22),
  },
  {
    id: "preview-message-4",
    conversation_id: PREVIEW_CONVERSATIONS_EN[0].id,
    role: "assistant",
    content:
      "```text\nStroller, 2 snack boxes, 1 backup outfit, sunhat, water, charger, travel cup.\n```\n\n> Pro tip: keep a labeled pouch for wet clothes — you will thank yourself by 3pm.",
    attachments: [],
    created_at: timestamp(21),
  },
];

const PREVIEW_MESSAGES_ZH: Message[] = [
  {
    id: "preview-message-1",
    conversation_id: PREVIEW_CONVERSATIONS_ZH[0].id,
    role: "user",
    content: "我们周五晚上到京都，带一个 3 岁小朋友。帮我排一个不赶时间的周六。",
    attachments: [],
    created_at: timestamp(24),
  },
  {
    id: "preview-message-2",
    conversation_id: PREVIEW_CONVERSATIONS_ZH[0].id,
    role: "assistant",
    content:
      "安排一个慢节奏的周六：\n\n- 8:30 伏见稻荷，只走下面那段鸟居\n- 10:30 鸭川边上坐推车，面包和茶\n- 13:00 回酒店午睡（这条不能省）\n- 16:00 锦市场，指哪吃哪\n- 18:30 祇园附近找一家亲子友好的店吃早饭",
    attachments: [],
    created_at: timestamp(23),
  },
  {
    id: "preview-message-3",
    conversation_id: PREVIEW_CONVERSATIONS_ZH[0].id,
    role: "user",
    content: "不错。再给我一句可以直接贴进备忘录的打包提醒。",
    attachments: [],
    created_at: timestamp(22),
  },
  {
    id: "preview-message-4",
    conversation_id: PREVIEW_CONVERSATIONS_ZH[0].id,
    role: "assistant",
    content:
      "```text\n推车、两盒零食、一套备换衣服、防晒帽、水壶、充电器、出行杯。\n```\n\n> 小贴士：带一个写了字的湿衣袋 —— 下午三点你就会感谢自己。",
    attachments: [],
    created_at: timestamp(21),
  },
];

function normalizedScreen(screen: string | null | undefined): string | null {
  if (!screen) return null;
  return screen.trim().toLowerCase();
}

interface PreviewRuntimeState {
  view: string;
  currentConversationId: string | null;
  conversationCount: number;
  providerCount: number;
  selectedProviderId: string | null;
  selectedModel: string | null;
  pinEnabled: boolean;
  isLocked: boolean;
}

const PREVIEW_IMAGE_GEN_CONFIG: ImageGenConfig = {
  enabled: true,
  provider_id: PREVIEW_PROVIDER.id,
  model: "gpt-image-1",
  default_aspect_ratio: "1:1",
  default_quality: "standard",
  default_background: "auto",
  max_images_per_request: 4,
};

function normalizedLang(value: string | null | undefined): UiLanguage | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === "zh" || v === "zh-cn" || v === "zh_cn") return "zh-CN";
  if (v === "en" || v === "en-us") return "en";
  return null;
}

export function readBrowserPreviewBootstrap(): PreviewBootstrap | null {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const screen = normalizedScreen(
    params.get("preview") ?? params.get("screen") ?? params.get("previewScreen"),
  );

  if (!screen) {
    return null;
  }

  return {
    screen,
    dataset:
      params.get("previewData") ?? params.get("dataset") ?? params.get("data"),
    lang: params.get("lang") ?? params.get("locale") ?? null,
  };
}

export function browserPreviewNeedsBootstrap(
  preview: PreviewBootstrap,
  state: PreviewRuntimeState,
): boolean {
  const screen = normalizedScreen(preview.screen);
  if (!screen) {
    return false;
  }

  const dataset = (preview.dataset ?? "demo").trim().toLowerCase();
  const expectsSeededContent = dataset !== "empty" || screen === "chat";

  if (screen === "pin") {
    return !state.pinEnabled || !state.isLocked;
  }

  if (screen === "settings") {
    return (
      state.view !== "settings" ||
      (expectsSeededContent &&
        (state.providerCount === 0 ||
          state.conversationCount === 0 ||
          !state.selectedProviderId ||
          !state.selectedModel))
    );
  }

  if (screen === "chat") {
    return (
      state.view !== "chat" ||
      !state.currentConversationId ||
      state.providerCount === 0 ||
      !state.selectedProviderId ||
      !state.selectedModel
    );
  }

  if (screen === "list") {
    return (
      state.view !== "chat" ||
      !!state.currentConversationId ||
      state.providerCount === 0 ||
      state.conversationCount === 0
    );
  }

  if (screen === "welcome") {
    return (
      state.view !== "chat" ||
      !!state.currentConversationId ||
      (dataset === "empty"
        ? state.providerCount !== 0 || state.conversationCount !== 0
        : state.providerCount === 0)
    );
  }

  return false;
}

export function applyPreviewBootstrap(preview: PreviewBootstrap): boolean {
  const screen = normalizedScreen(preview.screen);
  if (!screen) {
    return false;
  }

  const dataset = (preview.dataset ?? "demo").trim().toLowerCase();
  const hasSeededContent = dataset !== "empty" || screen === "chat";
  const providers = hasSeededContent ? [PREVIEW_PROVIDER] : [];
  const lang = normalizedLang(preview.lang);
  const resolvedLang: ResolvedUiLanguage = lang === "zh-CN" ? "zh-CN" : lang === "en" ? "en" : "en";
  const uiLang: UiLanguage = lang ?? "auto";
  const conversationBundle = resolvedLang === "zh-CN" ? PREVIEW_CONVERSATIONS_ZH : PREVIEW_CONVERSATIONS_EN;
  const messageBundle = resolvedLang === "zh-CN" ? PREVIEW_MESSAGES_ZH : PREVIEW_MESSAGES_EN;
  const conversations =
    screen === "welcome" || dataset === "empty" ? [] : conversationBundle;
  const currentConversationId =
    screen === "chat" ? conversationBundle[0]?.id ?? null : null;
  const viewTarget = screen === "settings" ? "settings" : "chat";

  useAppStore.setState({
    view: viewTarget,
    conversations,
    currentConversationId,
    messages: screen === "chat" ? messageBundle : [],
    isStreaming: false,
    providers,
    selectedProviderId: providers[0]?.id ?? null,
    selectedModel: providers[0]?.models[0] ?? null,
    contextMaxMessages: 50,
    sttProviderId: providers[0]?.id ?? null,
    sttModel: "whisper-1",
    ttsProviderId: providers[0]?.id ?? null,
    ttsModel: "tts-1",
    ttsVoice: "alloy",
    imageGenConfig: PREVIEW_IMAGE_GEN_CONFIG,
    appearanceMode: DEFAULT_APPEARANCE_MODE,
    systemTheme: "dark",
    resolvedTheme: resolveAppearanceTheme(DEFAULT_APPEARANCE_MODE, "dark"),
    zoomFactor: DEFAULT_ZOOM_FACTOR,
    uiLanguage: uiLang,
    resolvedLanguage: resolvedLang,
    pinEnabled: screen === "pin",
    isLocked: screen === "pin",
  });

  return true;
}

export function previewSettingValue(key: string): string | null {
  const preview = readBrowserPreviewBootstrap();
  if (!preview) {
    return null;
  }

  switch (key) {
    case "ui_language":
      return "zh-CN";
    case "assistant_preset":
      return "default";
    case "assistant_language":
      return "auto";
    case "assistant_custom_prompt":
      return "";
    case "context_max_messages":
      return "50";
    case "appearance_mode":
      return DEFAULT_APPEARANCE_MODE;
    case "ui_zoom_factor":
      return DEFAULT_ZOOM_FACTOR.toFixed(2);
    case "stt_provider_id":
      return PREVIEW_PROVIDER.id;
    case "stt_model":
      return "whisper-1";
    case "tts_provider_id":
      return PREVIEW_PROVIDER.id;
    case "tts_model":
      return "tts-1";
    case "tts_voice":
      return "alloy";
    case "image_gen_config":
      return JSON.stringify(PREVIEW_IMAGE_GEN_CONFIG);
    default:
      return null;
  }
}
