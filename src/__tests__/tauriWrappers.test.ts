import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/tauri";

const mockedInvoke = vi.mocked(invoke);

describe("tauri wrapper coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes legacy conversations from listFreeConversations", async () => {
    mockedInvoke.mockResolvedValue([
      {
        id: "conversation-1",
        title: "Legacy",
        assistant_id: null,
        scenario_id: "assistant-legacy",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        openclaw_instance_id: null,
        openclaw_agent_id: null,
        openclaw_session_key: null,
      },
    ]);

    const result = await api.listFreeConversations();

    expect(result[0].assistant_id).toBe("assistant-legacy");
    expect(result[0].scenario_id).toBe("assistant-legacy");
  });

  it("normalizes updated conversations from updateConversationScenario", async () => {
    mockedInvoke.mockResolvedValue({
      id: "conversation-1",
      title: "Updated",
      assistant_id: "assistant-1",
      scenario_id: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-02T00:00:00Z",
      openclaw_instance_id: null,
      openclaw_agent_id: null,
      openclaw_session_key: null,
    });

    const result = await api.updateConversationScenario("conversation-1", "assistant-1");

    expect(mockedInvoke).toHaveBeenCalledWith("update_conversation_assistant", {
      id: "conversation-1",
      assistantId: "assistant-1",
    });
    expect(result.assistant_id).toBe("assistant-1");
    expect(result.scenario_id).toBe("assistant-1");
  });

  it.each([
    [
      "createProvider",
      () => api.createProvider("OpenAI", "https://api.example.com/v1", "sk-test", ["gpt-4.1"]),
      "create_provider",
      {
        name: "OpenAI",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test",
        models: ["gpt-4.1"],
      },
    ],
    [
      "updateProvider",
      () =>
        api.updateProvider(
          "provider-1",
          "OpenAI",
          "https://api.example.com/v1",
          "sk-test",
          ["gpt-4.1"]
        ),
      "update_provider",
      {
        id: "provider-1",
        name: "OpenAI",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test",
        models: ["gpt-4.1"],
      },
    ],
    [
      "setDefaultProvider",
      () => api.setDefaultProvider("provider-1"),
      "set_default_provider",
      { id: "provider-1" },
    ],
    [
      "discoverProviderModels",
      () => api.discoverProviderModels("https://api.example.com/v1", "sk-test", "openai-compatible"),
      "discover_provider_models",
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test",
        discoveryMode: "openai-compatible",
      },
    ],
    ["scanLocalProviders", () => api.scanLocalProviders(), "scan_local_providers", undefined],
    ["listAssistants", () => api.listAssistants(), "list_assistants", undefined],
    ["getAssistant", () => api.getAssistant("assistant-1"), "get_assistant", { id: "assistant-1" }],
    [
      "createAssistant",
      () =>
        api.createAssistant(
          "Writer",
          "Writes well",
          "You are helpful",
          "pen",
          { assistant: "voice-1" },
          true,
          true
        ),
      "create_assistant",
      {
        name: "Writer",
        description: "Writes well",
        systemPrompt: "You are helpful",
        icon: "pen",
        voiceMapping: { assistant: "voice-1" },
        ttsEnabled: true,
        autoPlay: true,
      },
    ],
    [
      "updateAssistant",
      () =>
        api.updateAssistant(
          "assistant-1",
          "Writer",
          "Writes well",
          "You are helpful",
          "pen",
          { assistant: "voice-1" },
          true,
          false
        ),
      "update_assistant",
      {
        id: "assistant-1",
        name: "Writer",
        description: "Writes well",
        systemPrompt: "You are helpful",
        icon: "pen",
        voiceMapping: { assistant: "voice-1" },
        ttsEnabled: true,
        autoPlay: false,
      },
    ],
    ["deleteAssistant", () => api.deleteAssistant("assistant-1"), "delete_assistant", { id: "assistant-1" }],
    ["duplicateAssistant", () => api.duplicateAssistant("assistant-1"), "duplicate_assistant", { id: "assistant-1" }],
    ["listScenarios", () => api.listScenarios(), "list_assistants", undefined],
    ["getScenario", () => api.getScenario("assistant-1"), "get_assistant", { id: "assistant-1" }],
    [
      "sendMessage",
      () => api.sendMessage("conversation-1", "hello", "provider-1", "gpt-4.1", "message-1", ["attachment-1"]),
      "send_message",
      {
        conversationId: "conversation-1",
        content: "hello",
        providerId: "provider-1",
        model: "gpt-4.1",
        userMsgId: "message-1",
        attachmentIds: ["attachment-1"],
      },
    ],
    [
      "prepareAttachments",
      () => api.prepareAttachments(["/tmp/a.txt"]),
      "prepare_attachments",
      { filePaths: ["/tmp/a.txt"] },
    ],
    [
      "prepareImageAttachment",
      () => api.prepareImageAttachment("base64-image", "image/png"),
      "prepare_image_attachment",
      { imageBase64: "base64-image", mimeType: "image/png" },
    ],
    [
      "prepareAudioAttachment",
      () => api.prepareAudioAttachment("base64-audio", "audio/webm"),
      "prepare_audio_attachment",
      { audioBase64: "base64-audio", mimeType: "audio/webm" },
    ],
    [
      "prepareTextAttachment",
      () => api.prepareTextAttachment("notes.txt", "hello", "text/plain"),
      "prepare_text_attachment",
      { fileName: "notes.txt", content: "hello", mimeType: "text/plain" },
    ],
    ["stopGeneration", () => api.stopGeneration(), "stop_generation", undefined],
    ["getSetting", () => api.getSetting("ui_language"), "get_setting", { key: "ui_language" }],
    [
      "setSetting",
      () => api.setSetting("ui_language", "en-US"),
      "set_setting",
      { key: "ui_language", value: "en-US" },
    ],
    [
      "getMicrophonePermissionStatus",
      () => api.getMicrophonePermissionStatus(),
      "get_microphone_permission_status",
      undefined,
    ],
    [
      "requestNativeMicrophonePermission",
      () => api.requestNativeMicrophonePermission(),
      "request_microphone_permission",
      undefined,
    ],
    ["openMicrophoneSettings", () => api.openMicrophoneSettings(), "open_microphone_settings", undefined],
    ["getNativeSttInfo", () => api.getNativeSttInfo(), "get_native_stt_info", undefined],
    ["beginNativeSttCapture", () => api.beginNativeSttCapture(), "begin_native_stt_capture", undefined],
    [
      "finishNativeSttCapture",
      () => api.finishNativeSttCapture("base64-audio", "audio/webm"),
      "finish_native_stt_capture",
      { audioBase64: "base64-audio", mimeType: "audio/webm" },
    ],
    ["cancelNativeSttCapture", () => api.cancelNativeSttCapture(), "cancel_native_stt_capture", undefined],
    ["openNativeSttSettings", () => api.openNativeSttSettings(), "open_native_stt_settings", undefined],
    ["enablePin", () => api.enablePin("1234"), "enable_pin", { newPin: "1234" }],
    ["disablePin", () => api.disablePin("1234"), "disable_pin", { currentPin: "1234" }],
    ["resetAllData", () => api.resetAllData(), "reset_all_data", undefined],
    ["listVoices", () => api.listVoices(), "list_voices", undefined],
    ["getVoice", () => api.getVoice("voice-1"), "get_voice", { id: "voice-1" }],
    [
      "createVoice",
      () =>
        api.createVoice(
          "Narrator",
          "openai-tts",
          {
            endpoint: "https://api.example.com/v1/audio/speech",
            model: "tts-1",
            voice: "alloy",
            speed: 1,
            response_format: "mp3",
          },
          "background",
          ["neutral"]
        ),
      "create_voice",
      {
        displayName: "Narrator",
        engine: "openai-tts",
        engineConfig: {
          endpoint: "https://api.example.com/v1/audio/speech",
          model: "tts-1",
          voice: "alloy",
          speed: 1,
          response_format: "mp3",
        },
        roleType: "background",
        tags: ["neutral"],
      },
    ],
    [
      "updateVoice",
      () =>
        api.updateVoice(
          "voice-1",
          "Narrator",
          "openai-tts",
          {
            endpoint: "https://api.example.com/v1/audio/speech",
            model: "tts-1",
            voice: "alloy",
            speed: 1,
            response_format: "mp3",
          },
          "background",
          ["neutral"]
        ),
      "update_voice",
      {
        id: "voice-1",
        displayName: "Narrator",
        engine: "openai-tts",
        engineConfig: {
          endpoint: "https://api.example.com/v1/audio/speech",
          model: "tts-1",
          voice: "alloy",
          speed: 1,
          response_format: "mp3",
        },
        roleType: "background",
        tags: ["neutral"],
      },
    ],
    ["deleteVoice", () => api.deleteVoice("voice-1"), "delete_voice", { id: "voice-1" }],
    [
      "saveRefAudio",
      () => api.saveRefAudio("base64-audio", "voice.wav"),
      "save_ref_audio",
      { audioBase64: "base64-audio", fileName: "voice.wav" },
    ],
    [
      "ttsSynthesize",
      () => api.ttsSynthesize("voice-1", "hello"),
      "tts_synthesize",
      { voiceId: "voice-1", text: "hello" },
    ],
    [
      "parseVoiceSegments",
      () => api.parseVoiceSegments("hello", "assistant-1"),
      "parse_voice_segments",
      { text: "hello", assistantId: "assistant-1" },
    ],
    [
      "sttTranscribe",
      () => api.sttTranscribe("base64-audio", "provider-1", "audio/webm"),
      "stt_transcribe",
      { audioBase64: "base64-audio", providerId: "provider-1", mimeType: "audio/webm" },
    ],
    ["togglePinMessage", () => api.togglePinMessage("message-1"), "toggle_pin_message", { messageId: "message-1" }],
    [
      "deleteMessagesFrom",
      () => api.deleteMessagesFrom("conversation-1", "message-1"),
      "delete_messages_from",
      { conversationId: "conversation-1", messageId: "message-1" },
    ],
    [
      "updateMessageContent",
      () => api.updateMessageContent("message-1", "updated"),
      "update_message_content",
      { messageId: "message-1", content: "updated" },
    ],
    [
      "generateTitle",
      () => api.generateTitle("conversation-1", "provider-1", "gpt-4.1"),
      "generate_title",
      { conversationId: "conversation-1", providerId: "provider-1", model: "gpt-4.1" },
    ],
    ["getUsageByConversation", () => api.getUsageByConversation(), "get_usage_by_conversation", undefined],
    ["getUsageByDate", () => api.getUsageByDate(), "get_usage_by_date", undefined],
    ["listOpenClawInstances", () => api.listOpenClawInstances(), "list_openclaw_instances", undefined],
    [
      "createOpenClawInstance",
      () =>
        api.createOpenClawInstance(
          "Gateway",
          "ws://127.0.0.1:18789",
          "token",
          true,
          false,
          "[]"
        ),
      "create_openclaw_instance",
      {
        name: "Gateway",
        gatewayUrl: "ws://127.0.0.1:18789",
        token: "token",
        skipCliCheck: true,
        isRemote: false,
        agentsCache: "[]",
      },
    ],
    [
      "updateOpenClawInstance",
      () =>
        api.updateOpenClawInstance("instance-1", "Gateway", "ws://127.0.0.1:18789", "token"),
      "update_openclaw_instance",
      {
        id: "instance-1",
        name: "Gateway",
        gatewayUrl: "ws://127.0.0.1:18789",
        token: "token",
      },
    ],
    ["deleteOpenClawInstance", () => api.deleteOpenClawInstance("instance-1"), "delete_openclaw_instance", { id: "instance-1" }],
    ["detectLocalOpenClaw", () => api.detectLocalOpenClaw(), "detect_local_openclaw", undefined],
    [
      "listOpenClawAgents",
      () => api.listOpenClawAgents("ws://127.0.0.1:18789", "token", "instance-1"),
      "list_openclaw_agents",
      {
        gatewayUrl: "ws://127.0.0.1:18789",
        token: "token",
        instanceId: "instance-1",
      },
    ],
    [
      "sendOpenClawMessage",
      () => api.sendOpenClawMessage("conversation-1", "hello", "message-1", ["attachment-1"]),
      "send_openclaw_message",
      {
        conversationId: "conversation-1",
        content: "hello",
        userMsgId: "message-1",
        attachmentIds: ["attachment-1"],
      },
    ],
    [
      "stopOpenClawGeneration",
      () => api.stopOpenClawGeneration("conversation-1"),
      "stop_openclaw_generation",
      { conversationId: "conversation-1" },
    ],
    [
      "exportConfig",
      () => api.exportConfig("password", "/tmp/backup.ptb"),
      "export_config",
      { password: "password", filePath: "/tmp/backup.ptb" },
    ],
    ["cacheBackupData", () => api.cacheBackupData([1, 2, 3]), "cache_backup_data", { data: [1, 2, 3] }],
    [
      "validateBackup",
      () => api.validateBackup("password", "/tmp/backup.ptb"),
      "validate_backup",
      { password: "password", filePath: "/tmp/backup.ptb" },
    ],
    [
      "importConfig",
      () => api.importConfig("password", "/tmp/backup.ptb", "merge"),
      "import_config",
      { password: "password", filePath: "/tmp/backup.ptb", mode: "merge" },
    ],
    ["parseConnectionString", () => api.parseConnectionString("pt://token"), "parse_connection_string", { input: "pt://token" }],
  ])("%s invokes the correct backend command", async (_name, run, command, args) => {
    mockedInvoke.mockResolvedValue(undefined);

    await run();

    if (args === undefined) {
      expect(mockedInvoke).toHaveBeenCalledWith(command);
    } else {
      expect(mockedInvoke).toHaveBeenCalledWith(command, args);
    }
  });

  it("stores image generation config as JSON", async () => {
    mockedInvoke.mockResolvedValue(undefined);

    await api.setImageGenConfig({
      enabled: true,
      provider_id: "provider-1",
      model: "gpt-image-1",
      api_mode: "chat",
      allow_auto_tool_call: false,
      max_images_per_request: 4,
      default_aspect_ratio: "1:1",
      default_quality: "high",
    });

    expect(mockedInvoke).toHaveBeenCalledWith("set_setting", {
      key: "image_gen_config",
      value:
        '{"enabled":true,"provider_id":"provider-1","model":"gpt-image-1","api_mode":"chat","allow_auto_tool_call":false,"max_images_per_request":4,"default_aspect_ratio":"1:1","default_quality":"high"}',
    });
  });
});
