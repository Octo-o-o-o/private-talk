import { ChevronDown, Copy, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import * as api from "../../lib/tauri";
import type { Assistant } from "../../lib/types";
import { useAppStore } from "../../stores/appStore";
import { buttonStyles, Field, FormError, TextField } from "./formControls";
import { SettingsSection } from "./SettingsPage";

type FormState = {
  name: string;
  description: string;
  systemPrompt: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  systemPrompt: "",
};

export function ConversationAssistantsSection() {
  const { t } = useI18n();
  const assistants = useAppStore((state) => state.assistants);
  const loadAssistants = useAppStore((state) => state.loadAssistants);
  const [expanded, setExpanded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingAssistant, setEditingAssistant] = useState<Assistant | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [presetAssistants, customAssistants] = useMemo(
    () => [
      assistants.filter((assistant) => assistant.is_preset),
      assistants.filter((assistant) => !assistant.is_preset),
    ],
    [assistants],
  );

  function resetForm(): void {
    setForm(EMPTY_FORM);
    setEditingAssistant(null);
    setShowForm(false);
    setError(null);
  }

  function beginCreate(): void {
    setEditingAssistant(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setError(null);
  }

  function beginEdit(assistant: Assistant): void {
    setEditingAssistant(assistant);
    setForm({
      name: assistant.name,
      description: assistant.description,
      systemPrompt: assistant.system_prompt,
    });
    setShowForm(true);
    setError(null);
  }

  async function handleDuplicate(id: string): Promise<void> {
    setError(null);
    try {
      await api.duplicateAssistant(id);
      await loadAssistants();
    } catch (duplicateError) {
      setError(
        duplicateError instanceof Error
          ? duplicateError.message
          : t("复制助手失败。", "Failed to duplicate assistant."),
      );
    }
  }

  async function handleDelete(id: string): Promise<void> {
    setError(null);
    try {
      await api.deleteAssistant(id);
      await loadAssistants();
      if (editingAssistant?.id === id) {
        resetForm();
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : t("删除助手失败。", "Failed to delete assistant."),
      );
    }
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!form.name.trim()) {
      setError(t("助手名称不能为空。", "Assistant name is required."));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (editingAssistant) {
        await api.updateAssistant(
          editingAssistant.id,
          form.name.trim(),
          form.description.trim(),
          form.systemPrompt.trim(),
        );
      } else {
        await api.createAssistant(
          form.name.trim(),
          form.description.trim(),
          form.systemPrompt.trim(),
        );
      }
      await loadAssistants();
      resetForm();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t("保存助手失败。", "Failed to save assistant."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SettingsSection
      title={t("会话助手", "Conversation Assistants")}
      footer={t(
        "这里的助手会绑定到单个会话，适合角色化系统提示词。新建聊天时可以从这里选择。",
        "These assistants attach to a single conversation and work well for role-specific system prompts. You can choose one when starting a new chat.",
      )}
    >
      <button
        type="button"
        className="pt-settings-row pt-settings-row--interactive"
        onClick={() => {
          setExpanded((value) => !value);
          setError(null);
        }}
      >
        <div className="pt-settings-row__copy">
          <div className="pt-settings-row__title-line">
            <p className="pt-settings-row__title">{t("预设与自定义助手", "Preset & Custom Assistants")}</p>
            <ChevronDown size={16} className={`pt-row-chevron${expanded ? " is-open" : ""}`} />
          </div>
          <p className="pt-settings-row__detail">
            {t(
              `${presetAssistants.length} 个预设 · ${customAssistants.length} 个自定义`,
              `${presetAssistants.length} presets · ${customAssistants.length} custom`,
            )}
          </p>
        </div>
      </button>

      {expanded ? (
        <div className="pt-settings-expand pt-settings-form">
          <div className="pt-settings-form__actions pt-settings-form__actions--start">
            <button type="button" className={buttonStyles.secondary} onClick={beginCreate}>
              <Plus size={14} />
              {t("新建助手", "New Assistant")}
            </button>
          </div>

          <div className="pt-assistant-library">
            {assistants.map((assistant) => (
              <div key={assistant.id} className="pt-assistant-card">
                <div className="pt-assistant-card__icon">
                  <Sparkles size={16} />
                </div>
                <div className="pt-assistant-card__copy">
                  <div className="pt-settings-row__title-line">
                    <p className="pt-settings-row__title">{assistant.name}</p>
                    {assistant.is_preset ? (
                      <span className="pt-badge">{t("预设", "Preset")}</span>
                    ) : null}
                  </div>
                  <p className="pt-settings-row__detail">
                    {assistant.description || t("没有描述。", "No description.")}
                  </p>
                  {assistant.system_prompt ? (
                    <p className="pt-assistant-card__prompt">{assistant.system_prompt}</p>
                  ) : null}
                </div>
                <div className="pt-settings-row__actions">
                  <button
                    type="button"
                    className="pt-row-icon"
                    onClick={() => void handleDuplicate(assistant.id)}
                    aria-label={t(`复制 ${assistant.name}`, `Duplicate ${assistant.name}`)}
                    title={t("复制助手", "Duplicate assistant")}
                  >
                    <Copy size={14} />
                  </button>
                  {!assistant.is_preset ? (
                    <button
                      type="button"
                      className="pt-row-icon"
                      onClick={() => beginEdit(assistant)}
                      aria-label={t(`编辑 ${assistant.name}`, `Edit ${assistant.name}`)}
                      title={t("编辑助手", "Edit assistant")}
                    >
                      <Pencil size={14} />
                    </button>
                  ) : null}
                  {!assistant.is_preset ? (
                    <button
                      type="button"
                      className="pt-row-icon pt-row-icon--danger"
                      onClick={() => void handleDelete(assistant.id)}
                      aria-label={t(`删除 ${assistant.name}`, `Delete ${assistant.name}`)}
                      title={t("删除助手", "Delete assistant")}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {showForm ? (
            <form className="pt-assistant-editor" onSubmit={handleSubmit}>
              <div className="pt-settings-row__title-line">
                <p className="pt-settings-row__title">
                  {editingAssistant
                    ? t("编辑自定义助手", "Edit Custom Assistant")
                    : t("新建自定义助手", "New Custom Assistant")}
                </p>
                <button
                  type="button"
                  className="pt-row-icon"
                  onClick={resetForm}
                  aria-label={t("关闭表单", "Close form")}
                >
                  <X size={14} />
                </button>
              </div>

              <TextField
                label={t("名称", "Name")}
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder={t("例如：面试教练", "For example: Interview Coach")}
              />

              <TextField
                label={t("描述", "Description")}
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
                placeholder={t("给新会话选择器看的简短摘要", "Short summary shown in the new chat picker")}
              />

              <Field label={t("系统提示词", "System Prompt")}>
                <textarea
                  className="pt-input pt-input--textarea"
                  rows={6}
                  value={form.systemPrompt}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, systemPrompt: event.target.value }))
                  }
                  placeholder={t(
                    "定义这个助手在整段会话里的身份、边界和回答方式。",
                    "Define this assistant's role, boundaries, and response style for the whole conversation.",
                  )}
                />
              </Field>

              <FormError message={error} />

              <div className="pt-settings-form__actions">
                <button type="button" className={buttonStyles.secondary} onClick={resetForm}>
                  {t("取消", "Cancel")}
                </button>
                <button type="submit" className={buttonStyles.primary} disabled={submitting}>
                  {submitting ? t("保存中...", "Saving...") : t("保存助手", "Save Assistant")}
                </button>
              </div>
            </form>
          ) : null}

          {!showForm ? <FormError message={error} /> : null}
        </div>
      ) : null}
    </SettingsSection>
  );
}
