import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../stores/appStore";
import { buttonStyles, Field } from "./formControls";
import { SettingsSection } from "./SettingsPage";

function currentSummary(providerName: string | null, model: string | null): string {
  if (!providerName) {
    return "Add a provider to choose a default text model.";
  }

  if (!model) {
    return `${providerName} · No model available`;
  }

  return `${providerName} · ${model}`;
}

export function ModelRoutingSettingsSection() {
  const { t } = useI18n();
  const providers = useAppStore((state) => state.providers);
  const selectedProviderId = useAppStore((state) => state.selectedProviderId);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const setSelectedProvider = useAppStore((state) => state.setSelectedProvider);
  const setSelectedModel = useAppStore((state) => state.setSelectedModel);
  const [expanded, setExpanded] = useState(false);
  const [draftProviderId, setDraftProviderId] = useState("");
  const [draftModel, setDraftModel] = useState("");

  const currentProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId),
    [providers, selectedProviderId],
  );

  const draftProvider = useMemo(
    () => providers.find((provider) => provider.id === draftProviderId) ?? null,
    [draftProviderId, providers],
  );

  useEffect(() => {
    setDraftProviderId(selectedProviderId ?? "");
    setDraftModel(selectedModel ?? "");
  }, [selectedModel, selectedProviderId]);

  function restoreSaved(): void {
    setDraftProviderId(selectedProviderId ?? "");
    setDraftModel(selectedModel ?? "");
  }

  function handleProviderChange(nextProviderId: string): void {
    const nextProvider =
      providers.find((provider) => provider.id === nextProviderId) ?? null;
    setDraftProviderId(nextProviderId);
    setDraftModel(nextProvider?.models[0] ?? "");
  }

  function handleSave(event: React.FormEvent): void {
    event.preventDefault();

    if (!draftProvider) {
      return;
    }

    setSelectedProvider(draftProvider.id);
    if (draftModel) {
      setSelectedModel(draftModel);
    }
    setExpanded(false);
  }

  return (
    <SettingsSection title={t("模型路由", "Model Routing")}>
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
            <p className="pt-settings-row__title">{t("文本模型", "Text Model")}</p>
            <ChevronDown
              size={16}
              className={`pt-row-chevron${expanded ? " is-open" : ""}`}
            />
          </div>
          <p className="pt-settings-row__detail">
            {currentSummary(currentProvider?.name ?? null, selectedModel)}
          </p>
        </div>
      </button>

      {expanded ? (
        providers.length > 0 ? (
          <form className="pt-settings-expand pt-settings-form" onSubmit={handleSave}>
            <Field label={t("默认服务商", "Default Provider")}>
              <select
                className="pt-select"
                value={draftProviderId}
                onChange={(event) => handleProviderChange(event.target.value)}
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("默认模型", "Default Model")}>
              <select
                className="pt-select"
                value={draftModel}
                onChange={(event) => setDraftModel(event.target.value)}
              >
                {(draftProvider?.models ?? []).map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </Field>

            <p className="pt-settings-help">
              {t(
                "这里会成为新请求的默认文本路由。你仍然可以在聊天头部随时切换服务商和模型。",
                "This becomes the default text route for new requests. You can still switch provider or model from the chat header at any time.",
              )}
            </p>

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
        ) : (
          <div className="pt-settings-expand">
            <p className="pt-settings-help">
              {t(
                "先添加一个服务商，然后你就可以设置新聊天默认使用的文本模型。",
                "Add a provider first. Then you can choose the default text model used when a new chat starts.",
              )}
            </p>
          </div>
        )
      ) : null}
    </SettingsSection>
  );
}
