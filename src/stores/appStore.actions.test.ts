import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauri", () => ({
  listProviders: vi.fn(),
  listAssistants: vi.fn(),
  listConversations: vi.fn(),
  getMessages: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  isPinEnabled: vi.fn(),
  getImageGenConfig: vi.fn(),
  setImageGenConfig: vi.fn(),
  createConversation: vi.fn(),
  updateConversationAssistant: vi.fn(),
  deleteConversation: vi.fn(),
  renameConversation: vi.fn(),
}));

import * as api from "../lib/tauri";
import { useAppStore } from "./appStore";
import type { ImageGenConfig, Provider } from "../lib/types";

const mockedApi = vi.mocked(api, true);

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "p-1",
    name: "Test",
    api_type: "openai-compatible",
    base_url: "https://example.com/v1",
    api_key: "sk-x",
    models: ["gpt-4o"],
    is_default: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function defaultImageConfig(overrides: Partial<ImageGenConfig> = {}): ImageGenConfig {
  return {
    enabled: true,
    provider_id: "p-img",
    model: "gpt-image-1",
    default_aspect_ratio: "1:1",
    default_quality: "standard",
    default_background: "auto",
    max_images_per_request: 4,
    ...overrides,
  };
}

function settingMap(map: Record<string, string | null>) {
  mockedApi.getSetting.mockImplementation(async (key: string) =>
    key in map ? map[key] : null,
  );
}

beforeEach(() => {
  // vitest.config.ts already sets clearMocks: true, but we re-prime safe
  // defaults so individual tests only override what they care about.
  mockedApi.setSetting.mockResolvedValue();
  mockedApi.setImageGenConfig.mockResolvedValue();
  settingMap({});
});

// ============================================================
//  loadProviders
// ============================================================

describe("loadProviders", () => {
  it("picks default provider when nothing is stored", async () => {
    mockedApi.listProviders.mockResolvedValue([
      provider({ id: "a", is_default: false, models: ["gpt-4o"] }),
      provider({ id: "b", is_default: true, models: ["gpt-4o"] }),
    ]);

    await useAppStore.getState().loadProviders();

    const s = useAppStore.getState();
    expect(s.selectedProviderId).toBe("b");
    expect(s.selectedModel).toBe("gpt-4o");
  });

  it("falls back to the default provider when the stored one no longer exists", async () => {
    mockedApi.listProviders.mockResolvedValue([
      provider({ id: "a", is_default: false, models: ["gpt-4o"] }),
      provider({ id: "b", is_default: true, models: ["gpt-4o"] }),
    ]);
    settingMap({ chat_provider_id: "ghost", chat_model: "gpt-4o" });

    await useAppStore.getState().loadProviders();

    expect(useAppStore.getState().selectedProviderId).toBe("b");
  });

  it("falls back to the first provider when none is marked default", async () => {
    mockedApi.listProviders.mockResolvedValue([
      provider({ id: "x", is_default: false, models: ["gpt-4o"] }),
      provider({ id: "y", is_default: false, models: ["gpt-4o"] }),
    ]);

    await useAppStore.getState().loadProviders();

    expect(useAppStore.getState().selectedProviderId).toBe("x");
  });

  it("keeps the stored model when it is still available on the active provider", async () => {
    mockedApi.listProviders.mockResolvedValue([
      provider({ id: "a", is_default: true, models: ["gpt-4o", "gpt-5"] }),
    ]);
    settingMap({ chat_provider_id: "a", chat_model: "gpt-5" });

    await useAppStore.getState().loadProviders();

    expect(useAppStore.getState().selectedModel).toBe("gpt-5");
  });

  it("falls back to the first available model when the stored model disappeared", async () => {
    mockedApi.listProviders.mockResolvedValue([
      provider({ id: "a", is_default: true, models: ["gpt-4o"] }),
    ]);
    settingMap({ chat_provider_id: "a", chat_model: "gpt-deprecated" });

    await useAppStore.getState().loadProviders();

    expect(useAppStore.getState().selectedModel).toBe("gpt-4o");
  });

  it("yields null provider + model when no providers expose chat models", async () => {
    // Provider has only a whisper model; chat purpose has no candidates.
    mockedApi.listProviders.mockResolvedValue([
      provider({ id: "a", is_default: true, models: ["whisper-1"] }),
    ]);

    await useAppStore.getState().loadProviders();

    const s = useAppStore.getState();
    expect(s.selectedProviderId).toBeNull();
    expect(s.selectedModel).toBeNull();
  });

  it("only writes back settings that actually changed", async () => {
    mockedApi.listProviders.mockResolvedValue([
      provider({ id: "a", is_default: true, models: ["gpt-4o"] }),
    ]);
    // Stored values already match what loadProviders will pick → no setSetting.
    settingMap({ chat_provider_id: "a", chat_model: "gpt-4o" });

    await useAppStore.getState().loadProviders();
    // Give the fire-and-forget `void api.setSetting(...)` a tick to surface.
    await Promise.resolve();

    expect(mockedApi.setSetting).not.toHaveBeenCalled();
  });

  it("writes the corrected setting back when stored selection drifted", async () => {
    mockedApi.listProviders.mockResolvedValue([
      provider({ id: "a", is_default: true, models: ["gpt-4o"] }),
    ]);
    settingMap({ chat_provider_id: "ghost", chat_model: "ghost-model" });

    await useAppStore.getState().loadProviders();
    await Promise.resolve();
    await Promise.resolve();

    const calls = mockedApi.setSetting.mock.calls;
    expect(calls).toContainEqual(["chat_provider_id", "a"]);
    expect(calls).toContainEqual(["chat_model", "gpt-4o"]);
  });

  it("uses provider_model_registry to override inferred purposes", async () => {
    // Without the registry, "mystery-model" would be inferred as chat anyway,
    // so we make it look like a TTS-shaped name and then override via registry.
    mockedApi.listProviders.mockResolvedValue([
      provider({ id: "a", is_default: true, models: ["tts-1"] }),
    ]);
    settingMap({
      provider_model_registry: JSON.stringify({
        a: [{ id: "tts-1", purposes: ["chat"] }],
      }),
    });

    await useAppStore.getState().loadProviders();

    const s = useAppStore.getState();
    expect(s.selectedProviderId).toBe("a");
    expect(s.selectedModel).toBe("tts-1");
  });
});

// ============================================================
//  loadImageGenConfig
// ============================================================

describe("loadImageGenConfig", () => {
  it("auto-disables and clears provider/model when the saved provider is gone", async () => {
    useAppStore.setState({
      providers: [],
      providerModelRegistry: {},
    });
    mockedApi.getImageGenConfig.mockResolvedValue(
      defaultImageConfig({ enabled: true, provider_id: "ghost", model: "x" }),
    );

    await useAppStore.getState().loadImageGenConfig();

    const cfg = useAppStore.getState().imageGenConfig;
    expect(cfg.enabled).toBe(false);
    expect(cfg.provider_id).toBe("");
    expect(cfg.model).toBe("");
  });

  it("keeps the saved model when it is still in the provider's image models", async () => {
    useAppStore.setState({
      providers: [provider({ id: "p-img", models: ["gpt-image-1", "dall-e-3"] })],
      providerModelRegistry: {},
    });
    mockedApi.getImageGenConfig.mockResolvedValue(
      defaultImageConfig({ provider_id: "p-img", model: "dall-e-3" }),
    );

    await useAppStore.getState().loadImageGenConfig();

    const cfg = useAppStore.getState().imageGenConfig;
    expect(cfg.provider_id).toBe("p-img");
    expect(cfg.model).toBe("dall-e-3");
  });

  it("falls back to the first available image model when the saved one disappeared", async () => {
    useAppStore.setState({
      providers: [provider({ id: "p-img", models: ["gpt-image-1"] })],
      providerModelRegistry: {},
    });
    mockedApi.getImageGenConfig.mockResolvedValue(
      defaultImageConfig({ provider_id: "p-img", model: "dall-e-3" }),
    );

    await useAppStore.getState().loadImageGenConfig();

    expect(useAppStore.getState().imageGenConfig.model).toBe("gpt-image-1");
  });

  it("leaves the config unchanged when the provider has no image models", async () => {
    useAppStore.setState({
      providers: [provider({ id: "p-img", models: ["gpt-4o"] })],
      providerModelRegistry: {},
    });
    const original = defaultImageConfig({ provider_id: "p-img", model: "x" });
    mockedApi.getImageGenConfig.mockResolvedValue({ ...original });

    await useAppStore.getState().loadImageGenConfig();

    const cfg = useAppStore.getState().imageGenConfig;
    expect(cfg.provider_id).toBe("p-img");
    expect(cfg.model).toBe("x"); // untouched, even though provider has no image model
  });

  it("persists the corrected config back to disk only when it changed", async () => {
    useAppStore.setState({
      providers: [provider({ id: "p-img", models: ["gpt-image-1"] })],
      providerModelRegistry: {},
    });
    // Identity case: already matches what loadImageGenConfig would pick.
    mockedApi.getImageGenConfig.mockResolvedValue(
      defaultImageConfig({ provider_id: "p-img", model: "gpt-image-1" }),
    );

    await useAppStore.getState().loadImageGenConfig();
    await Promise.resolve();

    expect(mockedApi.setImageGenConfig).not.toHaveBeenCalled();
  });

  it("persists the corrected config back to disk when it had to be rewritten", async () => {
    useAppStore.setState({
      providers: [],
      providerModelRegistry: {},
    });
    mockedApi.getImageGenConfig.mockResolvedValue(
      defaultImageConfig({ enabled: true, provider_id: "ghost", model: "x" }),
    );

    await useAppStore.getState().loadImageGenConfig();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockedApi.setImageGenConfig).toHaveBeenCalledTimes(1);
    const written = mockedApi.setImageGenConfig.mock.calls[0][0];
    expect(written.enabled).toBe(false);
    expect(written.provider_id).toBe("");
  });
});

// ============================================================
//  loadSpeechSettings
// ============================================================

describe("loadSpeechSettings", () => {
  it("falls back to defaults when no providers and no settings are stored", async () => {
    useAppStore.setState({
      providers: [],
      providerModelRegistry: {},
    });

    await useAppStore.getState().loadSpeechSettings();

    const s = useAppStore.getState();
    expect(s.sttProviderId).toBeNull();
    expect(s.sttModel).toBe("whisper-1");
    expect(s.ttsProviderId).toBeNull();
    expect(s.ttsModel).toBe("tts-1");
    expect(s.ttsVoice).toBe("alloy");
  });

  it("keeps the stored STT/TTS model when it is still in the provider's offerings", async () => {
    useAppStore.setState({
      providers: [
        provider({ id: "p1", models: ["whisper-1", "whisper-large", "tts-1", "tts-1-hd"] }),
      ],
      providerModelRegistry: {},
    });
    settingMap({
      stt_provider_id: "p1",
      stt_model: "whisper-large",
      tts_provider_id: "p1",
      tts_model: "tts-1-hd",
      tts_voice: "nova",
    });

    await useAppStore.getState().loadSpeechSettings();

    const s = useAppStore.getState();
    expect(s.sttProviderId).toBe("p1");
    expect(s.sttModel).toBe("whisper-large");
    expect(s.ttsProviderId).toBe("p1");
    expect(s.ttsModel).toBe("tts-1-hd");
    expect(s.ttsVoice).toBe("nova");
  });

  it("falls back to the first available STT model when the stored one disappeared", async () => {
    useAppStore.setState({
      providers: [provider({ id: "p1", models: ["whisper-1"] })],
      providerModelRegistry: {},
    });
    settingMap({
      stt_provider_id: "p1",
      stt_model: "whisper-deprecated",
    });

    await useAppStore.getState().loadSpeechSettings();

    expect(useAppStore.getState().sttModel).toBe("whisper-1");
  });

  it("returns null providerId when stored provider is unknown", async () => {
    useAppStore.setState({
      providers: [provider({ id: "p1", models: ["whisper-1"] })],
      providerModelRegistry: {},
    });
    settingMap({ stt_provider_id: "ghost", tts_provider_id: "ghost" });

    await useAppStore.getState().loadSpeechSettings();

    const s = useAppStore.getState();
    expect(s.sttProviderId).toBeNull();
    expect(s.ttsProviderId).toBeNull();
  });

  it("treats whitespace-only stored voice as missing and uses 'alloy' default", async () => {
    useAppStore.setState({ providers: [], providerModelRegistry: {} });
    settingMap({ tts_voice: "   " });

    await useAppStore.getState().loadSpeechSettings();

    expect(useAppStore.getState().ttsVoice).toBe("alloy");
  });

  it("persists corrected STT model when stored model is no longer available", async () => {
    // Provider stays the same; only the model drifted out of availability.
    // (Note: when stt_provider_id itself is unknown, the existing code falls
    // back to the stored model verbatim — it does NOT re-correct against the
    // available list. That's a current-behavior quirk; this test instead
    // exercises the "provider valid, model invalid" path which IS expected to
    // correct itself.)
    useAppStore.setState({
      providers: [provider({ id: "p1", models: ["whisper-1"] })],
      providerModelRegistry: {},
    });
    settingMap({
      stt_provider_id: "p1",
      stt_model: "whisper-broken", // ← will be corrected to whisper-1
    });

    await useAppStore.getState().loadSpeechSettings();
    await Promise.resolve();
    await Promise.resolve();

    const calls = mockedApi.setSetting.mock.calls;
    expect(calls).toContainEqual(["stt_model", "whisper-1"]);
    // stt_provider_id didn't drift, so no write for that key.
    expect(calls.find((c) => c[0] === "stt_provider_id")).toBeUndefined();
  });
});
