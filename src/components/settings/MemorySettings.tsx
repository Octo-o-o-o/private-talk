import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../stores/appStore";
import { buttonStyles, Field } from "./formControls";
import { SettingsSection } from "./SettingsPage";

const MEMORY_OPTIONS = [10, 20, 30, 50, 100, 200];

export function MemorySettingsSection() {
  const { t } = useI18n();
  const contextMaxMessages = useAppStore((state) => state.contextMaxMessages);
  const setContextMaxMessages = useAppStore((state) => state.setContextMaxMessages);
  const [expanded, setExpanded] = useState(false);
  const [draftLimit, setDraftLimit] = useState(contextMaxMessages);

  function restoreSaved(): void {
    setDraftLimit(contextMaxMessages);
  }

  async function handleSave(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await setContextMaxMessages(draftLimit);
    setExpanded(false);
  }

  return (
    <SettingsSection
      title={t("记忆", "Memory")}
      footer={t(
        "每次请求只会带上最近的一段对话，控制上下文成本和稳定性。",
        "Each request only sends a recent window of messages to keep context predictable and efficient.",
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
        }}
      >
        <div className="pt-settings-row__copy">
          <div className="pt-settings-row__title-line">
            <p className="pt-settings-row__title">
              {t("上下文窗口", "Context Window")}
            </p>
            <ChevronDown
              size={16}
              className={`pt-row-chevron${expanded ? " is-open" : ""}`}
            />
          </div>
          <p className="pt-settings-row__detail">
            {t(
              `向模型发送最近 ${contextMaxMessages} 条消息`,
              `Send the latest ${contextMaxMessages} messages to the model`,
            )}
          </p>
        </div>
      </button>

      {expanded ? (
        <form className="pt-settings-expand pt-settings-form" onSubmit={handleSave}>
          <Field label={t("消息数量", "Messages")}>
            <select
              className="pt-select"
              value={String(draftLimit)}
              onChange={(event) => setDraftLimit(Number(event.target.value))}
            >
              {MEMORY_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {t(`${value} 条消息`, `${value} messages`)}
                </option>
              ))}
            </select>
          </Field>

          <div className="pt-settings-form__actions">
            <button
              type="button"
              className={buttonStyles.secondary}
              onClick={() => {
                restoreSaved();
                setExpanded(false);
              }}
            >
              {t("取消", "Cancel")}
            </button>
            <button type="submit" className={buttonStyles.primary}>
              {t("保存更改", "Save Changes")}
            </button>
          </div>
        </form>
      ) : null}
    </SettingsSection>
  );
}
