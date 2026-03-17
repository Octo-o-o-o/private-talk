import { invoke } from "@tauri-apps/api/core";
import type { Conversation, Message, Provider } from "./types";

// Conversation commands
export const listConversations = () =>
  invoke<Conversation[]>("list_conversations");

export const createConversation = (title?: string) =>
  invoke<Conversation>("create_conversation", { title });

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

// Chat commands
export const sendMessage = (
  conversationId: string,
  content: string,
  providerId: string,
  model: string
) =>
  invoke<void>("send_message", { conversationId, content, providerId, model });

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
