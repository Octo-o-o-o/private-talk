import { invoke } from "@tauri-apps/api/core";
import type {
  Conversation,
  Message,
  PreviewBootstrap,
  Provider,
} from "./types";

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
  providerId: string,
  model: string,
): Promise<void> {
  return cmd("send_message", { conversationId, content, providerId, model });
}

export function stopGeneration(): Promise<void> {
  return cmd("stop_generation");
}

// Settings commands
export function getSetting(key: string): Promise<string | null> {
  return cmd("get_setting", { key });
}

export function setSetting(key: string, value: string): Promise<void> {
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
