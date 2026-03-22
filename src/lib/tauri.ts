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
  Provider,
  ProviderModelDiscovery,
  Scenario,
  TtsResult,
  Voice,
  VoiceSegmentResult,
  VoiceEngineConfig,
} from "./types";

// Conversation commands
export const listConversations = (scenarioId?: string) =>
  invoke<Conversation[]>("list_conversations", { scenarioId });

export const listFreeConversations = () =>
  invoke<Conversation[]>("list_free_conversations");

export const createConversation = (
  title?: string,
  scenarioId?: string,
  openclawInstanceId?: string,
  openclawAgentId?: string
) =>
  invoke<Conversation>("create_conversation", {
    title,
    scenarioId,
    openclawInstanceId,
    openclawAgentId,
  });

export const updateConversationScenario = (id: string, scenarioId?: string) =>
  invoke<Conversation>("update_conversation_scenario", { id, scenarioId });

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

// Scenario commands
export const listScenarios = () => invoke<Scenario[]>("list_scenarios");

export const getScenario = (id: string) =>
  invoke<Scenario>("get_scenario", { id });

export const createScenario = (
  name: string,
  description: string,
  systemPrompt: string,
  icon?: string,
  voiceMapping?: Record<string, string | null>,
  ttsEnabled?: boolean,
  autoPlay?: boolean
) =>
  invoke<Scenario>("create_scenario", {
    name,
    description,
    systemPrompt,
    icon,
    voiceMapping,
    ttsEnabled,
    autoPlay,
  });

export const updateScenario = (
  id: string,
  name?: string,
  description?: string,
  systemPrompt?: string,
  icon?: string,
  voiceMapping?: Record<string, string | null>,
  ttsEnabled?: boolean,
  autoPlay?: boolean
) =>
  invoke<void>("update_scenario", {
    id,
    name,
    description,
    systemPrompt,
    icon,
    voiceMapping,
    ttsEnabled,
    autoPlay,
  });

export const deleteScenario = (id: string) =>
  invoke<void>("delete_scenario", { id });

export const duplicateScenario = (id: string) =>
  invoke<Scenario>("duplicate_scenario", { id });

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

export const stopGeneration = () => invoke<void>("stop_generation");

// Settings commands
export const getSetting = (key: string) =>
  invoke<string | null>("get_setting", { key });

export const setSetting = (key: string, value: string) =>
  invoke<void>("set_setting", { key, value });

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

// TTS commands
export const ttsSynthesize = (voiceId: string, text: string) =>
  invoke<TtsResult>("tts_synthesize", { voiceId, text });

export const parseVoiceSegments = (
  text: string,
  scenarioId?: string
) =>
  invoke<VoiceSegmentResult[]>("parse_voice_segments", {
    text,
    scenarioId,
  });

// STT commands
export const sttTranscribe = (audioBase64: string, providerId: string) =>
  invoke<string>("stt_transcribe", { audioBase64, providerId });

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
