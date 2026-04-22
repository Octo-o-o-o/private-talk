import { Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { AssistantIconGlyph, ASSISTANT_ICONS } from "../assistant/assistantIcons";
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
  icon: string;
};

const DEFAULT_ICON = "sparkles";
const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  systemPrompt: "",
  icon: DEFAULT_ICON,
};

export function ConversationAssistantsSection() {
  const { t } = useI18n();
  const assistants = useAppStore((state) => state.assistants);
  const loadAssistants = useAppStore((state) => state.loadAssistants);
  const [showForm, setShowForm] = useState(false);
  const [editingAssistant, setEditingAssistant] = useState<Assistant | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customAssistants, presetAssistants] = useMemo(
    () => [
      assistants.filter((assistant) => !assistant.is_preset),
      assistants.filter((assistant) => assistant.is_preset),
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
      icon: assistant.icon || DEFAULT_ICON,
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
          form.icon,
        );
      } else {
        await api.createAssistant(
          form.name.trim(),
          form.description.trim(),
          form.systemPrompt.trim(),
          form.icon,
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
      title={t("助手库", "Assistant Library")}
      footer={t(
        "这里创建的助手会绑定到单个会话。新建聊天时可以直接选用，也可以在空会话里切换。",
        "Assistants created here attach to a single conversation. You can choose them when starting a chat or switch them in an empty draft.",
      )}
    >
      <div className="pt-settings-card__body pt-settings-form">
        <div className="pt-settings-toolbar">
          <div className="pt-settings-toolbar__copy">
            <p className="pt-settings-toolbar__title">
              {t("管理自定义助手", "Manage Custom Assistants")}
            </p>
            <p className="pt-settings-toolbar__detail">
              {t(
                `${customAssistants.length} 个自定义 · ${presetAssistants.length} 个预设`,
                `${customAssistants.length} custom · ${presetAssistants.length} presets`,
              )}
            </p>
          </div>

          <button
            type="button"
            className={buttonStyles.primary}
            onClick={beginCreate}
          >
            <Plus size={14} />
            {t("新建助手", "New Assistant")}
          </button>
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
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder={t("例如：面试教练", "For example: Interview Coach")}
            />

            <TextField
              label={t("描述", "Description")}
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder={t(
                "给新会话选择器看的简短摘要",
                "Short summary shown in the new chat picker",
              )}
            />

            <Field label={t("图标", "Icon")}>
              <div className="pt-assistant-icon-grid">
                {Object.entries(ASSISTANT_ICONS).map(([key]) => (
                  <button
                    key={key}
                    type="button"
                    className={`pt-assistant-icon-choice${
                      form.icon === key ? " is-active" : ""
                    }`}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        icon: current.icon === key ? DEFAULT_ICON : key,
                      }))
                    }
                    aria-label={key}
                  >
                    <AssistantIconGlyph name={key} size={16} />
                  </button>
                ))}
              </div>
            </Field>

            <Field label={t("系统提示词", "System Prompt")}>
              <textarea
                className="pt-input pt-input--textarea"
                rows={7}
                value={form.systemPrompt}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    systemPrompt: event.target.value,
                  }))
                }
                placeholder={t(
                  "定义这个助手在整段会话里的身份、边界和回答方式。",
                  "Define this assistant's role, boundaries, and response style for the whole conversation.",
                )}
              />
            </Field>

            <FormError message={error} />

            <div className="pt-settings-form__actions">
              <button
                type="button"
                className={buttonStyles.secondary}
                onClick={resetForm}
              >
                {t("取消", "Cancel")}
              </button>
              <button
                type="submit"
                className={buttonStyles.primary}
                disabled={submitting}
              >
                {submitting
                  ? t("保存中...", "Saving...")
                  : t("保存助手", "Save Assistant")}
              </button>
            </div>
          </form>
        ) : null}

        <AssistantListBlock
          title={t("自定义助手", "Custom Assistants")}
          emptyLabel={t(
            "还没有自定义助手。点击上面的“新建助手”开始。",
            "No custom assistants yet. Click “New Assistant” above to create one.",
          )}
          assistants={customAssistants}
          onEdit={beginEdit}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
        />

        <AssistantListBlock
          title={t("预设助手", "Preset Assistants")}
          emptyLabel=""
          assistants={presetAssistants}
          onEdit={null}
          onDelete={null}
          onDuplicate={handleDuplicate}
        />

        {!showForm ? <FormError message={error} /> : null}
      </div>
    </SettingsSection>
  );
}

function AssistantListBlock({
  title,
  emptyLabel,
  assistants,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  title: string;
  emptyLabel: string;
  assistants: Assistant[];
  onEdit: ((assistant: Assistant) => void) | null;
  onDelete: ((id: string) => Promise<void>) | null;
  onDuplicate: (id: string) => Promise<void>;
}) {
  const { t } = useI18n();

  return (
    <div className="pt-settings-subgroup">
      <p className="pt-settings-subgroup__label">{title}</p>

      {assistants.length === 0 ? (
        <p className="pt-settings-help">{emptyLabel}</p>
      ) : (
        <div className="pt-assistant-library">
          {assistants.map((assistant) => (
            <div key={assistant.id} className="pt-assistant-card">
              <div className="pt-assistant-card__icon">
                <AssistantIconGlyph name={assistant.icon} size={16} />
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
                  <p className="pt-assistant-card__prompt">
                    {assistant.system_prompt}
                  </p>
                ) : null}
              </div>
              <div className="pt-settings-row__actions">
                <button
                  type="button"
                  className="pt-row-icon"
                  onClick={() => void onDuplicate(assistant.id)}
                  aria-label={t(`复制 ${assistant.name}`, `Duplicate ${assistant.name}`)}
                  title={t("复制助手", "Duplicate assistant")}
                >
                  <Copy size={14} />
                </button>
                {onEdit ? (
                  <button
                    type="button"
                    className="pt-row-icon"
                    onClick={() => onEdit(assistant)}
                    aria-label={t(`编辑 ${assistant.name}`, `Edit ${assistant.name}`)}
                    title={t("编辑助手", "Edit assistant")}
                  >
                    <Pencil size={14} />
                  </button>
                ) : null}
                {onDelete ? (
                  <button
                    type="button"
                    className="pt-row-icon pt-row-icon--danger"
                    onClick={() => void onDelete(assistant.id)}
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
      )}
    </div>
  );
}
