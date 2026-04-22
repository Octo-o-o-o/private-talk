import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n";
import * as api from "../../lib/tauri";
import { buttonStyles, Field, FormError } from "./formControls";
import { SettingsSection } from "./SettingsPage";

const ASSISTANT_PRESET_KEY = "assistant_preset";
const ASSISTANT_LANGUAGE_KEY = "assistant_language";
const ASSISTANT_PROMPT_KEY = "assistant_custom_prompt";

type AssistantPreset = "default" | "coder" | "writer" | "translator" | "research";
type ReplyLanguage = "auto" | "zh-CN" | "en" | "ja" | "ko";

const PRESET_OPTIONS: Array<{
  value: AssistantPreset;
  label: string;
  description: string;
}> = [
  {
    value: "default",
    label: "Balanced Assistant",
    description: "General-purpose responses with concise, practical tone.",
  },
  {
    value: "coder",
    label: "Coding Assistant",
    description: "Prioritizes debugging, implementation details, and code quality.",
  },
  {
    value: "writer",
    label: "Writing Assistant",
    description: "Focuses on clarity, structure, and polished phrasing.",
  },
  {
    value: "translator",
    label: "Translation Assistant",
    description: "Preserves meaning, formatting, and terminology accurately.",
  },
  {
    value: "research",
    label: "Research Assistant",
    description: "Compares options, calls out assumptions, and synthesizes findings.",
  },
];

const LANGUAGE_OPTIONS: Array<{
  value: ReplyLanguage;
  label: string;
}> = [
  { value: "auto", label: "Follow conversation" },
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

function normalizePreset(value: string | null): AssistantPreset {
  if (value === "coder" || value === "writer" || value === "translator" || value === "research") {
    return value;
  }
  return "default";
}

function normalizeLanguage(value: string | null): ReplyLanguage {
  if (value === "zh-CN" || value === "en" || value === "ja" || value === "ko") {
    return value;
  }
  return "auto";
}

function presetLabel(value: AssistantPreset): string {
  return PRESET_OPTIONS.find((option) => option.value === value)?.label ?? "Balanced Assistant";
}

function languageLabel(value: ReplyLanguage): string {
  return LANGUAGE_OPTIONS.find((option) => option.value === value)?.label ?? "Follow conversation";
}

export function AssistantSettingsSection() {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantPreset, setAssistantPreset] =
    useState<AssistantPreset>("default");
  const [replyLanguage, setReplyLanguage] =
    useState<ReplyLanguage>("auto");
  const [customPrompt, setCustomPrompt] = useState("");
  const [savedAssistantPreset, setSavedAssistantPreset] =
    useState<AssistantPreset>("default");
  const [savedReplyLanguage, setSavedReplyLanguage] =
    useState<ReplyLanguage>("auto");
  const [savedCustomPrompt, setSavedCustomPrompt] = useState("");

  function restoreSaved(): void {
    setAssistantPreset(savedAssistantPreset);
    setReplyLanguage(savedReplyLanguage);
    setCustomPrompt(savedCustomPrompt);
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [storedPreset, storedLanguage, storedPrompt] = await Promise.all([
          api.getSetting(ASSISTANT_PRESET_KEY),
          api.getSetting(ASSISTANT_LANGUAGE_KEY),
          api.getSetting(ASSISTANT_PROMPT_KEY),
        ]);

        if (cancelled) {
          return;
        }

        const nextPreset = normalizePreset(storedPreset);
        const nextLanguage = normalizeLanguage(storedLanguage);
        const nextPrompt = storedPrompt ?? "";

        setAssistantPreset(nextPreset);
        setReplyLanguage(nextLanguage);
        setCustomPrompt(nextPrompt);
        setSavedAssistantPreset(nextPreset);
        setSavedReplyLanguage(nextLanguage);
        setSavedCustomPrompt(nextPrompt);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        console.warn("Assistant settings unavailable:", loadError);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      await Promise.all([
        api.setSetting(ASSISTANT_PRESET_KEY, assistantPreset),
        api.setSetting(ASSISTANT_LANGUAGE_KEY, replyLanguage),
        api.setSetting(ASSISTANT_PROMPT_KEY, customPrompt.trim()),
      ]);
      setSavedAssistantPreset(assistantPreset);
      setSavedReplyLanguage(replyLanguage);
      setSavedCustomPrompt(customPrompt.trim());
      setExpanded(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("保存助手偏好失败。", "Failed to save assistant preferences."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      title={t("助手", "Assistant")}
      footer={t(
        "这些偏好会保存在本地，并作为 system instruction 附到新请求里。",
        "These preferences stay local and are attached to new requests as system instructions.",
      )}
    >
      <button
        type="button"
        className="pt-settings-row pt-settings-row--interactive"
        onClick={() => {
          setExpanded((value) => {
            if (value) {
              restoreSaved();
            }
            return !value;
          });
          setError(null);
        }}
      >
        <div className="pt-settings-row__copy">
          <div className="pt-settings-row__title-line">
            <p className="pt-settings-row__title">{t("助手与回复语言", "Assistant & Language")}</p>
            <ChevronDown
              size={16}
              className={`pt-row-chevron${expanded ? " is-open" : ""}`}
            />
          </div>
          <p className="pt-settings-row__detail">
            {loading
              ? t("正在加载偏好...", "Loading preferences...")
              : `${presetLabel(assistantPreset)} · ${languageLabel(replyLanguage)}`}
          </p>
        </div>
      </button>

      {expanded ? (
        <form className="pt-settings-expand pt-settings-form" onSubmit={handleSave}>
          <Field label={t("助手风格", "Assistant")}>
            <select
              value={assistantPreset}
              onChange={(event) =>
                setAssistantPreset(event.target.value as AssistantPreset)
              }
              className="pt-select"
            >
              {PRESET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <p className="pt-settings-help">
            {
              PRESET_OPTIONS.find((option) => option.value === assistantPreset)
                ?.description
            }
          </p>

          <Field label={t("回复语言", "Reply Language")}>
            <select
              value={replyLanguage}
              onChange={(event) =>
                setReplyLanguage(event.target.value as ReplyLanguage)
              }
              className="pt-select"
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("附加指令", "Extra Instructions")}>
            <textarea
              value={customPrompt}
              onChange={(event) => setCustomPrompt(event.target.value)}
              className="pt-input pt-input--textarea"
              rows={4}
              placeholder={t(
                "可选。例如：控制在 5 个要点以内、优先使用 Markdown 表格、或者始终解释权衡。",
                "Optional. For example: keep replies under 5 bullets, prefer markdown tables, or always explain tradeoffs.",
              )}
            />
          </Field>

          <FormError message={error} />

          <div className="pt-settings-form__actions">
            <button
              type="button"
              className={buttonStyles.secondary}
              onClick={() => {
                restoreSaved();
                setExpanded(false);
                setError(null);
              }}
            >
              {t("取消", "Cancel")}
            </button>
            <button
              type="submit"
              className={buttonStyles.primary}
              disabled={saving}
            >
              {saving ? t("保存中...", "Saving...") : t("保存偏好", "Save Preferences")}
            </button>
          </div>
        </form>
      ) : null}
    </SettingsSection>
  );
}
