import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { getProviderModelsForPurpose, getProvidersForPurpose } from "../../lib/providerModels";
import { useAppStore } from "../../stores/appStore";
import { buttonStyles, Field } from "./formControls";
import { SettingsSection } from "./SettingsPage";

function pickFirstAvailable(available: string[], current: string): string {
  return available.includes(current) ? current : available[0] ?? current;
}

export function SpeechRoutingSettingsSection() {
  const { t } = useI18n();
  const providers = useAppStore((state) => state.providers);
  const providerModelRegistry = useAppStore((state) => state.providerModelRegistry);
  const selectedProviderId = useAppStore((state) => state.selectedProviderId);
  const sttProviderId = useAppStore((state) => state.sttProviderId);
  const sttModel = useAppStore((state) => state.sttModel);
  const setSttProviderId = useAppStore((state) => state.setSttProviderId);
  const setSttModel = useAppStore((state) => state.setSttModel);
  const [expanded, setExpanded] = useState(false);
  const [draftProviderId, setDraftProviderId] = useState(sttProviderId ?? "");
  const [draftModel, setDraftModel] = useState(sttModel);

  const sttProviders = useMemo(
    () => getProvidersForPurpose(providers, providerModelRegistry, "stt"),
    [providerModelRegistry, providers],
  );

  const effectiveProviderId = sttProviderId ?? selectedProviderId;
  const effectiveProvider = useMemo(
    () => providers.find((provider) => provider.id === effectiveProviderId) ?? null,
    [effectiveProviderId, providers],
  );
  const availableEffectiveModels = useMemo(
    () =>
      effectiveProvider
        ? getProviderModelsForPurpose(effectiveProvider, providerModelRegistry, "stt")
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
        ? getProviderModelsForPurpose(draftEffectiveProvider, providerModelRegistry, "stt")
        : [],
    [draftEffectiveProvider, providerModelRegistry],
  );
  const resolvedDraftModel =
    availableDraftModels.length > 0
      ? pickFirstAvailable(availableDraftModels, draftModel)
      : draftModel;
  const summaryModel =
    availableEffectiveModels.length > 0
      ? pickFirstAvailable(availableEffectiveModels, sttModel)
      : "";
  const canSave = availableDraftModels.length > 0;
  const missingDraftHint = !draftEffectiveProvider
    ? t(
        "先配置文本路由，或者直接选择一个已标记“转写”用途的服务商。",
        "Configure text routing first, or choose a provider that already has a transcription-tagged model.",
      )
    : t(
        "当前服务商还没有标记为“转写”用途的模型。去上面的模型服务商表单里补上用途。",
        "This provider does not have a transcription-tagged model yet. Add that purpose in the provider form above.",
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
    await setSttModel(resolvedDraftModel);
    setExpanded(false);
  }

  function summaryDetail(): string {
    if (!effectiveProvider) {
      return t("跟随当前聊天服务商", "Follow current chat provider");
    }
    if (availableEffectiveModels.length === 0) {
      return t(
        `${effectiveProvider.name} · 未标记转写模型`,
        `${effectiveProvider.name} · No transcription model tagged`,
      );
    }
    return `${effectiveProvider.name} · ${summaryModel}`;
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
          <p className="pt-settings-row__detail">{summaryDetail()}</p>
        </div>
      </button>

      {expanded ? (
        <form className="pt-settings-expand pt-settings-form" onSubmit={handleSave}>
          <Field label={t("转写服务商", "Transcription Provider")}>
            <select
              className="pt-select"
              value={draftProviderId}
              onChange={(event) => {
                const nextProviderId = event.target.value;
                const nextProvider =
                  providers.find((provider) => provider.id === (nextProviderId || selectedProviderId)) ??
                  null;
                const nextModels = nextProvider
                  ? getProviderModelsForPurpose(nextProvider, providerModelRegistry, "stt")
                  : [];
                setDraftProviderId(nextProviderId);
                if (nextModels.length > 0) {
                  setDraftModel((current) =>
                    nextModels.includes(current) ? current : nextModels[0] ?? current,
                  );
                }
              }}
            >
              <option value="">
                {t("跟随当前聊天服务商", "Follow current chat provider")}
              </option>
              {sttProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("转写模型", "Transcription Model")}>
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
