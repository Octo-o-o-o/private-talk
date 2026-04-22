export type Role = "system" | "user" | "assistant";

export interface Conversation {
  id: string;
  title: string;
  preview: string;
  assistant_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Assistant {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  icon: string;
  is_preset: boolean;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  attachments: Attachment[];
  created_at: string;
}

export interface Attachment {
  id: string;
  message_id: string;
  file_type: string;
  file_name: string;
  file_path: string;
  mime_type: string;
  file_size: number;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export interface AttachmentUpload {
  file_name: string;
  mime_type: string;
  data_base64: string;
}

export interface GeneratedAssistantMessage {
  id: string;
  conversation_id: string;
  content: string;
  created_at: string;
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

export interface ImageGenConfig {
  enabled: boolean;
  provider_id: string;
  model: string;
  default_aspect_ratio: string;
  default_quality: string;
  default_background: string;
  max_images_per_request: number;
}

export interface TtsResult {
  audio_base64: string;
  content_type: string;
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

export interface PreviewBootstrap {
  screen?: string | null;
  dataset?: string | null;
}

export interface ExportConfigResult {
  file_name: string;
  data: number[];
  providers: number;
  assistants: number;
  settings: number;
}

export interface ImportConfigResult {
  providers: number;
  assistants: number;
  settings: number;
}

export interface ValidateBackupResult {
  providers: number;
  assistants: number;
  settings: number;
  has_local_config: boolean;
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
  latest_at: string;
  message_count: number;
  total_requests: number;
  model_usages: ModelUsage[];
}

export interface DailyUsage {
  date: string;
  conversation_count: number;
  model_usages: ModelUsage[];
}
