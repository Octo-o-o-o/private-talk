export interface Conversation {
  id: string;
  title: string;
  assistant_id: string | null;
  /** @deprecated Legacy compatibility alias for older callers. */
  scenario_id?: string | null;
  created_at: string;
  updated_at: string;
  openclaw_instance_id: string | null;
  openclaw_agent_id: string | null;
  openclaw_session_key: string | null;
}

export interface OpenClawInstance {
  id: string;
  name: string;
  gateway_url: string;
  token: string;
  agents_cache: string;
  is_remote: boolean;
  created_at: string;
  updated_at: string;
}

export interface OpenClawAgent {
  id: string;
  name: string;
  model: string;
  is_default: boolean;
  emoji: string | null;
  avatar: string | null;
  description: string | null;
}

export interface LocalOpenClawDetection {
  cli_available: boolean;
  cli_version: string | null;
  config_dir_exists: boolean;
  gateway_url: string | null;
  gateway_token: string | null;
  gateway_running: boolean;
}

export interface Attachment {
  id: string;
  message_id: string;
  file_type: "image" | "text_file" | "audio";
  file_name: string;
  file_path: string;
  mime_type: string;
  file_size: number;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface PreparedAttachment {
  id: string;
  file_type: string;
  file_name: string;
  file_path: string;
  mime_type: string;
  file_size: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "system" | "user" | "assistant";
  content: string;
  is_pinned: boolean;
  created_at: string;
  attachments: Attachment[];
}

export interface Provider {
  id: string;
  name: string;
  api_type: string;
  base_url: string;
  api_key: string;
  models: string[];
  is_default: boolean;
  created_at: string;
}

export interface ProviderModelDiscovery {
  models: string[];
  discovered: boolean;
  endpoint: string;
}

export interface LocalProviderScanResult {
  framework: string;
  name: string;
  base_url: string;
  api_key: string;
  models: string[];
  detection: string;
}

export interface DetectedLocalService {
  key: string;
  name: string;
  type: "provider" | "openclaw";
  framework: string;
  detail: string;
  providerScan?: LocalProviderScanResult;
  openclawDetection?: LocalOpenClawDetection;
}

export interface Assistant {
  id: string;
  name: string;
  name_en: string;
  description: string;
  description_en: string;
  system_prompt: string;
  icon: string;
  is_preset: boolean;
  voice_mapping: Record<string, string | null>;
  tts_enabled: boolean;
  auto_play: boolean;
  created_at: string;
  updated_at: string;
}

export type Scenario = Assistant;

export interface Voice {
  id: string;
  display_name: string;
  display_name_en: string;
  engine: "qwen3-tts" | "openai-tts" | "custom";
  engine_config: VoiceEngineConfig;
  role_type: "background" | "character";
  tags: string[];
  tags_en: string[];
  is_preset: boolean;
  created_at: string;
  updated_at: string;
}

export interface VoiceEngineConfig {
  endpoint: string;
  model: string;
  voice: string;
  speed: number;
  response_format: string;
  api_key?: string;
  /** Voice Clone: base64-encoded reference audio */
  ref_audio?: string;
  /** Voice Clone: transcript of the reference audio */
  ref_text?: string;
}

export interface TtsResult {
  audio_base64: string;
  content_type: string;
}

export interface MicrophonePermissionInfo {
  status: "unknown" | "prompt" | "granted" | "denied";
  source: "native" | "unsupported";
}

export interface NativeSttInfo {
  supported: boolean;
  status: "ready" | "prompt" | "denied" | "unavailable";
  source: "native" | "unsupported";
  platform: "macos" | "windows" | "ios" | "android" | "other";
  mode: "file" | "live" | "unsupported";
  detail?: string | null;
}

export interface VoiceSegmentResult {
  role_name: string;
  text: string;
  voice_id: string | null;
}

export interface ExportResult {
  success: boolean;
  path: string | null;
  providers: number;
  voices: number;
  assistants: number;
  openclaw_instances: number;
}

export interface ImportResult {
  success: boolean;
  providers: number;
  voices: number;
  assistants: number;
  openclaw_instances: number;
  settings: number;
}

export interface StreamChunkPayload {
  conversation_id: string;
  content: string;
}

export interface StreamDonePayload {
  conversation_id: string;
  message_id: string;
  full_content: string;
}

export interface StreamErrorPayload {
  conversation_id: string;
  error: string;
}

export interface ModelUsage {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  request_count: number;
}

export interface ConversationUsage {
  conversation_id: string;
  conversation_title: string;
  is_deleted: boolean;
  first_message_preview: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  model_usages: ModelUsage[];
}

export interface DailyUsage {
  date: string;
  conversation_count: number;
  model_usages: ModelUsage[];
}
