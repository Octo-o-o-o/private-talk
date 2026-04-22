import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../stores/appStore";
import { buttonStyles, Field } from "./formControls";
import { SettingsSection } from "./SettingsPage";

export function SpeechSettingsSection() {
  const { t } = useI18n();
  const providers = useAppStore((state) => state.providers);
  const selectedProviderId = useAppStore((state) => state.selectedProviderId);
  const sttProviderId = useAppStore((state) => state.sttProviderId);
  const sttModel = useAppStore((state) => state.sttModel);
  const setSttProviderId = useAppStore((state) => state.setSttProviderId);
  const setSttModel = useAppStore((state) => state.setSttModel);
  const [expanded, setExpanded] = useState(false);
  const [draftProviderId, setDraftProviderId] = useState(sttProviderId ?? "");
  const [draftModel, setDraftModel] = useState(sttModel);

  const effectiveProviderId = sttProviderId ?? selectedProviderId;
  const effectiveProvider = useMemo(
    () => providers.find((provider) => provider.id === effectiveProviderId) ?? null,
    [effectiveProviderId, providers],
  );

  useEffect(() => {
    setDraftProviderId(sttProviderId ?? "");
    setDraftModel(sttModel);
  }, [sttModel, sttProviderId]);

  function restoreSaved(): void {
    setDraftProviderId(sttProviderId ?? "");
    setDraftModel(sttModel);
  }

  async function handleSave(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await setSttProviderId(draftProviderId || null);
    await setSttModel(draftModel);
    setExpanded(false);
  }

  return (
    <SettingsSection
      title={t("语音转写", "Speech to Text")}
      footer={t(
        "聊天输入框里的麦克风会使用这里的转写路由。",
        "The mic button in chat uses this transcription route.",
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
            <p className="pt-settings-row__title">{t("录音转文字", "Voice Transcription")}</p>
            <ChevronDown
              size={16}
              className={`pt-row-chevron${expanded ? " is-open" : ""}`}
            />
          </div>
          <p className="pt-settings-row__detail">
            {effectiveProvider
              ? `${effectiveProvider.name} · ${sttModel}`
              : t("跟随当前聊天服务商", "Follow current chat provider")}
          </p>
        </div>
      </button>

      {expanded ? (
        <form className="pt-settings-expand pt-settings-form" onSubmit={handleSave}>
          <Field label={t("转写服务商", "Transcription Provider")}>
            <select
              className="pt-select"
              value={draftProviderId}
              onChange={(event) => setDraftProviderId(event.target.value)}
            >
              <option value="">
                {t("跟随当前聊天服务商", "Follow current chat provider")}
              </option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("转写模型", "Transcription Model")}>
            <input
              className="pt-input"
              value={draftModel}
              onChange={(event) => setDraftModel(event.target.value)}
              placeholder="whisper-1"
            />
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
