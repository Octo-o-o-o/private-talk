import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../stores/appStore";
import { buttonStyles, Field } from "./formControls";
import { SettingsSection } from "./SettingsPage";

export function VoiceOutputSettingsSection() {
  const { t } = useI18n();
  const providers = useAppStore((state) => state.providers);
  const selectedProviderId = useAppStore((state) => state.selectedProviderId);
  const ttsProviderId = useAppStore((state) => state.ttsProviderId);
  const ttsModel = useAppStore((state) => state.ttsModel);
  const ttsVoice = useAppStore((state) => state.ttsVoice);
  const setTtsProviderId = useAppStore((state) => state.setTtsProviderId);
  const setTtsModel = useAppStore((state) => state.setTtsModel);
  const setTtsVoice = useAppStore((state) => state.setTtsVoice);
  const [expanded, setExpanded] = useState(false);
  const [draftProviderId, setDraftProviderId] = useState(ttsProviderId ?? "");
  const [draftModel, setDraftModel] = useState(ttsModel);
  const [draftVoice, setDraftVoice] = useState(ttsVoice);

  const effectiveProviderId = ttsProviderId ?? selectedProviderId;
  const effectiveProvider = useMemo(
    () => providers.find((provider) => provider.id === effectiveProviderId) ?? null,
    [effectiveProviderId, providers],
  );

  useEffect(() => {
    setDraftProviderId(ttsProviderId ?? "");
    setDraftModel(ttsModel);
    setDraftVoice(ttsVoice);
  }, [ttsModel, ttsProviderId, ttsVoice]);

  function restoreSaved(): void {
    setDraftProviderId(ttsProviderId ?? "");
    setDraftModel(ttsModel);
    setDraftVoice(ttsVoice);
  }

  async function handleSave(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await Promise.all([
      setTtsProviderId(draftProviderId || null),
      setTtsModel(draftModel),
      setTtsVoice(draftVoice),
    ]);
    setExpanded(false);
  }

  return (
    <SettingsSection
      title={t("语音输出", "Voice Output")}
      footer={t(
        "助手消息上的朗读按钮会使用这里的语音路由。",
        "The playback button on assistant messages uses this voice route.",
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
            <p className="pt-settings-row__title">{t("助手朗读", "Assistant Playback")}</p>
            <ChevronDown size={16} className={`pt-row-chevron${expanded ? " is-open" : ""}`} />
          </div>
          <p className="pt-settings-row__detail">
            {effectiveProvider
              ? `${effectiveProvider.name} · ${ttsModel} · ${ttsVoice}`
              : t("跟随当前聊天服务商", "Follow current chat provider")}
          </p>
        </div>
      </button>

      {expanded ? (
        <form className="pt-settings-expand pt-settings-form" onSubmit={handleSave}>
          <Field label={t("语音服务商", "Voice Provider")}>
            <select
              className="pt-select"
              value={draftProviderId}
              onChange={(event) => setDraftProviderId(event.target.value)}
            >
              <option value="">{t("跟随当前聊天服务商", "Follow current chat provider")}</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("语音模型", "Voice Model")}>
            <input
              className="pt-input"
              value={draftModel}
              onChange={(event) => setDraftModel(event.target.value)}
              placeholder="tts-1"
            />
          </Field>

          <Field label={t("声音", "Voice")}>
            <input
              className="pt-input"
              value={draftVoice}
              onChange={(event) => setDraftVoice(event.target.value)}
              placeholder="alloy"
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
