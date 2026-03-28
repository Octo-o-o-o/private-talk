import { describe, it, expect } from "vitest";
import {
  PROVIDER_PRESETS,
  getImageGenModelForProvider,
  createProviderModelsString,
  pickModelsForPreset,
} from "@/lib/providerPresets";

describe("providerPresets", () => {
  describe("PROVIDER_PRESETS structure", () => {
    it("should have unique ids", () => {
      const ids = PROVIDER_PRESETS.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("should have required fields on each preset", () => {
      for (const preset of PROVIDER_PRESETS) {
        expect(preset.id).toBeTruthy();
        expect(preset.name).toBeTruthy();
        expect(preset.baseUrl).toBeTruthy();
        expect(preset.description.zh).toBeTruthy();
        expect(preset.description.en).toBeTruthy();
        expect(["cloud", "local"]).toContain(preset.category);
        expect(["openai-compatible", "ollama"]).toContain(preset.discoveryMode);
        expect(Array.isArray(preset.defaultModels)).toBe(true);
        expect(Array.isArray(preset.recommendedModels)).toBe(true);
      }
    });

    it("should have cloud providers require API keys", () => {
      const cloudPresets = PROVIDER_PRESETS.filter((p) => p.category === "cloud");
      for (const preset of cloudPresets) {
        expect(preset.apiKeyRequired).toBe(true);
        expect(preset.apiKeyPlaceholder).toBeTruthy();
      }
    });

    it("should have local providers not require API keys", () => {
      const localPresets = PROVIDER_PRESETS.filter((p) => p.category === "local");
      for (const preset of localPresets) {
        expect(preset.apiKeyRequired).toBe(false);
      }
    });
  });

  describe("getImageGenModelForProvider", () => {
    it("should return model for known provider URL", () => {
      expect(getImageGenModelForProvider("https://api.openai.com/v1")).toBe("gpt-image-1");
    });

    it("should handle trailing slash", () => {
      expect(getImageGenModelForProvider("https://api.openai.com/v1/")).toBe("gpt-image-1");
    });

    it("should return empty string for unknown URL", () => {
      expect(getImageGenModelForProvider("https://unknown.api.com/v1")).toBe("");
    });

    it("should find SiliconFlow image model", () => {
      expect(getImageGenModelForProvider("https://api.siliconflow.cn/v1")).toBe(
        "black-forest-labs/FLUX.1-schnell"
      );
    });
  });

  describe("createProviderModelsString", () => {
    it("should join default models with commas", () => {
      const preset = PROVIDER_PRESETS.find((p) => p.id === "deepseek")!;
      expect(createProviderModelsString(preset)).toBe("deepseek-chat,deepseek-reasoner");
    });

    it("should return empty string for null preset", () => {
      expect(createProviderModelsString(null)).toBe("");
    });

    it("should return empty string for undefined preset", () => {
      expect(createProviderModelsString(undefined)).toBe("");
    });
  });

  describe("pickModelsForPreset", () => {
    it("should prefer recommended models from discovered list", () => {
      const preset = PROVIDER_PRESETS.find((p) => p.id === "deepseek")!;
      const discovered = ["deepseek-chat", "deepseek-reasoner", "deepseek-coder"];

      const result = pickModelsForPreset(preset, discovered);

      // Recommended models should appear first
      expect(result[0]).toBe("deepseek-chat");
      expect(result[1]).toBe("deepseek-reasoner");
    });

    it("should filter non-chat models", () => {
      const preset = PROVIDER_PRESETS.find((p) => p.id === "openai")!;
      const discovered = [
        "gpt-5.4",
        "gpt-5.4-mini",
        "text-embedding-3-large",
        "tts-1",
        "whisper-1",
        "dall-e-3",
      ];

      const result = pickModelsForPreset(preset, discovered);

      expect(result).toContain("gpt-5.4");
      expect(result).toContain("gpt-5.4-mini");
      expect(result).not.toContain("text-embedding-3-large");
      expect(result).not.toContain("tts-1");
      expect(result).not.toContain("whisper-1");
    });

    it("should fallback to defaultModels when no discovered match", () => {
      const preset = PROVIDER_PRESETS.find((p) => p.id === "deepseek")!;
      const discovered = ["unrelated-model"];

      const result = pickModelsForPreset(preset, discovered);

      expect(result).toEqual(preset.defaultModels);
    });

    it("should limit cloud providers to 8 models", () => {
      const preset = PROVIDER_PRESETS.find((p) => p.id === "openai")!;
      const discovered = Array.from({ length: 20 }, (_, i) => `gpt-model-${i}`);

      const result = pickModelsForPreset(preset, discovered);

      expect(result.length).toBeLessThanOrEqual(8);
    });

    it("should limit local providers to 16 models", () => {
      const preset = PROVIDER_PRESETS.find((p) => p.id === "localai")!;
      const discovered = Array.from({ length: 30 }, (_, i) => `model-${i}`);

      const result = pickModelsForPreset(preset, discovered);

      expect(result.length).toBeLessThanOrEqual(16);
    });

    it("should filter OpenRouter models by known org prefixes", () => {
      const preset = PROVIDER_PRESETS.find((p) => p.id === "openrouter")!;
      const discovered = [
        "openai/gpt-5.4",
        "anthropic/claude-opus-4.6",
        "unknown-org/some-model",
        "deepseek/deepseek-chat",
      ];

      const result = pickModelsForPreset(preset, discovered);

      expect(result).toContain("openai/gpt-5.4");
      expect(result).toContain("anthropic/claude-opus-4.6");
      expect(result).toContain("deepseek/deepseek-chat");
      expect(result).not.toContain("unknown-org/some-model");
    });

    it("should filter Grok models but exclude grok-imagine", () => {
      const preset = PROVIDER_PRESETS.find((p) => p.id === "grok")!;
      const discovered = [
        "grok-4.20-0309-reasoning",
        "grok-4-1-fast-reasoning",
        "grok-imagine-image",
      ];

      const result = pickModelsForPreset(preset, discovered);

      expect(result).toContain("grok-4.20-0309-reasoning");
      expect(result).not.toContain("grok-imagine-image");
    });
  });
});
