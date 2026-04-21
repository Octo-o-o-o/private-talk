export type Role = "system" | "user" | "assistant";

export interface Conversation {
  id: string;
  title: string;
  preview: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: Role;
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
