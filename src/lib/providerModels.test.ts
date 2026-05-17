import { describe, expect, it } from "vitest";
import {
  getProviderModelProfiles,
  getProviderModelsForPurpose,
  getProvidersForPurpose,
  inferModelPurposes,
  normalizeProviderModelProfiles,
  parseProviderModelRegistry,
  providerPurposeCounts,
  serializeProviderModelRegistry,
} from "./providerModels";
import type { Provider, ProviderModelProfile } from "./types";

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "p-1",
    name: "Test Provider",
    api_type: "openai-compatible",
    base_url: "https://example.com/v1",
    api_key: "sk-x",
    models: ["gpt-4o", "whisper-1", "tts-1", "gpt-image-1"],
    is_default: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("inferModelPurposes", () => {
  it.each([
    ["whisper-1", ["stt"]],
    ["whisper-large-v3", ["stt"]],
    ["tts-1", ["tts"]],
    ["tts-1-hd", ["tts"]],
    ["dall-e-3", ["image"]],
    ["gpt-image-1", ["image"]],
    ["flux-1-pro", ["image"]],
    ["sdxl-turbo", ["image"]],
    ["midjourney-6", ["image"]],
    ["recraft-v3", ["image"]],
    ["imagen-3", ["image"]],
    ["gpt-4o", ["chat"]],
    ["claude-3.5-sonnet", ["chat"]],
    ["gemini-1.5-pro", ["chat"]],
    ["random-llm", ["chat"]],
    ["", ["chat"]],
  ])("infers %s → %j", (model, expected) => {
    expect(inferModelPurposes(model)).toEqual(expected);
  });

  it("prefers stt over tts when a name matches both regexes", () => {
    // "speech-to-text" hits both patterns; STT wins per implementation order.
    expect(inferModelPurposes("speech-to-text-v2")).toEqual(["stt"]);
  });
});

describe("normalizeProviderModelProfiles", () => {
  it("deduplicates by id, preserving first occurrence", () => {
    const input: ProviderModelProfile[] = [
      { id: "a", purposes: ["chat"] },
      { id: "a", purposes: ["image"] },
      { id: "b", purposes: ["tts"] },
    ];
    expect(normalizeProviderModelProfiles(input)).toEqual([
      { id: "a", purposes: ["chat"] },
      { id: "b", purposes: ["tts"] },
    ]);
  });

  it("drops profiles with empty id or empty purposes", () => {
    const input: ProviderModelProfile[] = [
      { id: "  ", purposes: ["chat"] },
      { id: "real", purposes: [] },
      { id: "valid", purposes: ["chat"] },
    ];
    expect(normalizeProviderModelProfiles(input)).toEqual([
      { id: "valid", purposes: ["chat"] },
    ]);
  });

  it("deduplicates purposes within a single profile", () => {
    const input: ProviderModelProfile[] = [
      { id: "a", purposes: ["chat", "chat", "image", "image"] },
    ];
    expect(normalizeProviderModelProfiles(input)).toEqual([
      { id: "a", purposes: ["chat", "image"] },
    ]);
  });
});

describe("parseProviderModelRegistry", () => {
  it("returns empty registry for null/undefined/empty", () => {
    expect(parseProviderModelRegistry(null)).toEqual({});
    expect(parseProviderModelRegistry(undefined)).toEqual({});
    expect(parseProviderModelRegistry("")).toEqual({});
  });

  it("returns empty registry for malformed JSON", () => {
    expect(parseProviderModelRegistry("{not valid json")).toEqual({});
  });

  it("returns empty registry for non-object JSON shapes", () => {
    expect(parseProviderModelRegistry("[]")).toEqual({});
    expect(parseProviderModelRegistry('"hello"')).toEqual({});
    expect(parseProviderModelRegistry("42")).toEqual({});
  });

  it("accepts string entries and infers their purposes", () => {
    const registry = parseProviderModelRegistry(
      JSON.stringify({ p1: ["gpt-4o", "whisper-1"] }),
    );
    expect(registry).toEqual({
      p1: [
        { id: "gpt-4o", purposes: ["chat"] },
        { id: "whisper-1", purposes: ["stt"] },
      ],
    });
  });

  it("accepts object entries and uses their declared purposes", () => {
    const registry = parseProviderModelRegistry(
      JSON.stringify({
        p1: [{ id: "weird-name", purposes: ["image", "chat"] }],
      }),
    );
    expect(registry).toEqual({
      p1: [{ id: "weird-name", purposes: ["image", "chat"] }],
    });
  });

  it("skips invalid entries but keeps valid siblings", () => {
    const registry = parseProviderModelRegistry(
      JSON.stringify({
        p1: ["good-chat", null, { id: "" }, { id: "img", purposes: ["image"] }],
      }),
    );
    expect(registry.p1).toEqual([
      { id: "good-chat", purposes: ["chat"] },
      { id: "img", purposes: ["image"] },
    ]);
  });

  it("skips providers whose entries normalize to nothing", () => {
    const registry = parseProviderModelRegistry(
      JSON.stringify({ broken: [{ id: "" }, { id: "  " }] }),
    );
    expect(registry).toEqual({});
  });

  it("ignores non-array values per provider", () => {
    const registry = parseProviderModelRegistry(
      JSON.stringify({ p1: "not an array", p2: ["gpt-4o"] }),
    );
    expect(Object.keys(registry)).toEqual(["p2"]);
  });
});

describe("serializeProviderModelRegistry", () => {
  it("round-trips through parseProviderModelRegistry", () => {
    const registry = {
      p1: [{ id: "gpt-4o", purposes: ["chat"] as const }],
    };
    const json = serializeProviderModelRegistry(registry);
    expect(parseProviderModelRegistry(json)).toEqual(registry);
  });
});

describe("getProviderModelProfiles", () => {
  it("returns one profile per provider.models entry, inferring purposes when unsaved", () => {
    const profiles = getProviderModelProfiles(provider(), {});
    expect(profiles).toEqual([
      { id: "gpt-4o", purposes: ["chat"] },
      { id: "whisper-1", purposes: ["stt"] },
      { id: "tts-1", purposes: ["tts"] },
      { id: "gpt-image-1", purposes: ["image"] },
    ]);
  });

  it("uses saved purposes from registry when present", () => {
    const profiles = getProviderModelProfiles(provider({ models: ["mystery-1"] }), {
      "p-1": [{ id: "mystery-1", purposes: ["image", "chat"] }],
    });
    expect(profiles).toEqual([{ id: "mystery-1", purposes: ["image", "chat"] }]);
  });

  it("falls back to inferred purposes when saved profile has empty purposes", () => {
    const profiles = getProviderModelProfiles(provider({ models: ["whisper-1"] }), {
      "p-1": [{ id: "whisper-1", purposes: [] }],
    });
    expect(profiles).toEqual([{ id: "whisper-1", purposes: ["stt"] }]);
  });

  it("drops blank model ids and trims whitespace", () => {
    const profiles = getProviderModelProfiles(
      provider({ models: ["  ", "  gpt-4o  ", ""] }),
      {},
    );
    expect(profiles).toEqual([{ id: "gpt-4o", purposes: ["chat"] }]);
  });

  it("ignores registry entries that don't match any provider model (orphan profiles)", () => {
    const profiles = getProviderModelProfiles(provider({ models: ["gpt-4o"] }), {
      "p-1": [
        { id: "gpt-4o", purposes: ["chat"] },
        { id: "ghost", purposes: ["image"] },
      ],
    });
    expect(profiles).toEqual([{ id: "gpt-4o", purposes: ["chat"] }]);
  });
});

describe("getProviderModelsForPurpose", () => {
  it("returns only model ids that include the requested purpose", () => {
    const p = provider();
    expect(getProviderModelsForPurpose(p, {}, "chat")).toEqual(["gpt-4o"]);
    expect(getProviderModelsForPurpose(p, {}, "stt")).toEqual(["whisper-1"]);
    expect(getProviderModelsForPurpose(p, {}, "tts")).toEqual(["tts-1"]);
    expect(getProviderModelsForPurpose(p, {}, "image")).toEqual(["gpt-image-1"]);
  });

  it("returns models that match via saved multi-purpose profile", () => {
    const p = provider({ models: ["multi"] });
    const registry = {
      "p-1": [{ id: "multi", purposes: ["chat" as const, "image" as const] }],
    };
    expect(getProviderModelsForPurpose(p, registry, "chat")).toEqual(["multi"]);
    expect(getProviderModelsForPurpose(p, registry, "image")).toEqual(["multi"]);
    expect(getProviderModelsForPurpose(p, registry, "tts")).toEqual([]);
  });
});

describe("getProvidersForPurpose", () => {
  it("filters out providers with no models for the purpose", () => {
    const a = provider({ id: "a", models: ["gpt-4o"] });
    const b = provider({ id: "b", models: ["whisper-1"] });
    expect(getProvidersForPurpose([a, b], {}, "chat")).toEqual([a]);
    expect(getProvidersForPurpose([a, b], {}, "stt")).toEqual([b]);
    expect(getProvidersForPurpose([a, b], {}, "image")).toEqual([]);
  });
});

describe("providerPurposeCounts", () => {
  it("counts each purpose across all profiles", () => {
    const p = provider({ models: ["gpt-4o", "whisper-1", "tts-1"] });
    expect(providerPurposeCounts(p, {})).toEqual({
      chat: 1,
      stt: 1,
      tts: 1,
      image: 0,
    });
  });

  it("counts multi-purpose models once per purpose", () => {
    const p = provider({ models: ["multi"] });
    const registry = {
      "p-1": [{ id: "multi", purposes: ["chat" as const, "image" as const] }],
    };
    expect(providerPurposeCounts(p, registry)).toEqual({
      chat: 1,
      stt: 0,
      tts: 0,
      image: 1,
    });
  });
});
