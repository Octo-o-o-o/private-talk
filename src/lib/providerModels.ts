import type {
  ModelPurpose,
  Provider,
  ProviderModelProfile,
  ProviderModelRegistry,
} from "./types";

const IMAGE_MODEL_PATTERN =
  /(gpt-image|dall-e|image|flux|sdxl|stable[- ]?diffusion|midjourney|recraft|imagen)/i;
const STT_MODEL_PATTERN = /(whisper|transcri|speech[- ]?to[- ]?text|asr|stt)/i;
const TTS_MODEL_PATTERN = /(tts|text[- ]?to[- ]?speech|voice|speech)/i;

export const MODEL_PURPOSES: ModelPurpose[] = ["chat", "stt", "tts", "image"];

function normalizePurpose(value: unknown): ModelPurpose | null {
  if (value === "chat" || value === "stt" || value === "tts" || value === "image") {
    return value;
  }
  return null;
}

export function normalizeProviderModelProfiles(
  profiles: ProviderModelProfile[],
): ProviderModelProfile[] {
  const nextProfiles: ProviderModelProfile[] = [];
  const seenIds = new Set<string>();

  for (const profile of profiles) {
    const id = profile.id.trim();
    if (!id || seenIds.has(id)) {
      continue;
    }

    const purposes = Array.from(
      new Set(profile.purposes.map(normalizePurpose).filter(Boolean) as ModelPurpose[]),
    );

    if (purposes.length === 0) {
      continue;
    }

    nextProfiles.push({ id, purposes });
    seenIds.add(id);
  }

  return nextProfiles;
}

export function inferModelPurposes(modelId: string): ModelPurpose[] {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) {
    return ["chat"];
  }

  const purposes = new Set<ModelPurpose>();

  if (IMAGE_MODEL_PATTERN.test(normalized)) {
    purposes.add("image");
  }
  if (STT_MODEL_PATTERN.test(normalized)) {
    purposes.add("stt");
  }
  if (TTS_MODEL_PATTERN.test(normalized) && !purposes.has("stt")) {
    purposes.add("tts");
  }

  if (purposes.size === 0) {
    purposes.add("chat");
  }

  return Array.from(purposes);
}

export function parseProviderModelRegistry(
  raw: string | null | undefined,
): ProviderModelRegistry {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const registry: ProviderModelRegistry = {};

    for (const [providerId, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) {
        continue;
      }

      const profiles = normalizeProviderModelProfiles(
        value
          .map((entry) => {
            if (typeof entry === "string") {
              return {
                id: entry,
                purposes: inferModelPurposes(entry),
              } satisfies ProviderModelProfile;
            }

            if (!entry || typeof entry !== "object") {
              return null;
            }

            const record = entry as Record<string, unknown>;
            return {
              id: typeof record.id === "string" ? record.id : "",
              purposes: Array.isArray(record.purposes)
                ? record.purposes
                    .map((purpose) => normalizePurpose(purpose))
                    .filter(Boolean) as ModelPurpose[]
                : inferModelPurposes(typeof record.id === "string" ? record.id : ""),
            } satisfies ProviderModelProfile;
          })
          .filter(Boolean) as ProviderModelProfile[],
      );

      if (profiles.length > 0) {
        registry[providerId] = profiles;
      }
    }

    return registry;
  } catch (error) {
    console.warn("Failed to parse provider model registry:", error);
    return {};
  }
}

export function serializeProviderModelRegistry(
  registry: ProviderModelRegistry,
): string {
  return JSON.stringify(registry);
}

export function getProviderModelProfiles(
  provider: Provider,
  registry: ProviderModelRegistry,
): ProviderModelProfile[] {
  const savedProfiles = registry[provider.id] ?? [];
  const savedMap = new Map(savedProfiles.map((profile) => [profile.id, profile]));

  return provider.models
    .map((modelId) => modelId.trim())
    .filter(Boolean)
    .map((modelId) => {
      const saved = savedMap.get(modelId);
      return {
        id: modelId,
        purposes: saved?.purposes.length
          ? saved.purposes
          : inferModelPurposes(modelId),
      } satisfies ProviderModelProfile;
    });
}

export function getProviderModelsForPurpose(
  provider: Provider,
  registry: ProviderModelRegistry,
  purpose: ModelPurpose,
): string[] {
  return getProviderModelProfiles(provider, registry)
    .filter((profile) => profile.purposes.includes(purpose))
    .map((profile) => profile.id);
}

export function getProvidersForPurpose(
  providers: Provider[],
  registry: ProviderModelRegistry,
  purpose: ModelPurpose,
): Provider[] {
  return providers.filter(
    (provider) => getProviderModelsForPurpose(provider, registry, purpose).length > 0,
  );
}

export function providerPurposeCounts(
  provider: Provider,
  registry: ProviderModelRegistry,
): Record<ModelPurpose, number> {
  const counts: Record<ModelPurpose, number> = {
    chat: 0,
    stt: 0,
    tts: 0,
    image: 0,
  };

  for (const profile of getProviderModelProfiles(provider, registry)) {
    for (const purpose of profile.purposes) {
      counts[purpose] += 1;
    }
  }

  return counts;
}
