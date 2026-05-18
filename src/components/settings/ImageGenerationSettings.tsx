import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import {
  getProviderModelsForPurpose,
  getProvidersForPurpose,
} from "../../lib/providerModels";
import type { ImageGenConfig } from "../../lib/types";
import { useAppStore } from "../../stores/appStore";
import { buttonStyles, Field } from "./formControls";
import { SettingsSection } from "./SettingsPage";

const DEFAULT_CONFIG: ImageGenConfig = {
  enabled: false,
  provider_id: "",
  model: "",
  default_aspect_ratio: "1:1",
  default_quality: "standard",
  default_background: "auto",
  max_images_per_request: 4,
};

function pickFirstAvailable(available: string[], current: string): string {
  return available.includes(current) ? current : available[0] ?? current;
}

export function ImageRoutingSettingsSection() {
  const { t } = useI18n();
  const providers = useAppStore((state) => state.providers);
  const providerModelRegistry = useAppStore(
    (state) => state.providerModelRegistry,
  );
  const savedConfig = useAppStore((state) => state.imageGenConfig);
  const loadImageGenConfig = useAppStore((state) => state.loadImageGenConfig);
  const setImageGenConfig = useAppStore((state) => state.setImageGenConfig);
  const [expanded, setExpanded] = useState(false);
  const [draftConfig, setDraftConfig] = useState<ImageGenConfig>(DEFAULT_CONFIG);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadImageGenConfig();
  }, [loadImageGenConfig]);

  useEffect(() => {
    setDraftConfig(savedConfig);
  }, [savedConfig]);

  const imageProviders = useMemo(
    () => getProvidersForPurpose(providers, providerModelRegistry, "image"),
    [providerModelRegistry, providers],
  );
  const currentProvider = useMemo(
    () => providers.find((provider) => provider.id === savedConfig.provider_id) ?? null,
    [providers, savedConfig.provider_id],
  );
  const availableCurrentModels = useMemo(
    () =>
      currentProvider
        ? getProviderModelsForPurpose(currentProvider, providerModelRegistry, "image")
        : [],
    [currentProvider, providerModelRegistry],
  );
  const draftProvider = useMemo(
    () => providers.find((provider) => provider.id === draftConfig.provider_id) ?? null,
    [draftConfig.provider_id, providers],
  );
  const availableDraftModels = useMemo(
    () =>
      draftProvider
        ? getProviderModelsForPurpose(draftProvider, providerModelRegistry, "image")
        : [],
    [draftProvider, providerModelRegistry],
  );
  const resolvedDraftModel =
    availableDraftModels.length > 0
      ? pickFirstAvailable(availableDraftModels, draftConfig.model)
      : draftConfig.model;
  const summaryModel =
    availableCurrentModels.length > 0
      ? pickFirstAvailable(availableCurrentModels, savedConfig.model)
      : "";
  const canSave =
    !draftConfig.enabled ||
    (draftConfig.provider_id.trim().length > 0 && availableDraftModels.length > 0);
  const missingDraftHint = !draftProvider
    ? t(
        "先选择一个已标记“图片”用途的服务商。",
        "Choose a provider that already has an image-tagged model.",
      )
    : t(
        "当前服务商还没有标记为“图片”用途的模型。去上面的模型服务商表单里补上用途。",
        "This provider does not have an image-tagged model yet. Add that purpose in the provider form above.",
      );

  function summaryDetail(): string {
    if (!savedConfig.enabled) {
      return t("当前关闭", "Disabled");
    }
    if (!currentProvider) {
      return t("未选择图片服务商", "No image provider selected");
    }
    if (availableCurrentModels.length === 0) {
      return t(
        `${currentProvider.name} · 未标记图片模型`,
        `${currentProvider.name} · No image model tagged`,
      );
    }
    return `${currentProvider.name} · ${summaryModel}`;
  }

  function restoreSaved(): void {
    setDraftConfig(savedConfig);
    setError(null);
  }

  async function handleSave(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    if (draftConfig.enabled) {
      if (!draftConfig.provider_id) {
        setError(t("请选择图片生成服务商。", "Choose an image generation provider."));
        return;
      }
      if (availableDraftModels.length === 0) {
        setError(
          t(
            "当前服务商还没有标记为“图片”用途的模型。去“模型与能力”里的服务商表单补上用途。",
            "This provider does not have an image-tagged model yet. Add that purpose in the provider form inside Models & Capabilities.",
          ),
        );
        return;
      }
      if (!resolvedDraftModel.trim()) {
        setError(t("请输入图片生成模型。", "Enter an image generation model."));
        return;
      }
    }

    await setImageGenConfig({
      ...savedConfig,
      enabled: draftConfig.enabled,
      provider_id: draftConfig.provider_id,
      model: resolvedDraftModel.trim(),
    });
    setError(null);
    setExpanded(false);
  }

  return (
    <SettingsSection
      title={t("图片路由", "Image Routing")}
      footer={t(
        "这里只控制是否启用图片能力，以及它使用哪个服务商和模型。",
        "This only controls whether image capability is enabled and which provider/model it uses.",
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
            <p className="pt-settings-row__title">{t("生图服务商与模型", "Image Provider & Model")}</p>
            <ChevronDown size={16} className={`pt-row-chevron${expanded ? " is-open" : ""}`} />
          </div>
          <p className="pt-settings-row__detail">{summaryDetail()}</p>
        </div>
      </button>

      {expanded ? (
        <form className="pt-settings-expand pt-settings-form" onSubmit={handleSave}>
          <Field label={t("启用图片生成", "Enable Image Generation")}>
            <select
              className="pt-select"
              value={draftConfig.enabled ? "enabled" : "disabled"}
              onChange={(event) =>
                setDraftConfig((current) => ({
                  ...current,
                  enabled: event.target.value === "enabled",
                }))
              }
            >
              <option value="enabled">{t("启用", "Enabled")}</option>
              <option value="disabled">{t("关闭", "Disabled")}</option>
            </select>
          </Field>

          <Field label={t("图片服务商", "Image Provider")}>
            <select
              className="pt-select"
              value={draftConfig.provider_id}
              onChange={(event) => {
                const nextProviderId = event.target.value;
                const nextProvider =
                  providers.find((provider) => provider.id === nextProviderId) ?? null;
                const nextModels = nextProvider
                  ? getProviderModelsForPurpose(nextProvider, providerModelRegistry, "image")
                  : [];
                setDraftConfig((current) => ({
                  ...current,
                  provider_id: nextProviderId,
                  model:
                    nextModels.length === 0
                      ? current.model
                      : pickFirstAvailable(nextModels, current.model),
                }));
              }}
            >
              <option value="">{t("选择服务商", "Select a provider")}</option>
              {imageProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("图片模型", "Image Model")}>
            {availableDraftModels.length > 0 ? (
              <select
                className="pt-select"
                value={resolvedDraftModel}
                onChange={(event) =>
                  setDraftConfig((current) => ({
                    ...current,
                    model: event.target.value,
                  }))
                }
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

          {error ? <p className="pt-form-error">{error}</p> : null}

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

export function ImageGenerationSettingsSection() {
  const { t } = useI18n();
  const savedConfig = useAppStore((state) => state.imageGenConfig);
  const setImageGenConfig = useAppStore((state) => state.setImageGenConfig);
  const [expanded, setExpanded] = useState(false);
  const [draftConfig, setDraftConfig] = useState<ImageGenConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    setDraftConfig(savedConfig);
  }, [savedConfig]);

  async function handleSave(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await setImageGenConfig({
      ...savedConfig,
      default_aspect_ratio: draftConfig.default_aspect_ratio,
      default_quality: draftConfig.default_quality,
      default_background: draftConfig.default_background,
      max_images_per_request: draftConfig.max_images_per_request,
    });
    setExpanded(false);
  }

  return (
    <SettingsSection
      title={t("图片偏好", "Image Preferences")}
      footer={t(
        "这里仅保存生图默认参数；服务商和模型在“模型与能力”里配置。",
        "This only stores default image parameters. Provider and model are configured in Models & Capabilities.",
      )}
    >
      <button
        type="button"
        className="pt-settings-row pt-settings-row--interactive"
        onClick={() => {
          setExpanded((value) => {
            if (value) {
              setDraftConfig(savedConfig);
            }
            return !value;
          });
        }}
      >
        <div className="pt-settings-row__copy">
          <div className="pt-settings-row__title-line">
            <p className="pt-settings-row__title">{t("默认参数", "Defaults")}</p>
            <ChevronDown size={16} className={`pt-row-chevron${expanded ? " is-open" : ""}`} />
          </div>
          <p className="pt-settings-row__detail">
            {`${draftConfig.default_aspect_ratio} · ${draftConfig.default_quality} · ${t(
              `${draftConfig.max_images_per_request} 张`,
              `${draftConfig.max_images_per_request} images`,
            )}`}
          </p>
        </div>
      </button>

      {expanded ? (
        <form className="pt-settings-expand pt-settings-form" onSubmit={handleSave}>
          <div className="pt-settings-form__split">
            <Field label={t("默认比例", "Default Ratio")}>
              <select
                className="pt-select"
                value={draftConfig.default_aspect_ratio}
                onChange={(event) =>
                  setDraftConfig((current) => ({
                    ...current,
                    default_aspect_ratio: event.target.value,
                  }))
                }
              >
                {["1:1", "16:9", "9:16", "4:3", "3:4"].map((ratio) => (
                  <option key={ratio} value={ratio}>
                    {ratio}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("默认质量", "Default Quality")}>
              <select
                className="pt-select"
                value={draftConfig.default_quality}
                onChange={(event) =>
                  setDraftConfig((current) => ({
                    ...current,
                    default_quality: event.target.value,
                  }))
                }
              >
                <option value="standard">{t("标准", "Standard")}</option>
                <option value="hd">{t("高清", "HD")}</option>
              </select>
            </Field>
          </div>

          <div className="pt-settings-form__split">
            <Field label={t("默认背景", "Default Background")}>
              <select
                className="pt-select"
                value={draftConfig.default_background}
                onChange={(event) =>
                  setDraftConfig((current) => ({
                    ...current,
                    default_background: event.target.value,
                  }))
                }
              >
                <option value="auto">{t("自动", "Auto")}</option>
                <option value="transparent">{t("透明", "Transparent")}</option>
                <option value="opaque">{t("不透明", "Opaque")}</option>
              </select>
            </Field>

            <Field label={t("单次最多生成", "Max Images per Request")}>
              <select
                className="pt-select"
                value={String(draftConfig.max_images_per_request)}
                onChange={(event) =>
                  setDraftConfig((current) => ({
                    ...current,
                    max_images_per_request: Number(event.target.value),
                  }))
                }
              >
                {[1, 2, 3, 4].map((count) => (
                  <option key={count} value={count}>
                    {t(`${count} 张`, `${count} images`)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <p className="pt-settings-help">
            {t(
              "输入框切到 Image 后，直接描述画面即可；如果你更习惯命令式输入，也可以继续手动写 /img prompt --ratio 16:9 --quality hd。",
              "Once the composer is in Image mode, just describe the scene. If you prefer commands, you can still type /img prompt --ratio 16:9 --quality hd manually.",
            )}
          </p>

          <div className="pt-settings-form__actions">
            <button
              type="button"
              className={buttonStyles.secondary}
              onClick={() => {
                setDraftConfig(savedConfig);
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
