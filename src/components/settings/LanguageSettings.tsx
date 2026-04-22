import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../lib/i18n";
import type { UiLanguage } from "../../lib/uiLanguage";
import { useAppStore } from "../../stores/appStore";
import { buttonStyles, Field } from "./formControls";
import { SettingsSection } from "./SettingsPage";

const LANGUAGE_OPTIONS: Array<{ value: UiLanguage; labelZh: string; labelEn: string }> = [
  { value: "auto", labelZh: "跟随系统", labelEn: "Follow System" },
  { value: "zh-CN", labelZh: "简体中文", labelEn: "Simplified Chinese" },
  { value: "en", labelZh: "English", labelEn: "English" },
];

function languageLabel(value: UiLanguage, locale: "zh-CN" | "en"): string {
  const option = LANGUAGE_OPTIONS.find((item) => item.value === value);
  if (!option) {
    return locale === "zh-CN" ? "跟随系统" : "Follow System";
  }
  return locale === "zh-CN" ? option.labelZh : option.labelEn;
}

export function LanguageSettingsSection() {
  const { t, locale } = useI18n();
  const uiLanguage = useAppStore((state) => state.uiLanguage);
  const setUiLanguage = useAppStore((state) => state.setUiLanguage);
  const [expanded, setExpanded] = useState(false);
  const [draftLanguage, setDraftLanguage] = useState<UiLanguage>(uiLanguage);

  function restoreSaved(): void {
    setDraftLanguage(uiLanguage);
  }

  async function handleSave(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await setUiLanguage(draftLanguage);
    setExpanded(false);
  }

  return (
    <SettingsSection
      title={t("语言", "Language")}
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
              {t("界面语言", "Interface Language")}
            </p>
            <ChevronDown
              size={16}
              className={`pt-row-chevron${expanded ? " is-open" : ""}`}
            />
          </div>
          <p className="pt-settings-row__detail">
            {languageLabel(uiLanguage, locale)}
          </p>
        </div>
      </button>

      {expanded ? (
        <form className="pt-settings-expand pt-settings-form" onSubmit={handleSave}>
          <Field label={t("语言", "Language")}>
            <select
              className="pt-select"
              value={draftLanguage}
              onChange={(event) => setDraftLanguage(event.target.value as UiLanguage)}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {locale === "zh-CN" ? option.labelZh : option.labelEn}
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
