import { Minus, Plus } from "lucide-react";
import {
  DEFAULT_SYSTEM_TEXT_SCALE,
  formatZoomLabel,
  MAX_ZOOM_FACTOR,
  MIN_ZOOM_FACTOR,
  stepZoomFactor,
  type AppearanceMode,
} from "../../lib/appearance";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../stores/appStore";
import { buttonStyles, SelectSettingRow } from "./formControls";
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
  const resolvedTheme = useAppStore((state) => state.resolvedTheme);
  const setAppearanceMode = useAppStore((state) => state.setAppearanceMode);
  const zoomFactor = useAppStore((state) => state.zoomFactor);
  const setZoomFactor = useAppStore((state) => state.setZoomFactor);
  const systemTextScale = useAppStore((state) => state.systemTextScale);
  const valueLabel = appearanceLabel(appearanceMode, locale);
  const resolvedThemeLabel = appearanceLabel(resolvedTheme, locale);
  const detail =
    appearanceMode === "system"
      ? t(
          `当前为 ${resolvedThemeLabel}，会跟随系统外观切换。`,
          `Currently ${resolvedThemeLabel} and following the system appearance.`,
        )
      : t(
          `当前固定为 ${resolvedThemeLabel}。`,
          `Currently pinned to ${resolvedThemeLabel}.`,
        );
  const options = APPEARANCE_OPTIONS.map((option) => ({
    value: option.value,
    label: locale === "zh-CN" ? option.labelZh : option.labelEn,
  }));

  const currentZoomLabel = formatZoomLabel(zoomFactor);
  const canZoomOut = zoomFactor > MIN_ZOOM_FACTOR;
  const canZoomIn = zoomFactor < MAX_ZOOM_FACTOR;
  const hasSystemTextScale =
    Math.abs(systemTextScale - DEFAULT_SYSTEM_TEXT_SCALE) > 0.01;
  const effectiveLabel = formatZoomLabel(zoomFactor * systemTextScale);
  const systemPercentLabel = `${Math.round(systemTextScale * 100)}%`;
  const zoomDetailBase = t(
    "支持窗口缩放快捷键，也可以在这里直接调回 100%。",
    "Use the standard zoom shortcuts or reset directly to 100% here.",
  );
  const zoomDetail = hasSystemTextScale
    ? `${zoomDetailBase} ${t(
        `已跟随系统字体大小（${systemPercentLabel}），实际界面比例约 ${effectiveLabel}。`,
        `Following system text size (${systemPercentLabel}); effective scale ≈ ${effectiveLabel}.`,
      )}`
    : zoomDetailBase;

  return (
    <SettingsSection
      title={t("外观", "Appearance")}
      footer={t(
        "支持跟随系统外观，并且可以用 Command/Ctrl +、-、0 调整界面缩放。",
        "Supports system appearance and Command/Ctrl +, -, 0 for interface zoom.",
      )}
    >
      <SelectSettingRow
        title={t("界面外观", "Interface Appearance")}
        detail={detail}
        label={t("选择界面外观", "Choose interface appearance")}
        value={appearanceMode}
        valueLabel={valueLabel}
        options={options}
        onChange={(value) => {
          void setAppearanceMode(value).catch((error) => {
            console.warn("Failed to update appearance mode:", error);
          });
        }}
      />

      <div className="pt-settings-row">
        <div className="pt-settings-row__copy">
          <p className="pt-settings-row__title">
            {t("界面缩放", "Interface Zoom")}
          </p>
          <p className="pt-settings-row__detail">{zoomDetail}</p>
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
