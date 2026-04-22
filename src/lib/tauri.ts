import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AttachmentUpload,
  Conversation,
  ConversationUsage,
  DailyUsage,
  ExportConfigResult,
  GeneratedAssistantMessage,
  ImageGenConfig,
  ImportConfigResult,
  Message,
  PreviewBootstrap,
  Provider,
  TtsResult,
  ValidateBackupResult,
} from "./types";

const PREVIEW_PROVIDER_ID = "preview-provider-openai";
const PREVIEW_USAGE_BY_CONVERSATION: ConversationUsage[] = [
  {
    conversation_id: "preview-conversation-main",
    conversation_title: "Ship the iPad split-view polish for iOS 26",
    first_message_preview: "Tighten the chrome, safe areas, and bubble width on iPad landscape.",
    latest_at: new Date().toISOString(),
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
    first_message_preview: "Review the motion curve and hover glow intensity before shipping.",
    latest_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
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

export function createConversation(title?: string): Promise<Conversation> {
  return cmd("create_conversation", { title });
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
            settings: 11,
          }),
        ),
      ),
      providers: 1,
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
      settings: password.trim() ? 11 : 0,
    });
  }
  return cmd("import_config_data", { password, data, mode });
}
