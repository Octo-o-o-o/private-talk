import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { getProviderModelsForPurpose, getProvidersForPurpose } from "../../lib/providerModels";
import { useAppStore } from "../../stores/appStore";
import { buttonStyles, Field } from "./formControls";
import { SettingsSection } from "./SettingsPage";

function currentSummary(
  providerName: string | null,
  model: string | null,
  emptyLabel: string,
  unavailableLabel: string,
): string {
  if (!providerName) {
    return emptyLabel;
  }

  if (!model) {
    return `${providerName} · ${unavailableLabel}`;
  }

  return `${providerName} · ${model}`;
}

export function ModelRoutingSettingsSection() {
  const { t } = useI18n();
  const providers = useAppStore((state) => state.providers);
  const providerModelRegistry = useAppStore((state) => state.providerModelRegistry);
  const selectedProviderId = useAppStore((state) => state.selectedProviderId);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const setSelectedProvider = useAppStore((state) => state.setSelectedProvider);
  const setSelectedModel = useAppStore((state) => state.setSelectedModel);
  const [expanded, setExpanded] = useState(false);
  const [draftProviderId, setDraftProviderId] = useState("");
  const [draftModel, setDraftModel] = useState("");

  const chatProviders = useMemo(
    () => getProvidersForPurpose(providers, providerModelRegistry, "chat"),
    [providerModelRegistry, providers],
  );

  const currentProvider = useMemo(
    () => chatProviders.find((provider) => provider.id === selectedProviderId),
    [chatProviders, selectedProviderId],
  );

  const draftProvider = useMemo(
    () => chatProviders.find((provider) => provider.id === draftProviderId) ?? null,
    [chatProviders, draftProviderId],
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
      chatProviders.find((provider) => provider.id === nextProviderId) ?? null;
    setDraftProviderId(nextProviderId);
    setDraftModel(
      nextProvider
        ? getProviderModelsForPurpose(nextProvider, providerModelRegistry, "chat")[0] ?? ""
        : "",
    );
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
    <SettingsSection title={t("文本路由", "Text Routing")}>
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
            {currentSummary(
              currentProvider?.name ?? null,
              selectedModel,
              t(
                "先添加服务商并标记文本模型。",
                "Add a provider and mark a text model first.",
              ),
              t("没有可用模型", "No model available"),
            )}
          </p>
        </div>
      </button>

      {expanded ? (
        chatProviders.length > 0 ? (
          <form className="pt-settings-expand pt-settings-form" onSubmit={handleSave}>
            <Field label={t("默认服务商", "Default Provider")}>
              <select
                className="pt-select"
                value={draftProviderId}
                onChange={(event) => handleProviderChange(event.target.value)}
              >
                {chatProviders.map((provider) => (
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
                {(draftProvider
                  ? getProviderModelsForPurpose(draftProvider, providerModelRegistry, "chat")
                  : []
                ).map((model) => (
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
              {providers.length === 0
                ? t(
                    "先添加一个服务商，再为至少一个模型标记“文本”用途。",
                    "Add a provider first, then tag at least one model with the text purpose.",
                  )
                : t(
                    "当前还没有可用的文本模型。去下面的服务商表单里，把一个模型标记成“文本”。",
                    "There is no text model available yet. Mark one model as text in the provider form below.",
                  )}
            </p>
          </div>
        )
      ) : null}
    </SettingsSection>
  );
}
