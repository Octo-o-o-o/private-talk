import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import {
  getProviderModelsForPurpose,
  getProvidersForPurpose,
} from "../../lib/providerModels";
import { useAppStore } from "../../stores/appStore";
import { buttonStyles, Field } from "./formControls";
import { SettingsSection } from "./SettingsPage";

export function VoiceRoutingSettingsSection() {
  const { t } = useI18n();
  const providers = useAppStore((state) => state.providers);
  const providerModelRegistry = useAppStore(
    (state) => state.providerModelRegistry,
  );
  const selectedProviderId = useAppStore((state) => state.selectedProviderId);
  const ttsProviderId = useAppStore((state) => state.ttsProviderId);
  const ttsModel = useAppStore((state) => state.ttsModel);
  const setTtsProviderId = useAppStore((state) => state.setTtsProviderId);
  const setTtsModel = useAppStore((state) => state.setTtsModel);
  const [expanded, setExpanded] = useState(false);
  const [draftProviderId, setDraftProviderId] = useState(ttsProviderId ?? "");
  const [draftModel, setDraftModel] = useState(ttsModel);

  const ttsProviders = useMemo(
    () => getProvidersForPurpose(providers, providerModelRegistry, "tts"),
    [providerModelRegistry, providers],
  );
  const effectiveProviderId = ttsProviderId ?? selectedProviderId;
  const effectiveProvider = useMemo(
    () => providers.find((provider) => provider.id === effectiveProviderId) ?? null,
    [effectiveProviderId, providers],
  );
  const availableEffectiveModels = useMemo(
    () =>
      effectiveProvider
        ? getProviderModelsForPurpose(effectiveProvider, providerModelRegistry, "tts")
        : [],
    [effectiveProvider, providerModelRegistry],
  );
  const draftEffectiveProviderId = draftProviderId || selectedProviderId || "";
  const draftEffectiveProvider = useMemo(
    () =>
      providers.find((provider) => provider.id === draftEffectiveProviderId) ?? null,
    [draftEffectiveProviderId, providers],
  );
  const availableDraftModels = useMemo(
    () =>
      draftEffectiveProvider
        ? getProviderModelsForPurpose(draftEffectiveProvider, providerModelRegistry, "tts")
        : [],
    [draftEffectiveProvider, providerModelRegistry],
  );
  const resolvedDraftModel =
    availableDraftModels.length > 0
      ? availableDraftModels.includes(draftModel)
        ? draftModel
        : availableDraftModels[0] ?? ""
      : draftModel;
  const summaryModel =
    availableEffectiveModels.length > 0
      ? availableEffectiveModels.includes(ttsModel)
        ? ttsModel
        : availableEffectiveModels[0] ?? ttsModel
      : "";
  const canSave = availableDraftModels.length > 0;
  const missingDraftHint = !draftEffectiveProvider
    ? t(
        "先配置文本路由，或者直接选择一个已标记“语音”用途的服务商。",
        "Configure text routing first, or choose a provider that already has a voice-tagged model.",
      )
    : t(
        "当前服务商还没有标记为“语音”用途的模型。去上面的模型服务商表单里补上用途。",
        "This provider does not have a voice-tagged model yet. Add that purpose in the provider form above.",
      );

  useEffect(() => {
    setDraftProviderId(ttsProviderId ?? "");
    setDraftModel(ttsModel);
  }, [ttsModel, ttsProviderId]);

  function restoreSaved(): void {
    setDraftProviderId(ttsProviderId ?? "");
    setDraftModel(ttsModel);
  }

  async function handleSave(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await Promise.all([
      setTtsProviderId(draftProviderId || null),
      setTtsModel(resolvedDraftModel),
    ]);
    setExpanded(false);
  }

  return (
    <SettingsSection
      title={t("语音路由", "Voice Routing")}
      footer={t(
        "朗读按钮会使用这里选择的语音服务商和模型。",
        "Playback uses the provider and model selected here.",
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
            <p className="pt-settings-row__title">{t("语音服务商与模型", "Voice Provider & Model")}</p>
            <ChevronDown size={16} className={`pt-row-chevron${expanded ? " is-open" : ""}`} />
          </div>
          <p className="pt-settings-row__detail">
            {effectiveProvider
              ? availableEffectiveModels.length > 0
                ? `${effectiveProvider.name} · ${summaryModel}`
                : t(
                    `${effectiveProvider.name} · 未标记语音模型`,
                    `${effectiveProvider.name} · No voice model tagged`,
                  )
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
              onChange={(event) => {
                const nextProviderId = event.target.value;
                const nextProvider =
                  providers.find(
                    (provider) => provider.id === (nextProviderId || selectedProviderId),
                  ) ?? null;
                const nextModels = nextProvider
                  ? getProviderModelsForPurpose(nextProvider, providerModelRegistry, "tts")
                  : [];
                setDraftProviderId(nextProviderId);
                if (nextModels.length > 0) {
                  setDraftModel((current) =>
                    nextModels.includes(current) ? current : nextModels[0] ?? current,
                  );
                }
              }}
            >
              <option value="">{t("跟随当前聊天服务商", "Follow current chat provider")}</option>
              {ttsProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("语音模型", "Voice Model")}>
            {availableDraftModels.length > 0 ? (
              <select
                className="pt-select"
                value={resolvedDraftModel}
                onChange={(event) => setDraftModel(event.target.value)}
              >
                {availableDraftModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : (
              <p className="pt-settings-help">{missingDraftHint}</p>
            )}
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
            <button type="submit" className={buttonStyles.primary} disabled={!canSave}>
              {t("保存更改", "Save Changes")}
            </button>
          </div>
        </form>
      ) : null}
    </SettingsSection>
  );
}

export function VoiceOutputSettingsSection() {
  const { t } = useI18n();
  const ttsVoice = useAppStore((state) => state.ttsVoice);
  const setTtsVoice = useAppStore((state) => state.setTtsVoice);
  const [expanded, setExpanded] = useState(false);
  const [draftVoice, setDraftVoice] = useState(ttsVoice);

  useEffect(() => {
    setDraftVoice(ttsVoice);
  }, [ttsVoice]);

  async function handleSave(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await setTtsVoice(draftVoice);
    setExpanded(false);
  }

  return (
    <SettingsSection
      title={t("语音偏好", "Voice Preferences")}
      footer={t(
        "这里仅保存朗读时的声音参数；服务商和模型在“模型与能力”里配置。",
        "This only stores playback voice preferences. Provider and model are configured in Models & Capabilities.",
      )}
    >
      <button
        type="button"
        className="pt-settings-row pt-settings-row--interactive"
        onClick={() => {
          setExpanded((value) => {
            if (value) {
              setDraftVoice(ttsVoice);
            }
            return !value;
          });
        }}
      >
        <div className="pt-settings-row__copy">
          <div className="pt-settings-row__title-line">
            <p className="pt-settings-row__title">{t("声音", "Voice")}</p>
            <ChevronDown size={16} className={`pt-row-chevron${expanded ? " is-open" : ""}`} />
          </div>
          <p className="pt-settings-row__detail">{draftVoice || t("未设置", "Not set")}</p>
        </div>
      </button>

      {expanded ? (
        <form className="pt-settings-expand pt-settings-form" onSubmit={handleSave}>
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
                setDraftVoice(ttsVoice);
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
