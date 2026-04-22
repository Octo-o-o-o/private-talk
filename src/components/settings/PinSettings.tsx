import { useState } from "react";
import { useI18n } from "../../lib/i18n";
import * as api from "../../lib/tauri";
import { useAppStore } from "../../stores/appStore";
import { SettingsSection } from "./SettingsPage";
import { buttonStyles, FormError, TextField } from "./formControls";

const PIN_MIN = 4;
const PIN_MAX = 6;
const PIN_INPUT_CLASS = "pt-input pt-input--pin";

function sanitizeDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function validatePin(
  pin: string,
  t: (zh: string, en: string) => string,
): string | null {
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) {
    return t(
      `PIN 需要 ${PIN_MIN}-${PIN_MAX} 位数字。`,
      `PIN must be ${PIN_MIN}-${PIN_MAX} digits.`,
    );
  }
  if (!/^\d+$/.test(pin)) {
    return t("PIN 只能包含数字。", "PIN must contain numbers only.");
  }
  return null;
}

export function PinSettings() {
  return <PinSettingsSection />;
}

export function PinSettingsSection() {
  const { t } = useI18n();
  const { pinEnabled, checkPinStatus, loadConversations, loadProviders, loadAssistants } =
    useAppStore();
  const [expanded, setExpanded] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  function resetFields(): void {
    setPin("");
    setConfirmPin("");
    setError(null);
  }

  function closePanel(): void {
    setExpanded(false);
    resetFields();
  }

  async function handleEnable(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    const validationError = validatePin(pin, t);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (pin !== confirmPin) {
      setError(t("PIN 不一致。", "PINs do not match."));
      return;
    }

    try {
      await api.enablePin(pin);
      await checkPinStatus();
      closePanel();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : t("启用 PIN 失败。", "Failed to enable PIN."),
      );
    }
  }

  async function handleDisable(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    try {
      const ok = await api.disablePin(pin);
      if (!ok) {
        setError(t("PIN 错误。", "Incorrect PIN."));
        return;
      }

      await checkPinStatus();
      closePanel();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : t("关闭 PIN 失败。", "Failed to disable PIN."),
      );
    }
  }

  async function handleReset(): Promise<void> {
    try {
      await api.resetAllData();
      await checkPinStatus();
      await loadConversations();
      await loadAssistants();
      await loadProviders();
      setShowReset(false);
      closePanel();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : t("重置本地数据失败。", "Failed to reset local data."),
      );
    }
  }

  const inputProps = {
    type: "password" as const,
    inputMode: "numeric" as const,
    maxLength: PIN_MAX,
    placeholder: "••••",
  };

  return (
    <>
      <SettingsSection
        title={t("安全", "Security")}
        footer={
          pinEnabled
            ? t(
                "在解锁任何内容之前都会先校验 PIN。如果忘记 PIN，就只能重置应用。",
                "The PIN is checked before anything is unlocked. Forgetting it means resetting the app.",
              )
            : t(
                "启用 PIN 后，每次打开 Private Talk 都需要先验证。",
                "Enable a PIN to require verification every time Private Talk opens on this device.",
              )
        }
      >
        <button
          type="button"
          className="pt-settings-row pt-settings-row--interactive"
          onClick={() => {
            setExpanded((value) => !value);
            if (expanded) {
              resetFields();
            }
          }}
        >
          <div className="pt-settings-row__copy">
            <p className="pt-settings-row__title">{t("PIN 锁", "PIN Lock")}</p>
            <p className="pt-settings-row__detail">
              {pinEnabled
                ? t("每次启动都需要验证", "Required on every launch")
                : t("任何拿到这台设备的人都能直接打开应用", "Anyone with this device can open the app")}
            </p>
          </div>

          <span
            className="pt-toggle"
            data-state={pinEnabled ? "on" : "off"}
            role="switch"
            aria-checked={pinEnabled}
          />
        </button>

        {expanded ? (
          <div className="pt-settings-expand">
            {pinEnabled ? (
              <form className="pt-settings-form" onSubmit={handleDisable}>
                <TextField
                  label={t("当前 PIN", "Current PIN")}
                  {...inputProps}
                  value={pin}
                  onChange={(event) =>
                    setPin(sanitizeDigits(event.target.value))
                  }
                  className={PIN_INPUT_CLASS}
                />

                <FormError message={error} />

                <div className="pt-settings-form__actions">
                  <button
                    type="button"
                    className={buttonStyles.secondary}
                    onClick={closePanel}
                  >
                    {t("取消", "Cancel")}
                  </button>
                  <button type="submit" className={buttonStyles.primary}>
                    {t("关闭 PIN", "Disable PIN")}
                  </button>
                </div>
              </form>
            ) : (
              <form className="pt-settings-form" onSubmit={handleEnable}>
                <TextField
                  label={t(`新 PIN（${PIN_MIN}-${PIN_MAX} 位）`, `New PIN (${PIN_MIN}-${PIN_MAX} digits)`)}
                  {...inputProps}
                  value={pin}
                  onChange={(event) =>
                    setPin(sanitizeDigits(event.target.value))
                  }
                  className={PIN_INPUT_CLASS}
                />

                <TextField
                  label={t("确认 PIN", "Confirm PIN")}
                  {...inputProps}
                  value={confirmPin}
                  onChange={(event) =>
                    setConfirmPin(sanitizeDigits(event.target.value))
                  }
                  className={PIN_INPUT_CLASS}
                />

                <FormError message={error} />

                <div className="pt-settings-form__actions">
                  <button
                    type="button"
                    className={buttonStyles.secondary}
                    onClick={closePanel}
                  >
                    {t("取消", "Cancel")}
                  </button>
                  <button type="submit" className={buttonStyles.primary}>
                    {t("启用 PIN", "Enable PIN")}
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title={t("数据", "Data")}
        footer={t(
          "重置会从当前设备删除所有对话、服务商和 PIN 设置。这个操作不能撤销。",
          "Resetting removes all conversations, providers, and PIN settings from this device. This action cannot be undone.",
        )}
      >
        {showReset ? (
          <div className="pt-settings-expand">
            <p className="pt-settings-warning">
              {t(
                "这会永久抹掉当前设备上的全部本地数据。",
                "This will permanently erase all local data on this device.",
              )}
            </p>
            <div className="pt-settings-form__actions">
              <button
                type="button"
                className={buttonStyles.secondary}
                onClick={() => setShowReset(false)}
              >
                {t("取消", "Cancel")}
              </button>
              <button
                type="button"
                className={buttonStyles.danger}
                onClick={() => void handleReset()}
              >
                {t("重置全部数据", "Reset Everything")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="pt-settings-row pt-settings-row--interactive is-danger"
            onClick={() => setShowReset(true)}
          >
            <div className="pt-settings-row__copy">
              <p className="pt-settings-row__title">{t("重置全部本地数据", "Reset All Local Data")}</p>
            </div>
          </button>
        )}
      </SettingsSection>
    </>
  );
}
