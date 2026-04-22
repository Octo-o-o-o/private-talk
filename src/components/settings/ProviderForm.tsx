import {
  ChevronDown,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../lib/i18n";
import {
  getProviderModelProfiles,
  providerPurposeCounts,
  serializeProviderModelRegistry,
} from "../../lib/providerModels";
import * as api from "../../lib/tauri";
import type { ModelPurpose, ProviderModelProfile } from "../../lib/types";
import { useAppStore } from "../../stores/appStore";
import { Field, FormError, TextField, buttonStyles } from "./formControls";
import { SettingsSection } from "./SettingsPage";

const PROVIDER_MODEL_REGISTRY_SETTING_KEY = "provider_model_registry";
const CHAT_PROVIDER_SETTING_KEY = "chat_provider_id";
const CHAT_MODEL_SETTING_KEY = "chat_model";
const STT_PROVIDER_SETTING_KEY = "stt_provider_id";
const STT_MODEL_SETTING_KEY = "stt_model";
const TTS_PROVIDER_SETTING_KEY = "tts_provider_id";
const TTS_MODEL_SETTING_KEY = "tts_model";

type Preset = {
  name: string;
  baseUrl: string;
  models: ProviderModelProfile[];
};

const PRESETS: Preset[] = [
  {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "gpt-5.4", purposes: ["chat"] },
      { id: "gpt-5.4-mini", purposes: ["chat"] },
      { id: "o4-mini", purposes: ["chat"] },
      { id: "whisper-1", purposes: ["stt"] },
      { id: "tts-1", purposes: ["tts"] },
      { id: "gpt-image-1", purposes: ["image"] },
    ],
  },
  {
    name: "Grok (xAI)",
    baseUrl: "https://api.x.ai/v1",
    models: [
      { id: "grok-3", purposes: ["chat"] },
      { id: "grok-3-mini", purposes: ["chat"] },
    ],
  },
];

const PURPOSE_OPTIONS: Array<{
  value: ModelPurpose;
  zh: string;
  en: string;
}> = [
  { value: "chat", zh: "文本", en: "Text" },
  { value: "stt", zh: "转写", en: "STT" },
  { value: "tts", zh: "语音", en: "TTS" },
  { value: "image", zh: "图片", en: "Image" },
];

type FormState = {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: ProviderModelProfile[];
};

function createEmptyModel(): ProviderModelProfile {
  return {
    id: "",
    purposes: ["chat"],
  };
}

const EMPTY_FORM: FormState = {
  name: "",
  baseUrl: "",
  apiKey: "",
  models: [createEmptyModel()],
};

function nextFormState(form: FormState): FormState {
  return {
    ...form,
    models: form.models.map((model) => ({
      id: model.id,
      purposes: [...model.purposes],
    })),
  };
}

export function ProviderForm() {
  const { t } = useI18n();
  const providers = useAppStore((state) => state.providers);
  const providerModelRegistry = useAppStore((state) => state.providerModelRegistry);
  const loadProviders = useAppStore((state) => state.loadProviders);
  const loadSpeechSettings = useAppStore((state) => state.loadSpeechSettings);
  const loadImageGenConfig = useAppStore((state) => state.loadImageGenConfig);
  const [showForm, setShowForm] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateModel(
    index: number,
    updater: (model: ProviderModelProfile) => ProviderModelProfile,
  ): void {
    setForm((current) => ({
      ...current,
      models: current.models.map((model, modelIndex) =>
        modelIndex === index ? updater(model) : model,
      ),
    }));
  }

  function addModel(): void {
    setForm((current) => ({
      ...current,
      models: [...current.models, createEmptyModel()],
    }));
  }

  function removeModel(index: number): void {
    setForm((current) => ({
      ...current,
      models:
        current.models.length > 1
          ? current.models.filter((_, modelIndex) => modelIndex !== index)
          : [createEmptyModel()],
    }));
  }

  function toggleModelPurpose(index: number, purpose: ModelPurpose): void {
    updateModel(index, (model) => {
      const purposes = model.purposes.includes(purpose)
        ? model.purposes.filter((value) => value !== purpose)
        : [...model.purposes, purpose];
      return {
        ...model,
        purposes,
      };
    });
  }

  function resetForm(): void {
    setForm(nextFormState(EMPTY_FORM));
    setShowForm(false);
    setShowPresets(false);
    setShowKey(false);
    setError(null);
    setEditingId(null);
  }

  function applyPreset(preset: Preset): void {
    setForm({
      name: preset.name,
      baseUrl: preset.baseUrl,
      apiKey: "",
      models: preset.models.map((model) => ({
        id: model.id,
        purposes: [...model.purposes],
      })),
    });
    setShowForm(true);
    setShowPresets(false);
    setEditingId(null);
  }

  function beginCustomCreate(): void {
    setForm(nextFormState(EMPTY_FORM));
    setShowForm(true);
    setShowPresets(false);
    setEditingId(null);
    setShowKey(false);
    setError(null);
  }

  function beginEdit(id: string): void {
    const provider = providers.find((item) => item.id === id);
    if (!provider) {
      return;
    }

    const profiles = getProviderModelProfiles(provider, providerModelRegistry);

    setEditingId(id);
    setForm({
      name: provider.name,
      baseUrl: provider.base_url,
      apiKey: provider.api_key,
      models: profiles.length > 0 ? profiles : [createEmptyModel()],
    });
    setShowForm(true);
    setShowPresets(false);
    setShowKey(false);
    setError(null);
  }

  async function seedPurposeDefaults(
    providerId: string,
    profiles: ProviderModelProfile[],
  ): Promise<void> {
    const chatModel = profiles.find((profile) => profile.purposes.includes("chat"))?.id ?? "";
    const sttModel = profiles.find((profile) => profile.purposes.includes("stt"))?.id ?? "";
    const ttsModel = profiles.find((profile) => profile.purposes.includes("tts"))?.id ?? "";
    const imageModel = profiles.find((profile) => profile.purposes.includes("image"))?.id ?? "";

    const [
      storedChatProviderId,
      storedChatModel,
      storedSttProviderId,
      storedSttModel,
      storedTtsProviderId,
      storedTtsModel,
      imageGenConfig,
    ] = await Promise.all([
      api.getSetting(CHAT_PROVIDER_SETTING_KEY),
      api.getSetting(CHAT_MODEL_SETTING_KEY),
      api.getSetting(STT_PROVIDER_SETTING_KEY),
      api.getSetting(STT_MODEL_SETTING_KEY),
      api.getSetting(TTS_PROVIDER_SETTING_KEY),
      api.getSetting(TTS_MODEL_SETTING_KEY),
      api.getImageGenConfig(),
    ]);

    const tasks: Promise<unknown>[] = [];

    if (chatModel && (!storedChatProviderId?.trim() || !storedChatModel?.trim())) {
      tasks.push(api.setSetting(CHAT_PROVIDER_SETTING_KEY, providerId));
      tasks.push(api.setSetting(CHAT_MODEL_SETTING_KEY, chatModel));
    }

    if (sttModel && !storedSttProviderId?.trim()) {
      tasks.push(api.setSetting(STT_PROVIDER_SETTING_KEY, providerId));
    }
    if (sttModel && !storedSttModel?.trim()) {
      tasks.push(api.setSetting(STT_MODEL_SETTING_KEY, sttModel));
    }

    if (ttsModel && !storedTtsProviderId?.trim()) {
      tasks.push(api.setSetting(TTS_PROVIDER_SETTING_KEY, providerId));
    }
    if (ttsModel && !storedTtsModel?.trim()) {
      tasks.push(api.setSetting(TTS_MODEL_SETTING_KEY, ttsModel));
    }

    if (imageModel && !imageGenConfig.provider_id.trim() && !imageGenConfig.model.trim()) {
      tasks.push(
        api.setImageGenConfig({
          ...imageGenConfig,
          provider_id: providerId,
          model: imageModel,
        }),
      );
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    }
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    const name = form.name.trim();
    const baseUrl = form.baseUrl.trim();
    const apiKey = form.apiKey.trim();
    const normalizedModels = form.models.map((model) => ({
      id: model.id.trim(),
      purposes: Array.from(new Set(model.purposes)),
    }));
    const modelNames = normalizedModels.map((model) => model.id);

    if (!name || !baseUrl) {
      setError(
        t("名称和 Base URL 不能为空。", "Name and base URL are required."),
      );
      return;
    }

    if (normalizedModels.some((model) => !model.id)) {
      setError(
        t("每个模型都需要填写名称。", "Every model needs a name."),
      );
      return;
    }

    if (normalizedModels.some((model) => model.purposes.length === 0)) {
      setError(
        t(
          "请为每个模型至少选择一个用途。",
          "Choose at least one purpose for every model.",
        ),
      );
      return;
    }

    if (new Set(modelNames).size !== modelNames.length) {
      setError(
        t("模型名称不能重复。", "Model names must be unique."),
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const providerId = editingId
        ? editingId
        : (await api.createProvider(name, baseUrl, apiKey, modelNames)).id;

      if (editingId) {
        await api.updateProvider(editingId, name, baseUrl, apiKey, modelNames);
      }

      const nextRegistry = {
        ...providerModelRegistry,
        [providerId]: normalizedModels,
      };

      await api.setSetting(
        PROVIDER_MODEL_REGISTRY_SETTING_KEY,
        serializeProviderModelRegistry(nextRegistry),
      );
      await seedPurposeDefaults(providerId, normalizedModels);
      await loadProviders();
      await loadSpeechSettings();
      await loadImageGenConfig();
      resetForm();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t(
              "保存服务商失败，请检查端点后重试。",
              "Failed to save provider. Check the endpoint and try again.",
            ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    setError(null);

    try {
      const nextRegistry = { ...providerModelRegistry };
      delete nextRegistry[id];

      await api.deleteProvider(id);
      await api.setSetting(
        PROVIDER_MODEL_REGISTRY_SETTING_KEY,
        serializeProviderModelRegistry(nextRegistry),
      );
      await loadProviders();
      await loadSpeechSettings();
      await loadImageGenConfig();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : t("删除服务商失败。", "Failed to delete provider."),
      );
    }
  }

  async function handleSetDefault(id: string): Promise<void> {
    setError(null);
    try {
      await api.setDefaultProvider(id);
      await loadProviders();
    } catch (setDefaultError) {
      setError(
        setDefaultError instanceof Error
          ? setDefaultError.message
          : t("设置默认服务商失败。", "Failed to set the default provider."),
      );
    }
  }

  return (
    <SettingsSection
      title={t("模型服务商", "Model Providers")}
      footer={t(
        "服务商只负责端点与密钥，模型用途映射只保存在本地，用来决定哪些模型用于文本、转写、语音和图片。",
        "Providers store endpoints and keys. Model purpose mapping stays local and decides which models are used for text, transcription, voice, and image generation.",
      )}
    >
      {providers.length === 0 && !showForm && !showPresets ? (
        <div className="pt-settings-row">
          <div className="pt-settings-row__copy">
            <p className="pt-settings-row__title">{t("还没有服务商", "No providers yet")}</p>
            <p className="pt-settings-row__detail">
              {t(
                "添加服务商时，顺手把模型用途标好，后面的文本、语音和图片路由就能直接复用。",
                "Add a provider and tag what each model is for so text, voice, and image routing can reuse it.",
              )}
            </p>
          </div>
        </div>
      ) : null}

      {providers.map((provider) => {
        const counts = providerPurposeCounts(provider, providerModelRegistry);
        const summary = [
          counts.chat > 0 ? t(`${counts.chat} 个文本`, `${counts.chat} text`) : null,
          counts.stt > 0 ? t(`${counts.stt} 个转写`, `${counts.stt} STT`) : null,
          counts.tts > 0 ? t(`${counts.tts} 个语音`, `${counts.tts} TTS`) : null,
          counts.image > 0 ? t(`${counts.image} 个图片`, `${counts.image} image`) : null,
        ]
          .filter(Boolean)
          .join(" · ");

        return (
          <div key={provider.id} className="pt-settings-row">
            <div className="pt-settings-row__copy">
              <div className="pt-settings-row__title-line">
                <p className="pt-settings-row__title">{provider.name}</p>
                {provider.is_default ? (
                  <span className="pt-badge">
                    <Star size={10} className="fill-current" />
                    {t("默认", "Default")}
                  </span>
                ) : null}
              </div>
              <p className="pt-settings-row__detail">
                {provider.base_url}
                {summary ? ` · ${summary}` : ""}
              </p>
            </div>

            <div className="pt-settings-row__actions">
              <button
                type="button"
                className="pt-row-icon"
                onClick={() => beginEdit(provider.id)}
                aria-label={t(`编辑 ${provider.name}`, `Edit ${provider.name}`)}
                title={t("编辑服务商", "Edit provider")}
              >
                <Pencil size={14} />
              </button>

              {!provider.is_default ? (
                <button
                  type="button"
                  className="pt-row-icon"
                  onClick={() => void handleSetDefault(provider.id)}
                  aria-label={t(`将 ${provider.name} 设为默认`, `Set ${provider.name} as default`)}
                  title={t("设为默认", "Set as default")}
                >
                  <Star size={14} />
                </button>
              ) : null}

              <button
                type="button"
                className="pt-row-icon pt-row-icon--danger"
                onClick={() => void handleDelete(provider.id)}
                aria-label={t(`删除 ${provider.name}`, `Delete ${provider.name}`)}
                title={t("删除服务商", "Delete provider")}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}

      {!showForm ? (
        <button
          type="button"
          className="pt-settings-row pt-settings-row--interactive"
          onClick={() => setShowPresets((value) => !value)}
        >
          <div className="pt-settings-row__copy">
            <div className="pt-settings-row__title-line">
              <p className="pt-settings-row__title">{t("添加服务商", "Add Provider")}</p>
              <ChevronDown
                size={16}
                className={`pt-row-chevron${showPresets ? " is-open" : ""}`}
              />
            </div>
            <p className="pt-settings-row__detail">
              {t(
                "使用预设，或者输入一个自定义端点并逐个标记模型用途。",
                "Use a preset or enter a custom endpoint and tag each model's purpose.",
              )}
            </p>
          </div>
        </button>
      ) : null}

      {showPresets && !showForm ? (
        <div className="pt-settings-expand">
          <div className="pt-chip-row">
            {PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className={buttonStyles.chip}
                onClick={() => applyPreset(preset)}
              >
                <Plus size={13} />
                {preset.name}
              </button>
            ))}
            <button
              type="button"
              className={buttonStyles.chip}
              onClick={beginCustomCreate}
            >
              <Plus size={13} />
              {t("自定义", "Custom")}
            </button>
          </div>
        </div>
      ) : null}

      {showForm ? (
        <form className="pt-settings-expand pt-settings-form" onSubmit={handleSubmit}>
          <TextField
            label={t("名称", "Name")}
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            placeholder="OpenAI"
          />

          <TextField
            label="Base URL"
            value={form.baseUrl}
            onChange={(event) => updateField("baseUrl", event.target.value)}
            placeholder="https://api.openai.com/v1"
          />

          <Field label={t("API Key", "API Key")}>
            <div className="pt-input-wrap">
              <input
                type={showKey ? "text" : "password"}
                value={form.apiKey}
                onChange={(event) => updateField("apiKey", event.target.value)}
                className="pt-input pt-input--with-action"
                placeholder={editingId ? t("可直接修改当前 Key", "Edit the stored key if needed") : "sk-..."}
              />
              <button
                type="button"
                className="pt-input-wrap__action"
                onClick={() => setShowKey((value) => !value)}
                aria-label={showKey ? t("隐藏 API Key", "Hide API key") : t("显示 API Key", "Show API key")}
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </Field>

          <Field label={t("模型与用途", "Models & Purposes")}>
            <div className="pt-provider-model-list">
              {form.models.map((model, index) => (
                <div key={`${editingId ?? "new"}-${index}`} className="pt-provider-model-card">
                  <div className="pt-provider-model-card__header">
                    <input
                      className="pt-input"
                      value={model.id}
                      onChange={(event) =>
                        updateModel(index, (current) => ({
                          ...current,
                          id: event.target.value,
                        }))
                      }
                      placeholder={t("模型名，例如 gpt-5.4", "Model name, for example gpt-5.4")}
                    />

                    {form.models.length > 1 ? (
                      <button
                        type="button"
                        className="pt-row-icon"
                        onClick={() => removeModel(index)}
                        aria-label={t("删除模型", "Remove model")}
                      >
                        <X size={14} />
                      </button>
                    ) : null}
                  </div>

                  <div className="pt-chip-row pt-provider-model-card__purposes">
                    {PURPOSE_OPTIONS.map((option) => {
                      const active = model.purposes.includes(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`${buttonStyles.chip}${active ? " is-active" : ""}`}
                          onClick={() => toggleModelPurpose(index, option.value)}
                        >
                          {t(option.zh, option.en)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Field>

          <div className="pt-settings-form__actions pt-settings-form__actions--start">
            <button type="button" className={buttonStyles.secondary} onClick={addModel}>
              <Plus size={14} />
              {t("添加模型", "Add Model")}
            </button>
          </div>

          <p className="pt-settings-help">
            {t(
              "文本模型会出现在新建聊天和聊天头部；转写、语音和图片模型会在对应设置页里自动过滤出来。",
              "Text models appear in new chat and the chat header. Transcription, voice, and image models are filtered into their matching settings automatically.",
            )}
          </p>

          <FormError message={error} />

          <div className="pt-settings-form__actions">
            <button type="button" className={buttonStyles.secondary} onClick={resetForm}>
              {t("取消", "Cancel")}
            </button>
            <button
              type="submit"
              className={buttonStyles.primary}
              disabled={submitting}
            >
              {submitting
                ? t("保存中...", "Saving...")
                : editingId
                  ? t("保存服务商", "Save Provider")
                  : t("创建服务商", "Create Provider")}
            </button>
          </div>
        </form>
      ) : null}
    </SettingsSection>
  );
}
