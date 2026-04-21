import {
  ChevronDown,
  Eye,
  EyeOff,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { useState } from "react";
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
  const { providers, loadProviders } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function resetForm(): void {
    setForm(EMPTY_FORM);
    setShowForm(false);
    setShowPresets(false);
    setShowKey(false);
    setError(null);
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
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    const name = form.name.trim();
    const baseUrl = form.baseUrl.trim();
    const apiKey = form.apiKey.trim();

    if (!name || !baseUrl || !apiKey) {
      setError("Name, base URL, and API key are required.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await api.createProvider(name, baseUrl, apiKey, parseModels(form.models));
      await loadProviders();
      resetForm();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Failed to save provider. Check the endpoint and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    await api.deleteProvider(id);
    await loadProviders();
  }

  async function handleSetDefault(id: string): Promise<void> {
    await api.setDefaultProvider(id);
    await loadProviders();
  }

  return (
    <SettingsSection
      title="Model Providers"
      footer="Add OpenAI-compatible endpoints. Keys are stored locally and are only sent to the endpoint you choose."
    >
      {providers.length === 0 && !showForm && !showPresets ? (
        <div className="pt-settings-row">
          <div className="pt-settings-row__copy">
            <p className="pt-settings-row__title">No providers yet</p>
            <p className="pt-settings-row__detail">
              Create one from a preset or enter a custom endpoint.
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
                  Default
                </span>
              ) : null}
            </div>
            <p className="pt-settings-row__detail">
              {provider.base_url} · {provider.models.length} model
              {provider.models.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="pt-settings-row__actions">
            {!provider.is_default ? (
              <button
                type="button"
                className="pt-row-icon"
                onClick={() => void handleSetDefault(provider.id)}
                aria-label={`Set ${provider.name} as default`}
                title="Set as default"
              >
                <Star size={14} />
              </button>
            ) : null}

            <button
              type="button"
              className="pt-row-icon pt-row-icon--danger"
              onClick={() => void handleDelete(provider.id)}
              aria-label={`Delete ${provider.name}`}
              title="Delete provider"
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
              <p className="pt-settings-row__title">Add Provider</p>
              <ChevronDown
                size={16}
                className={`pt-row-chevron${showPresets ? " is-open" : ""}`}
              />
            </div>
            <p className="pt-settings-row__detail">
              Use a preset or enter a custom endpoint.
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
              }}
            >
              <Plus size={13} />
              Custom
            </button>
          </div>
        </div>
      ) : null}

      {showForm ? (
        <form className="pt-settings-expand pt-settings-form" onSubmit={handleSubmit}>
          <TextField
            label="Name"
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

          <Field label="API Key">
            <div className="pt-input-wrap">
              <input
                type={showKey ? "text" : "password"}
                value={form.apiKey}
                onChange={(event) => updateField("apiKey", event.target.value)}
                className="pt-input pt-input--with-action"
                placeholder="sk-..."
              />
              <button
                type="button"
                className="pt-input-wrap__action"
                onClick={() => setShowKey((value) => !value)}
                aria-label={showKey ? "Hide API key" : "Show API key"}
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </Field>

          <TextField
            label="Models (comma-separated)"
            value={form.models}
            onChange={(event) => updateField("models", event.target.value)}
            placeholder="gpt-5.4, gpt-5.4-mini"
          />

          <FormError message={error} />

          <div className="pt-settings-form__actions">
            <button type="button" className={buttonStyles.secondary} onClick={resetForm}>
              Cancel
            </button>
            <button
              type="submit"
              className={buttonStyles.primary}
              disabled={submitting}
            >
              {submitting ? "Saving..." : "Save Provider"}
            </button>
          </div>
        </form>
      ) : null}
    </SettingsSection>
  );
}
