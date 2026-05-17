import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  Assistant,
  AttachmentUpload,
  Conversation,
  ConversationUsage,
  DailyUsage,
  ExportConfigResult,
  GeneratedAssistantMessage,
  ImageGenConfig,
  ImportConfigResult,
  Message,
  MessageResendPayload,
  PreviewBootstrap,
  Provider,
  TtsResult,
  ValidateBackupResult,
} from "./types";

const PREVIEW_PROVIDER_ID = "preview-provider-openai";
const PREVIEW_ASSISTANTS: Assistant[] = [
  {
    id: "preset-default-assistant",
    name: "Balanced Assistant",
    description: "General-purpose replies with clear, practical tone.",
    system_prompt: "You are Private Talk, a clear, helpful, and concise assistant.",
    icon: "sparkles",
    is_preset: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "preset-coding-assistant",
    name: "Coding Assistant",
    description: "Implementation-focused help for debugging, architecture, and code quality.",
    system_prompt: "You are a senior software engineer.",
    icon: "code",
    is_preset: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "preset-writing-assistant",
    name: "Writing Assistant",
    description: "Sharper structure, phrasing, and editing support for drafts.",
    system_prompt: "You are a writing assistant.",
    icon: "pen",
    is_preset: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "preset-translator",
    name: "Translation Assistant",
    description: "Meaning-first translation with terminology and format preserved.",
    system_prompt: "You are a translation assistant.",
    icon: "languages",
    is_preset: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "preset-research-assistant",
    name: "Research Assistant",
    description: "Tradeoff-aware synthesis for options, planning, and comparisons.",
    system_prompt: "You are a research assistant.",
    icon: "search",
    is_preset: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];
const PREVIEW_USAGE_BY_CONVERSATION: ConversationUsage[] = [
  {
    conversation_id: "preview-conversation-main",
    conversation_title: "Ship the iPad split-view polish for iOS 26",
    is_deleted: false,
    first_message_preview: "Tighten the chrome, safe areas, and bubble width on iPad landscape.",
    created_at: new Date(Date.now() - 1000 * 60 * 80).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    latest_at: new Date().toISOString(),
    message_count: 14,
    total_requests: 6,
    model_usages: [
      {
        model: "gpt-5.4",
        prompt_tokens: 8420,
        completion_tokens: 3910,
        total_tokens: 12330,
        request_count: 6,
      },
    ],
  },
  {
    conversation_id: "preview-conversation-notes",
    conversation_title: "Design notes and motion pass",
    is_deleted: false,
    first_message_preview: "Review the motion curve and hover glow intensity before shipping.",
    created_at: new Date(Date.now() - 1000 * 60 * 240).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    latest_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    message_count: 8,
    total_requests: 3,
    model_usages: [
      {
        model: "gpt-5.4-mini",
        prompt_tokens: 2210,
        completion_tokens: 980,
        total_tokens: 3190,
        request_count: 3,
      },
    ],
  },
];
const PREVIEW_USAGE_BY_DATE: DailyUsage[] = [
  {
    date: new Date().toISOString().slice(0, 10),
    conversation_count: 2,
    model_usages: [
      {
        model: "gpt-5.4",
        prompt_tokens: 8420,
        completion_tokens: 3910,
        total_tokens: 12330,
        request_count: 6,
      },
      {
        model: "gpt-5.4-mini",
        prompt_tokens: 2210,
        completion_tokens: 980,
        total_tokens: 3190,
        request_count: 3,
      },
    ],
  },
];

function previewSettingValue(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const screen = (
    params.get("preview") ??
    params.get("screen") ??
    params.get("previewScreen") ??
    ""
  )
    .trim()
    .toLowerCase();

  if (!screen) {
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
      return "dark";
    case "ui_zoom_factor":
      return "1.00";
    case "stt_provider_id":
      return PREVIEW_PROVIDER_ID;
    case "stt_model":
      return "whisper-1";
    case "tts_provider_id":
      return PREVIEW_PROVIDER_ID;
    case "tts_model":
      return "tts-1";
    case "tts_voice":
      return "alloy";
    case "image_gen_config":
      return JSON.stringify({
        enabled: true,
        provider_id: PREVIEW_PROVIDER_ID,
        model: "gpt-image-1",
        default_aspect_ratio: "1:1",
        default_quality: "standard",
        default_background: "auto",
        max_images_per_request: 4,
      } satisfies ImageGenConfig);
    default:
      return null;
  }
}

// Thin wrapper around `invoke` to keep the public API consistent.
function cmd<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(name, args);
}

export function getPreviewBootstrap(): Promise<PreviewBootstrap> {
  return cmd("get_preview_bootstrap");
}

// Conversation commands
export function listConversations(): Promise<Conversation[]> {
  return cmd("list_conversations");
}

export function createConversation(
  title?: string,
  assistantId?: string | null,
): Promise<Conversation> {
  return cmd("create_conversation", { title, assistantId });
}

export function updateConversationAssistant(
  id: string,
  assistantId?: string | null,
): Promise<Conversation> {
  return cmd("update_conversation_assistant", { id, assistantId });
}

export function deleteConversation(id: string): Promise<void> {
  return cmd("delete_conversation", { id });
}

export function renameConversation(id: string, title: string): Promise<void> {
  return cmd("rename_conversation", { id, title });
}

export function getMessages(conversationId: string): Promise<Message[]> {
  return cmd("get_messages", { conversationId });
}

export function getMessageResendPayload(messageId: string): Promise<MessageResendPayload> {
  return cmd("get_message_resend_payload", { messageId });
}

export function truncateConversationFromMessage(messageId: string): Promise<void> {
  return cmd("truncate_conversation_from_message", { messageId });
}

export function listAssistants(): Promise<Assistant[]> {
  if (!isTauri()) {
    return Promise.resolve(PREVIEW_ASSISTANTS);
  }
  return cmd("list_assistants");
}

export function createAssistant(
  name: string,
  description: string,
  systemPrompt: string,
  icon?: string,
): Promise<Assistant> {
  return cmd("create_assistant", { name, description, systemPrompt, icon });
}

export function updateAssistant(
  id: string,
  name?: string,
  description?: string,
  systemPrompt?: string,
  icon?: string,
): Promise<void> {
  return cmd("update_assistant", { id, name, description, systemPrompt, icon });
}

export function deleteAssistant(id: string): Promise<void> {
  return cmd("delete_assistant", { id });
}

export function duplicateAssistant(id: string): Promise<Assistant> {
  return cmd("duplicate_assistant", { id });
}

// Provider commands
export function listProviders(): Promise<Provider[]> {
  return cmd("list_providers");
}

export function createProvider(
  name: string,
  baseUrl: string,
  apiKey: string,
  models: string[],
): Promise<Provider> {
  return cmd("create_provider", { name, baseUrl, apiKey, models });
}

export function updateProvider(
  id: string,
  name?: string,
  baseUrl?: string,
  apiKey?: string,
  models?: string[],
): Promise<void> {
  return cmd("update_provider", { id, name, baseUrl, apiKey, models });
}

export function deleteProvider(id: string): Promise<void> {
  return cmd("delete_provider", { id });
}

export function setDefaultProvider(id: string): Promise<void> {
  return cmd("set_default_provider", { id });
}

// Chat commands
export function sendMessage(
  conversationId: string,
  content: string,
  userDisplayContent: string,
  providerId: string,
  model: string,
  userMessageId: string,
  attachmentsUpload?: AttachmentUpload[],
): Promise<void> {
  return cmd("send_message", {
    conversationId,
    content,
    userDisplayContent,
    providerId,
    model,
    userMessageId,
    attachmentsUpload,
  });
}

export function stopGeneration(): Promise<void> {
  return cmd("stop_generation");
}

const DEFAULT_IMAGE_GEN_CONFIG: ImageGenConfig = {
  enabled: false,
  provider_id: "",
  model: "",
  default_aspect_ratio: "1:1",
  default_quality: "standard",
  default_background: "auto",
  max_images_per_request: 4,
};

export async function getImageGenConfig(): Promise<ImageGenConfig> {
  const raw = await getSetting("image_gen_config");
  if (!raw) {
    return DEFAULT_IMAGE_GEN_CONFIG;
  }

  try {
    return {
      ...DEFAULT_IMAGE_GEN_CONFIG,
      ...JSON.parse(raw),
    } as ImageGenConfig;
  } catch (error) {
    console.warn("Failed to parse image generation config:", error);
    return DEFAULT_IMAGE_GEN_CONFIG;
  }
}

export function setImageGenConfig(config: ImageGenConfig): Promise<void> {
  return setSetting("image_gen_config", JSON.stringify(config));
}

export function generateImageMessage(
  conversationId: string,
  content: string,
  userDisplayContent?: string,
  referenceImageBase64?: string,
  referenceMimeType?: string,
): Promise<GeneratedAssistantMessage> {
  return cmd("generate_image_message", {
    conversationId,
    content,
    userDisplayContent,
    referenceImageBase64,
    referenceMimeType,
  });
}

// Settings commands
export function getSetting(key: string): Promise<string | null> {
  if (!isTauri()) {
    return Promise.resolve(previewSettingValue(key));
  }
  return cmd("get_setting", { key });
}

export function setSetting(key: string, value: string): Promise<void> {
  if (!isTauri()) {
    return Promise.resolve();
  }
  return cmd("set_setting", { key, value });
}

// PIN commands
export function isPinEnabled(): Promise<boolean> {
  return cmd("is_pin_enabled");
}

export function getPinLength(): Promise<number | null> {
  return cmd("get_pin_length");
}

export function verifyPin(inputPin: string): Promise<boolean> {
  return cmd("verify_pin_cmd", { inputPin });
}

export function enablePin(newPin: string): Promise<void> {
  return cmd("enable_pin", { newPin });
}

export function disablePin(currentPin: string): Promise<boolean> {
  return cmd("disable_pin", { currentPin });
}

export function resetAllData(): Promise<void> {
  return cmd("reset_all_data");
}

export function sttTranscribe(
  audioBase64: string,
  providerId: string,
  mimeType?: string,
): Promise<string> {
  return cmd("stt_transcribe", { audioBase64, providerId, mimeType });
}

export function ttsSynthesize(
  text: string,
  providerId: string,
  model: string,
  voice: string,
  responseFormat?: string,
): Promise<TtsResult> {
  return cmd("tts_synthesize", {
    text,
    providerId,
    model,
    voice,
    responseFormat,
  });
}

export function getUsageByConversation(): Promise<ConversationUsage[]> {
  if (!isTauri()) {
    return Promise.resolve(PREVIEW_USAGE_BY_CONVERSATION);
  }
  return cmd("get_usage_by_conversation");
}

export function getUsageByDate(): Promise<DailyUsage[]> {
  if (!isTauri()) {
    return Promise.resolve(PREVIEW_USAGE_BY_DATE);
  }
  return cmd("get_usage_by_date");
}

export function exportConfigData(password: string): Promise<ExportConfigResult> {
  if (!isTauri()) {
    return Promise.resolve({
      file_name: "private-talk-preview.ptbackup",
      data: Array.from(
        new TextEncoder().encode(
          JSON.stringify({
            password_length: password.length,
            providers: 1,
            assistants: 1,
            settings: 11,
          }),
        ),
      ),
      providers: 1,
      assistants: 1,
      settings: 11,
    });
  }
  return cmd("export_config_data", { password });
}

export function validateBackupData(
  password: string,
  data: number[],
): Promise<ValidateBackupResult> {
  if (!isTauri()) {
    return Promise.resolve({
      providers: data.length > 0 ? 1 : 0,
      assistants: data.length > 0 ? 1 : 0,
      settings: password.trim() ? 11 : 0,
      has_local_config: true,
    });
  }
  return cmd("validate_backup_data", { password, data });
}

export function importConfigData(
  password: string,
  data: number[],
  mode: "merge" | "replace",
): Promise<ImportConfigResult> {
  if (!isTauri()) {
    return Promise.resolve({
      providers: data.length > 0 ? 1 : 0,
      assistants: data.length > 0 ? 1 : 0,
      settings: password.trim() ? 11 : 0,
    });
  }
  return cmd("import_config_data", { password, data, mode });
}
