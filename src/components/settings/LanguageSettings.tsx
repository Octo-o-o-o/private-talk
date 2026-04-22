import { useI18n } from "../../lib/i18n";
import type { UiLanguage } from "../../lib/uiLanguage";
import { useAppStore } from "../../stores/appStore";
import { SelectSettingRow } from "./formControls";
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
  const resolvedLanguage = useAppStore((state) => state.resolvedLanguage);
  const setUiLanguage = useAppStore((state) => state.setUiLanguage);
  const valueLabel = languageLabel(uiLanguage, locale);
  const activeLanguageLabel = languageLabel(resolvedLanguage, locale);
  const detail =
    uiLanguage === "auto"
      ? t(
          `当前使用 ${activeLanguageLabel}，会跟随系统语言切换。`,
          `Currently using ${activeLanguageLabel} and following the system language.`,
        )
      : t(
          `当前固定为 ${valueLabel}。`,
          `Currently pinned to ${valueLabel}.`,
        );
  const options = LANGUAGE_OPTIONS.map((option) => ({
    value: option.value,
    label: locale === "zh-CN" ? option.labelZh : option.labelEn,
  }));

  return (
    <SettingsSection title={t("语言", "Language")}>
      <SelectSettingRow
        title={t("界面语言", "Interface Language")}
        detail={detail}
        label={t("选择界面语言", "Choose interface language")}
        value={uiLanguage}
        valueLabel={valueLabel}
        options={options}
        onChange={(value) => {
          void setUiLanguage(value).catch((error) => {
            console.warn("Failed to update UI language:", error);
          });
        }}
      />
    </SettingsSection>
  );
}
