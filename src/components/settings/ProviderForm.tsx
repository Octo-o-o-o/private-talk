import {
  ChevronDown,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../lib/i18n";
import * as api from "../../lib/tauri";
import { useAppStore } from "../../stores/appStore";
import { SettingsSection } from "./SettingsPage";
import { Field, FormError, TextField, buttonStyles } from "./formControls";

type Preset = {
  name: string;
  baseUrl: string;
  models: string;
};

const PRESETS: Preset[] = [
  {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: "gpt-5.4,gpt-5.4-mini,o4-mini",
  },
  {
    name: "Grok (xAI)",
    baseUrl: "https://api.x.ai/v1",
    models: "grok-3,grok-3-mini",
  },
];

type FormState = {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  baseUrl: "",
  apiKey: "",
  models: "",
};

function parseModels(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function ProviderForm() {
  const { t } = useI18n();
  const { providers, loadProviders } = useAppStore();
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

  function resetForm(): void {
    setForm(EMPTY_FORM);
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
      models: preset.models,
    });
    setShowForm(true);
    setShowPresets(false);
    setEditingId(null);
  }

  function beginEdit(id: string): void {
    const provider = providers.find((item) => item.id === id);
    if (!provider) {
      return;
    }

    setEditingId(id);
    setForm({
      name: provider.name,
      baseUrl: provider.base_url,
      apiKey: provider.api_key,
      models: provider.models.join(", "),
    });
    setShowForm(true);
    setShowPresets(false);
    setShowKey(false);
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    const name = form.name.trim();
    const baseUrl = form.baseUrl.trim();
    const apiKey = form.apiKey.trim();
    const models = parseModels(form.models);

    if (!name || !baseUrl) {
      setError(
        t("名称和 Base URL 不能为空。", "Name and base URL are required."),
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (editingId) {
        await api.updateProvider(editingId, name, baseUrl, apiKey, models);
      } else {
        await api.createProvider(name, baseUrl, apiKey, models);
      }
      await loadProviders();
      resetForm();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
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
      await api.deleteProvider(id);
      await loadProviders();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : t("删除服务商失败。", "Failed to delete provider."),
      );
    }
  }

  async function handleSetDefault(id: string): Promise<void> {
    setError(null);
    try {
      await api.setDefaultProvider(id);
      await loadProviders();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : t("设置默认服务商失败。", "Failed to set the default provider."),
      );
    }
  }

  return (
    <SettingsSection
      title={t("模型服务商", "Model Providers")}
      footer={t(
        "Key 只保存在本地，并且只会发送给你选中的端点。",
        "Keys stay local and are only sent to the endpoint you choose.",
      )}
    >
      {providers.length === 0 && !showForm && !showPresets ? (
        <div className="pt-settings-row">
          <div className="pt-settings-row__copy">
            <p className="pt-settings-row__title">{t("还没有服务商", "No providers yet")}</p>
            <p className="pt-settings-row__detail">
              {t(
                "可以从预设开始，或者手动输入一个自定义端点。",
                "Create one from a preset or enter a custom endpoint.",
              )}
            </p>
          </div>
        </div>
      ) : null}

      {providers.map((provider) => (
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
              {provider.base_url} · {provider.models.length} {provider.models.length === 1 ? t("个模型", "model") : t("个模型", "models")}
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
      ))}

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
                "使用预设，或者输入一个自定义端点。",
                "Use a preset or enter a custom endpoint.",
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
              onClick={() => {
                setShowForm(true);
                setShowPresets(false);
                setEditingId(null);
              }}
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

          <TextField
            label={t("模型列表（逗号分隔）", "Models (comma-separated)")}
            value={form.models}
            onChange={(event) => updateField("models", event.target.value)}
            placeholder="gpt-5.4, gpt-5.4-mini"
          />

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
