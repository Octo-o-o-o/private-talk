import { MessageSquarePlus, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../stores/appStore";
import type { LayoutMode } from "./useLayoutMode";

export function NewConversationPicker({
  open,
  layout,
  onClose,
}: {
  open: boolean;
  layout: LayoutMode;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const assistants = useAppStore((state) => state.assistants);
  const createConversation = useAppStore((state) => state.createConversation);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const sortedAssistants = useMemo(
    () => assistants.slice().sort((left, right) => Number(right.is_preset) - Number(left.is_preset)),
    [assistants],
  );

  if (!open) {
    return null;
  }

  async function handleCreate(assistantId: string | null): Promise<void> {
    setSubmittingId(assistantId ?? "__free__");
    try {
      await createConversation(assistantId);
      onClose();
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div className="pt-dialog-root" role="dialog" aria-modal="true" aria-label={t("新建聊天", "New Chat")}>
      <button type="button" className="pt-dialog-backdrop" onClick={onClose} aria-label={t("关闭", "Close")} />
      <div className={`pt-dialog-card pt-dialog-card--${layout}`}>
        <div className="pt-dialog-card__header">
          <div>
            <p className="pt-settings-section__title">{t("新建聊天", "New Chat")}</p>
            <p className="pt-settings-row__detail">
              {t(
                "选择自由对话，或者用某个助手开始一段带系统提示词的新线程。",
                "Choose free chat, or start a new thread with a conversation assistant.",
              )}
            </p>
          </div>
          <button type="button" className="pt-icon-button" onClick={onClose} aria-label={t("关闭", "Close")}>
            <X size={16} />
          </button>
        </div>

        <div className="pt-assistant-picker">
          <button
            type="button"
            className="pt-assistant-picker__item"
            onClick={() => void handleCreate(null)}
            disabled={submittingId !== null}
          >
            <div className="pt-assistant-picker__icon">
              <MessageSquarePlus size={16} />
            </div>
            <div className="pt-assistant-picker__copy">
              <p className="pt-settings-row__title">{t("自由对话", "Free Chat")}</p>
              <p className="pt-settings-row__detail">
                {t(
                  "不绑定额外系统提示词，直接按当前全局偏好开始。",
                  "Start without an attached conversation assistant and use the current global defaults.",
                )}
              </p>
            </div>
            <span className="pt-status-pill">
              {submittingId === "__free__" ? t("创建中...", "Creating...") : t("开始", "Start")}
            </span>
          </button>

          {sortedAssistants.map((assistant) => (
            <button
              key={assistant.id}
              type="button"
              className="pt-assistant-picker__item"
              onClick={() => void handleCreate(assistant.id)}
              disabled={submittingId !== null}
            >
              <div className="pt-assistant-picker__icon">
                <Sparkles size={16} />
              </div>
              <div className="pt-assistant-picker__copy">
                <div className="pt-settings-row__title-line">
                  <p className="pt-settings-row__title">{assistant.name}</p>
                  {assistant.is_preset ? <span className="pt-badge">{t("预设", "Preset")}</span> : null}
                </div>
                <p className="pt-settings-row__detail">
                  {assistant.description || t("这个助手没有描述。", "This assistant has no description.")}
                </p>
              </div>
              <span className="pt-status-pill">
                {submittingId === assistant.id ? t("创建中...", "Creating...") : t("使用", "Use")}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
