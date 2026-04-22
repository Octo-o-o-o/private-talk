import { ChevronDown, Minus, Plus } from "lucide-react";
import { useState } from "react";
import {
  formatZoomLabel,
  MAX_ZOOM_FACTOR,
  MIN_ZOOM_FACTOR,
  stepZoomFactor,
  type AppearanceMode,
} from "../../lib/appearance";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../stores/appStore";
import { buttonStyles, Field } from "./formControls";
import { SettingsSection } from "./SettingsPage";

const APPEARANCE_OPTIONS: Array<{
  value: AppearanceMode;
  labelZh: string;
  labelEn: string;
}> = [
  { value: "system", labelZh: "跟随系统", labelEn: "Follow System" },
  { value: "dark", labelZh: "深色", labelEn: "Dark" },
  { value: "light", labelZh: "浅色", labelEn: "Light" },
];

function appearanceLabel(
  mode: AppearanceMode,
  locale: "zh-CN" | "en",
): string {
  const option = APPEARANCE_OPTIONS.find((item) => item.value === mode);
  if (!option) {
    return locale === "zh-CN" ? "深色" : "Dark";
  }

  return locale === "zh-CN" ? option.labelZh : option.labelEn;
}

export function AppearanceSettingsSection() {
  const { t, locale } = useI18n();
  const appearanceMode = useAppStore((state) => state.appearanceMode);
  const setAppearanceMode = useAppStore((state) => state.setAppearanceMode);
  const zoomFactor = useAppStore((state) => state.zoomFactor);
  const setZoomFactor = useAppStore((state) => state.setZoomFactor);
  const [expanded, setExpanded] = useState(false);
  const [draftMode, setDraftMode] = useState<AppearanceMode>(appearanceMode);

  function restoreSaved(): void {
    setDraftMode(appearanceMode);
  }

  async function handleSave(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await setAppearanceMode(draftMode);
    setExpanded(false);
  }

  const currentZoomLabel = formatZoomLabel(zoomFactor);
  const canZoomOut = zoomFactor > MIN_ZOOM_FACTOR;
  const canZoomIn = zoomFactor < MAX_ZOOM_FACTOR;

  return (
    <SettingsSection
      title={t("外观", "Appearance")}
      footer={t(
        "支持跟随系统外观，并且可以用 Command/Ctrl +、-、0 调整界面缩放。",
        "Supports system appearance and Command/Ctrl +, -, 0 for interface zoom.",
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
              {t("界面外观", "Interface Appearance")}
            </p>
            <ChevronDown
              size={16}
              className={`pt-row-chevron${expanded ? " is-open" : ""}`}
            />
          </div>
          <p className="pt-settings-row__detail">
            {appearanceLabel(appearanceMode, locale)}
          </p>
        </div>
      </button>

      {expanded ? (
        <form className="pt-settings-expand pt-settings-form" onSubmit={handleSave}>
          <Field label={t("外观模式", "Appearance Mode")}>
            <select
              className="pt-select"
              value={draftMode}
              onChange={(event) =>
                setDraftMode(event.target.value as AppearanceMode)
              }
            >
              {APPEARANCE_OPTIONS.map((option) => (
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

      <div className="pt-settings-row">
        <div className="pt-settings-row__copy">
          <p className="pt-settings-row__title">
            {t("界面缩放", "Interface Zoom")}
          </p>
          <p className="pt-settings-row__detail">
            {t(
              "支持窗口缩放快捷键，也可以在这里直接调回 100%。",
              "Use the standard zoom shortcuts or reset directly to 100% here.",
            )}
          </p>
        </div>

        <div className="pt-settings-row__actions">
          <button
            type="button"
            className={buttonStyles.compactChip}
            onClick={() => void setZoomFactor(stepZoomFactor(zoomFactor, -1))}
            aria-label={t("缩小界面", "Zoom out")}
            disabled={!canZoomOut}
          >
            <Minus size={14} />
          </button>

          <button
            type="button"
            className={buttonStyles.compactChip}
            onClick={() => void setZoomFactor(1)}
            aria-label={t("重置缩放", "Reset zoom")}
          >
            {currentZoomLabel}
          </button>

          <button
            type="button"
            className={buttonStyles.compactChip}
            onClick={() => void setZoomFactor(stepZoomFactor(zoomFactor, 1))}
            aria-label={t("放大界面", "Zoom in")}
            disabled={!canZoomIn}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
    </SettingsSection>
  );
}
