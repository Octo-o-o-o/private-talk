import { invoke } from "@tauri-apps/api/core";
import type {
  Conversation,
  ConversationUsage,
  DailyUsage,
  LocalOpenClawDetection,
  LocalProviderScanResult,
  Message,
  OpenClawAgent,
  OpenClawInstance,
  MicrophonePermissionInfo,
  NativeSttInfo,
  Provider,
  ProviderModelDiscovery,
  Assistant,
  TtsResult,
  Voice,
  VoiceSegmentResult,
  VoiceEngineConfig,
} from "./types";

interface BackendConversation {
  id: string;
  title: string;
  assistant_id?: string | null;
  scenario_id?: string | null;
  created_at: string;
  updated_at: string;
  openclaw_instance_id: string | null;
  openclaw_agent_id: string | null;
  openclaw_session_key: string | null;
}

function normalizeConversation(conversation: BackendConversation): Conversation {
  const assistantId = conversation.assistant_id ?? conversation.scenario_id ?? null;
  return {
    ...conversation,
    assistant_id: assistantId,
    scenario_id: assistantId,
  };
}

// Conversation commands
export const listConversations = async (assistantId?: string) =>
  (await invoke<BackendConversation[]>("list_conversations", { assistantId })).map(
    normalizeConversation
  );

export const listFreeConversations = () =>
  invoke<BackendConversation[]>("list_free_conversations").then((conversations) =>
    conversations.map(normalizeConversation)
  );

export const createConversation = (
  title?: string,
  assistantId?: string,
  openclawInstanceId?: string,
  openclawAgentId?: string
) =>
  invoke<BackendConversation>("create_conversation", {
    title,
    assistantId,
    openclawInstanceId,
    openclawAgentId,
  }).then(normalizeConversation);

export const updateConversationAssistant = (id: string, assistantId?: string) =>
  invoke<BackendConversation>("update_conversation_assistant", { id, assistantId }).then(
    normalizeConversation
  );

export const updateConversationScenario = updateConversationAssistant;

export const deleteConversation = (id: string) =>
  invoke<void>("delete_conversation", { id });

export const renameConversation = (id: string, title: string) =>
  invoke<void>("rename_conversation", { id, title });

export const getMessages = (conversationId: string) =>
  invoke<Message[]>("get_messages", { conversationId });

// Provider commands
export const listProviders = () => invoke<Provider[]>("list_providers");

export const createProvider = (
  name: string,
  baseUrl: string,
  apiKey: string,
  models: string[]
) => invoke<Provider>("create_provider", { name, baseUrl, apiKey, models });

export const updateProvider = (
  id: string,
  name?: string,
  baseUrl?: string,
  apiKey?: string,
  models?: string[]
) => invoke<void>("update_provider", { id, name, baseUrl, apiKey, models });

export const deleteProvider = (id: string) =>
  invoke<void>("delete_provider", { id });

export const setDefaultProvider = (id: string) =>
  invoke<void>("set_default_provider", { id });

export const discoverProviderModels = (
  baseUrl: string,
  apiKey: string | null,
  discoveryMode: string
) =>
  invoke<ProviderModelDiscovery>("discover_provider_models", {
    baseUrl,
    apiKey,
    discoveryMode,
  });

export const scanLocalProviders = () =>
  invoke<LocalProviderScanResult[]>("scan_local_providers");

// Assistant commands
export const listAssistants = () => invoke<Assistant[]>("list_assistants");

export const getAssistant = (id: string) =>
  invoke<Assistant>("get_assistant", { id });

export const createAssistant = (
  name: string,
  description: string,
  systemPrompt: string,
  icon?: string,
  voiceMapping?: Record<string, string | null>,
  ttsEnabled?: boolean,
  autoPlay?: boolean
) =>
  invoke<Assistant>("create_assistant", {
    name,
    description,
    systemPrompt,
    icon,
    voiceMapping,
    ttsEnabled,
    autoPlay,
  });

export const updateAssistant = (
  id: string,
  name?: string,
  description?: string,
  systemPrompt?: string,
  icon?: string,
  voiceMapping?: Record<string, string | null>,
  ttsEnabled?: boolean,
  autoPlay?: boolean
) =>
  invoke<void>("update_assistant", {
    id,
    name,
    description,
    systemPrompt,
    icon,
    voiceMapping,
    ttsEnabled,
    autoPlay,
  });

export const deleteAssistant = (id: string) =>
  invoke<void>("delete_assistant", { id });

export const duplicateAssistant = (id: string) =>
  invoke<Assistant>("duplicate_assistant", { id });

export const listScenarios = listAssistants;
export const getScenario = getAssistant;
export const createScenario = createAssistant;
export const updateScenario = updateAssistant;
export const deleteScenario = deleteAssistant;
export const duplicateScenario = duplicateAssistant;

// Chat commands
export const sendMessage = (
  conversationId: string,
  content: string,
  providerId: string,
  model: string,
  userMsgId: string,
  attachmentIds?: string[]
) =>
  invoke<void>("send_message", { conversationId, content, providerId, model, userMsgId, attachmentIds });

// Attachment commands
export const prepareAttachments = (filePaths: string[]) =>
  invoke<string[]>("prepare_attachments", { filePaths });

export const prepareImageAttachment = (imageBase64: string, mimeType: string) =>
  invoke<string>("prepare_image_attachment", { imageBase64, mimeType });

export const prepareAudioAttachment = (audioBase64: string, mimeType: string) =>
  invoke<string>("prepare_audio_attachment", { audioBase64, mimeType });

export const prepareTextAttachment = (fileName: string, content: string, mimeType: string) =>
  invoke<string>("prepare_text_attachment", { fileName, content, mimeType });

export const stopGeneration = () => invoke<void>("stop_generation");

// Settings commands
export const getSetting = (key: string) =>
  invoke<string | null>("get_setting", { key });

export const setSetting = (key: string, value: string) =>
  invoke<void>("set_setting", { key, value });

export const getMicrophonePermissionStatus = () =>
  invoke<MicrophonePermissionInfo>("get_microphone_permission_status");

export const requestNativeMicrophonePermission = () =>
  invoke<MicrophonePermissionInfo>("request_microphone_permission");

export const openMicrophoneSettings = () =>
  invoke<boolean>("open_microphone_settings");

export const getNativeSttInfo = () =>
  invoke<NativeSttInfo>("get_native_stt_info");

export const beginNativeSttCapture = () =>
  invoke<NativeSttInfo>("begin_native_stt_capture");

export const finishNativeSttCapture = (
  audioBase64: string,
  mimeType?: string
) =>
  invoke<string>("finish_native_stt_capture", { audioBase64, mimeType });

export const cancelNativeSttCapture = () =>
  invoke<void>("cancel_native_stt_capture");

export const openNativeSttSettings = () =>
  invoke<boolean>("open_native_stt_settings");

// PIN commands
export const isPinEnabled = () => invoke<boolean>("is_pin_enabled");

export const verifyPin = (inputPin: string) =>
  invoke<boolean>("verify_pin_cmd", { inputPin });

export const enablePin = (newPin: string) =>
  invoke<void>("enable_pin", { newPin });

export const disablePin = (currentPin: string) =>
  invoke<boolean>("disable_pin", { currentPin });

export const resetAllData = () => invoke<void>("reset_all_data");

// Voice commands
export const listVoices = () => invoke<Voice[]>("list_voices");

export const getVoice = (id: string) => invoke<Voice>("get_voice", { id });

export const createVoice = (
  displayName: string,
  engine: string,
  engineConfig: VoiceEngineConfig,
  roleType: string,
  tags: string[]
) =>
  invoke<Voice>("create_voice", {
    displayName,
    engine,
    engineConfig,
    roleType,
    tags,
  });

export const updateVoice = (
  id: string,
  displayName?: string,
  engine?: string,
  engineConfig?: VoiceEngineConfig,
  roleType?: string,
  tags?: string[]
) =>
  invoke<void>("update_voice", {
    id,
    displayName,
    engine,
    engineConfig,
    roleType,
    tags,
  });

export const deleteVoice = (id: string) =>
  invoke<void>("delete_voice", { id });

/** Save base64 audio to disk and return the absolute file path (for TTS ref_audio). */
export const saveRefAudio = (audioBase64: string, fileName: string) =>
  invoke<string>("save_ref_audio", { audioBase64, fileName });

// TTS commands
export const ttsSynthesize = (voiceId: string, text: string) =>
  invoke<TtsResult>("tts_synthesize", { voiceId, text });

export const parseVoiceSegments = (
  text: string,
  assistantId?: string
) =>
  invoke<VoiceSegmentResult[]>("parse_voice_segments", {
    text,
    assistantId,
  });

// STT commands
export const sttTranscribe = (audioBase64: string, providerId: string, mimeType?: string) =>
  invoke<string>("stt_transcribe", { audioBase64, providerId, mimeType });

export const togglePinMessage = (messageId: string) =>
  invoke<boolean>("toggle_pin_message", { messageId });

export const deleteMessagesFrom = (conversationId: string, messageId: string) =>
  invoke<void>("delete_messages_from", { conversationId, messageId });

export const updateMessageContent = (messageId: string, content: string) =>
  invoke<void>("update_message_content", { messageId, content });

export const generateTitle = (
  conversationId: string,
  providerId: string,
  model: string
) =>
  invoke<string>("generate_title", { conversationId, providerId, model });

export const deleteConversations = async (ids: string[]) => {
  for (const id of ids) {
    await invoke<void>("delete_conversation", { id });
  }
};

// Usage commands
export const getUsageByConversation = () =>
  invoke<ConversationUsage[]>("get_usage_by_conversation");

export const getUsageByDate = () =>
  invoke<DailyUsage[]>("get_usage_by_date");

// OpenClaw commands
export const listOpenClawInstances = () =>
  invoke<OpenClawInstance[]>("list_openclaw_instances");

export const createOpenClawInstance = (
  name: string,
  gatewayUrl: string,
  token: string,
  skipCliCheck?: boolean,
  agentsCache?: string
) =>
  invoke<OpenClawInstance>("create_openclaw_instance", {
    name,
    gatewayUrl,
    token,
    skipCliCheck,
    agentsCache,
  });

export const updateOpenClawInstance = (
  id: string,
  name: string,
  gatewayUrl: string,
  token: string
) =>
  invoke<void>("update_openclaw_instance", { id, name, gatewayUrl, token });

export const deleteOpenClawInstance = (id: string) =>
  invoke<void>("delete_openclaw_instance", { id });

export const detectLocalOpenClaw = () =>
  invoke<LocalOpenClawDetection>("detect_local_openclaw");

export const listOpenClawAgents = (
  gatewayUrl: string,
  token: string,
  instanceId?: string
) =>
  invoke<OpenClawAgent[]>("list_openclaw_agents", {
    gatewayUrl,
    token,
    instanceId,
  });

export const sendOpenClawMessage = (
  conversationId: string,
  content: string,
  userMsgId: string,
  attachmentIds?: string[]
) =>
  invoke<void>("send_openclaw_message", { conversationId, content, userMsgId, attachmentIds });

export const stopOpenClawGeneration = (conversationId: string) =>
  invoke<void>("stop_openclaw_generation", { conversationId });

export const parseConnectionString = (input: string) =>
  invoke<{
    v: number;
    url: string;
    token: string;
    name: string | null;
    agents: { id: string; name: string; model: string; isDefault: boolean }[] | null;
  }>("parse_connection_string", { input });
