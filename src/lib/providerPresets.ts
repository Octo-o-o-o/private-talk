export type ProviderDiscoveryMode = "openai-compatible" | "ollama";

export type ProviderPresetConfig = {
  id: string;
  name: string;
  baseUrl: string;
  description: {
    zh: string;
    en: string;
  };
  category: "cloud" | "local";
  discoveryMode: ProviderDiscoveryMode;
  apiKeyRequired: boolean;
  apiKeyPlaceholder: string;
  defaultModels: string[];
  recommendedModels: string[];
  /** Default image generation model for this provider (empty if not supported). */
  imageGenModel?: string;
};

export const PROVIDER_PRESETS: ProviderPresetConfig[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    description: {
      zh: "官方 OpenAI 端点。",
      en: "Official OpenAI endpoint.",
    },
    category: "cloud",
    discoveryMode: "openai-compatible",
    apiKeyRequired: true,
    apiKeyPlaceholder: "sk-...",
    defaultModels: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "o3", "o4-mini", "gpt-4.1"],
    recommendedModels: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "o3", "o4-mini", "gpt-4.1"],
    imageGenModel: "gpt-image-1",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    description: {
      zh: "统一接入多家模型供应商。",
      en: "Unified access to multiple model providers.",
    },
    category: "cloud",
    discoveryMode: "openai-compatible",
    apiKeyRequired: true,
    apiKeyPlaceholder: "sk-or-...",
    defaultModels: [
      "openai/gpt-5.4",
      "anthropic/claude-opus-4.6",
      "google/gemini-3.1-pro-preview",
      "deepseek/deepseek-chat",
      "x-ai/grok-4.20-0309-reasoning",
      "qwen/qwen3-coder",
    ],
    recommendedModels: [
      "openai/gpt-5.4",
      "anthropic/claude-opus-4.6",
      "google/gemini-3.1-pro-preview",
      "deepseek/deepseek-chat",
      "x-ai/grok-4.20-0309-reasoning",
      "qwen/qwen3-coder",
    ],
    imageGenModel: "openai/gpt-image-1",
  },
  {
    id: "gemini",
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    description: {
      zh: "Google Gemini OpenAI 兼容入口。",
      en: "Google Gemini OpenAI-compatible endpoint.",
    },
    category: "cloud",
    discoveryMode: "openai-compatible",
    apiKeyRequired: true,
    apiKeyPlaceholder: "AIza...",
    defaultModels: [
      "gemini-3-flash-preview",
      "gemini-3.1-pro-preview",
      "gemini-3.1-flash-lite-preview",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
    ],
    recommendedModels: [
      "gemini-3-flash-preview",
      "gemini-3.1-pro-preview",
      "gemini-3.1-flash-lite-preview",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
    ],
    imageGenModel: "imagen-3.0-generate-002",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    description: {
      zh: "DeepSeek 官方 OpenAI 兼容端点。",
      en: "Official DeepSeek OpenAI-compatible endpoint.",
    },
    category: "cloud",
    discoveryMode: "openai-compatible",
    apiKeyRequired: true,
    apiKeyPlaceholder: "sk-...",
    defaultModels: ["deepseek-chat", "deepseek-reasoner"],
    recommendedModels: ["deepseek-chat", "deepseek-reasoner"],
    imageGenModel: "",
  },
  {
    id: "grok",
    name: "Grok",
    baseUrl: "https://api.x.ai/v1",
    description: {
      zh: "xAI Grok 官方端点。",
      en: "Official xAI Grok endpoint.",
    },
    category: "cloud",
    discoveryMode: "openai-compatible",
    apiKeyRequired: true,
    apiKeyPlaceholder: "xai-...",
    defaultModels: [
      "grok-4.20-0309-reasoning",
      "grok-4.20-0309-non-reasoning",
      "grok-4-1-fast-reasoning",
      "grok-4-1-fast-non-reasoning",
    ],
    recommendedModels: [
      "grok-4.20-0309-reasoning",
      "grok-4.20-0309-non-reasoning",
      "grok-4-1-fast-reasoning",
      "grok-4-1-fast-non-reasoning",
    ],
    imageGenModel: "grok-2-image",
  },
  {
    id: "volcengine",
    name: "火山引擎",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    description: {
      zh: "字节跳动火山引擎（豆包）大模型平台。",
      en: "ByteDance Volcengine (Doubao) LLM platform.",
    },
    category: "cloud",
    discoveryMode: "openai-compatible",
    apiKeyRequired: true,
    apiKeyPlaceholder: "your-ark-api-key",
    defaultModels: [
      "doubao-seed-1-8",
      "doubao-seed-1-6",
      "doubao-seed-1-6-thinking",
      "doubao-seed-1-6-flash",
      "doubao-1.5-pro-256k",
      "doubao-1.5-pro-32k",
    ],
    recommendedModels: [
      "doubao-seed-1-8",
      "doubao-seed-1-6",
      "doubao-seed-1-6-thinking",
      "doubao-seed-1-6-flash",
      "doubao-1.5-pro-256k",
      "doubao-1.5-pro-32k",
    ],
    imageGenModel: "",
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    description: {
      zh: "智谱 OpenAI 兼容入口。",
      en: "Zhipu OpenAI-compatible endpoint.",
    },
    category: "cloud",
    discoveryMode: "openai-compatible",
    apiKeyRequired: true,
    apiKeyPlaceholder: "your-bigmodel-key",
    defaultModels: ["glm-5", "glm-5-turbo", "glm-4.7", "glm-4.7-flash", "glm-4.6"],
    recommendedModels: ["glm-5", "glm-5-turbo", "glm-4.7", "glm-4.7-flash", "glm-4.6"],
    imageGenModel: "cogview-4",
  },
  {
    id: "localai",
    name: "LocalAI",
    baseUrl: "http://localhost:8080/v1",
    description: {
      zh: "本地 OpenAI 兼容服务，支持 Stable Diffusion 等模型。",
      en: "Local OpenAI-compatible server supporting Stable Diffusion and more.",
    },
    category: "local",
    discoveryMode: "openai-compatible",
    apiKeyRequired: false,
    apiKeyPlaceholder: "",
    defaultModels: [],
    recommendedModels: [],
    imageGenModel: "stablediffusion",
  },
];

/** Given a provider's base_url, find the matching preset's image gen model. */
export function getImageGenModelForProvider(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  const preset = PROVIDER_PRESETS.find(
    (p) => normalized === p.baseUrl.replace(/\/+$/, "")
  );
  return preset?.imageGenModel ?? "";
}

const NON_CHAT_MODEL_PATTERN =
  /(embedding|rerank|tts|speech|transcribe|transcription|moderation|image|imagen|video|veo|audio|realtime|whisper)/i;

function dedupe(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function sortLexically(values: string[]) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function keepPreferred(discovered: string[], preferred: string[]) {
  const discoveredSet = new Set(discovered);
  return preferred.filter((model) => discoveredSet.has(model));
}

function excludeNonChatModels(models: string[]) {
  return models.filter((model) => !NON_CHAT_MODEL_PATTERN.test(model));
}

function filterModelsByPreset(preset: ProviderPresetConfig, discovered: string[]) {
  const chatLike = excludeNonChatModels(dedupe(discovered));

  switch (preset.id) {
    case "openai":
      return chatLike.filter(
        (model) => model.startsWith("gpt-") || /^o\d/.test(model)
      );
    case "openrouter":
      return chatLike.filter((model) =>
        /^(openai|anthropic|google|deepseek|x-ai|qwen|moonshotai|z-ai|minimax)\//i.test(model)
      );
    case "gemini":
      return chatLike.filter((model) => model.startsWith("gemini-"));
    case "deepseek":
      return chatLike.filter((model) => model.startsWith("deepseek-"));
    case "grok":
      return chatLike.filter((model) => model.startsWith("grok-") && !model.startsWith("grok-imagine"));
    case "volcengine":
      return chatLike.filter(
        (model) => model.startsWith("doubao-") || model.startsWith("deepseek-")
      );
    case "zhipu":
      return chatLike.filter((model) => model.toLowerCase().startsWith("glm-"));
    default:
      return dedupe(discovered);
  }
}

export function createProviderModelsString(preset?: ProviderPresetConfig | null) {
  return preset ? preset.defaultModels.join(",") : "";
}

export function pickModelsForPreset(
  preset: ProviderPresetConfig,
  discoveredModels: string[]
) {
  const filtered = filterModelsByPreset(preset, discoveredModels);
  const preferred = keepPreferred(filtered, preset.recommendedModels);
  const remaining = sortLexically(filtered.filter((model) => !preferred.includes(model)));
  const limit = preset.category === "local" ? 16 : 8;
  const combined = dedupe([...preferred, ...remaining]).slice(0, limit);
  return combined.length > 0 ? combined : preset.defaultModels;
}
