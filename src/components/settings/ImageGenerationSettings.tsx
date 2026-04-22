import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { getProviderModelsForPurpose, getProvidersForPurpose } from "../../lib/providerModels";
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

export function ImageGenerationSettingsSection() {
  const { t } = useI18n();
  const providers = useAppStore((state) => state.providers);
  const providerModelRegistry = useAppStore((state) => state.providerModelRegistry);
  const savedConfig = useAppStore((state) => state.imageGenConfig);
  const loadImageGenConfig = useAppStore((state) => state.loadImageGenConfig);
  const setImageGenConfig = useAppStore((state) => state.setImageGenConfig);
  const [expanded, setExpanded] = useState(false);
  const [draftConfig, setDraftConfig] = useState<ImageGenConfig>(DEFAULT_CONFIG);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      await loadImageGenConfig();
    })();
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
      ? availableDraftModels.includes(draftConfig.model)
        ? draftConfig.model
        : availableDraftModels[0] ?? ""
      : draftConfig.model;

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
      if (!resolvedDraftModel.trim()) {
        setError(t("请输入图片生成模型。", "Enter an image generation model."));
        return;
      }
    }

    const nextConfig = {
      ...draftConfig,
      model: resolvedDraftModel.trim(),
    };
    await setImageGenConfig(nextConfig);
    setError(null);
    setExpanded(false);
  }

  return (
    <SettingsSection
      title={t("图片生成", "Image Generation")}
      footer={t(
        "聊天输入框里的 Sparkles 按钮会使用这里的图片路由和默认参数。",
        "The Sparkles button in chat uses this image route and its default parameters.",
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
            <p className="pt-settings-row__title">{t("生图路由", "Image Routing")}</p>
            <ChevronDown size={16} className={`pt-row-chevron${expanded ? " is-open" : ""}`} />
          </div>
          <p className="pt-settings-row__detail">
            {savedConfig.enabled
              ? currentProvider
                ? `${currentProvider.name} · ${savedConfig.model}`
                : savedConfig.model
              : t("当前关闭", "Disabled")}
          </p>
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
              onChange={(event) =>
                setDraftConfig((current) => ({
                  ...current,
                  provider_id: event.target.value,
                  model:
                    (() => {
                      const nextProvider =
                        providers.find((provider) => provider.id === event.target.value) ?? null;
                      const nextModels = nextProvider
                        ? getProviderModelsForPurpose(nextProvider, providerModelRegistry, "image")
                        : [];
                      if (nextModels.length === 0) {
                        return current.model;
                      }
                      return nextModels.includes(current.model)
                        ? current.model
                        : nextModels[0] ?? current.model;
                    })(),
                }))
              }
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
              <input
                className="pt-input"
                value={draftConfig.model}
                onChange={(event) =>
                  setDraftConfig((current) => ({
                    ...current,
                    model: event.target.value,
                  }))
                }
                placeholder="gpt-image-1"
              />
            )}
          </Field>

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

          {error ? <p className="pt-form-error">{error}</p> : null}

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
