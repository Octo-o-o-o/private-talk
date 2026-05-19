import { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n";
import * as api from "../../lib/tauri";
import type { BiometryAvailability } from "../../lib/tauri";
import { useAppStore } from "../../stores/appStore";
import { SettingsSection } from "./SettingsPage";
import {
  buttonStyles,
  FormError,
  SelectSettingRow,
  TextField,
} from "./formControls";

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

type AutoLockChoice = "0" | "30" | "60" | "300" | "900" | "-1";

const AUTO_LOCK_CHOICES: AutoLockChoice[] = ["0", "30", "60", "300", "900", "-1"];

function autoLockChoiceLabel(
  choice: AutoLockChoice,
  t: (zh: string, en: string) => string,
): string {
  switch (choice) {
    case "0":
      return t("立即", "Immediately");
    case "30":
      return t("30 秒后", "After 30 seconds");
    case "60":
      return t("1 分钟后", "After 1 minute");
    case "300":
      return t("5 分钟后", "After 5 minutes");
    case "900":
      return t("15 分钟后", "After 15 minutes");
    case "-1":
      return t("永不", "Never");
  }
}

function clampAutoLockChoice(seconds: number): AutoLockChoice {
  // Snap arbitrary stored values onto the nearest preset so the UI stays
  // honest about what the radio actually does.
  if (seconds < 0) return "-1";
  if (seconds <= 0) return "0";
  if (seconds <= 30) return "30";
  if (seconds <= 60) return "60";
  if (seconds <= 300) return "300";
  return "900";
}

export function PinSettingsSection() {
  const { t } = useI18n();
  const pinEnabled = useAppStore((state) => state.pinEnabled);
  const biometricUnlockEnabled = useAppStore((state) => state.biometricUnlockEnabled);
  const setBiometricUnlockEnabled = useAppStore(
    (state) => state.setBiometricUnlockEnabled,
  );
  const autoLockSeconds = useAppStore((state) => state.autoLockSeconds);
  const setAutoLockSeconds = useAppStore((state) => state.setAutoLockSeconds);
  const checkPinStatus = useAppStore((state) => state.checkPinStatus);
  const loadConversations = useAppStore((state) => state.loadConversations);
  const loadProviders = useAppStore((state) => state.loadProviders);
  const loadAssistants = useAppStore((state) => state.loadAssistants);
  const [expanded, setExpanded] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [biometry, setBiometry] = useState<BiometryAvailability>({
    available: false,
    kind: "none",
  });
  const [biometryError, setBiometryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .biometricAvailability()
      .then((info) => {
        if (!cancelled) {
          setBiometry(info);
        }
      })
      .catch((err) => {
        console.warn("Failed to query biometry availability:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const biometryLabel =
    biometry.kind === "face-id"
      ? t("Face ID", "Face ID")
      : biometry.kind === "optic-id"
        ? t("Optic ID", "Optic ID")
        : t("Touch ID", "Touch ID");

  async function handleToggleBiometric(): Promise<void> {
    if (!biometry.available || !pinEnabled) {
      return;
    }
    // Enabling: confirm with the system sheet first so the user proves they
    // are the device owner before we tie biometrics to the PIN. Disabling
    // just flips the preference — they're already past the PIN screen.
    if (!biometricUnlockEnabled) {
      setBiometryError(null);
      try {
        const reason = t(
          `用 ${biometryLabel} 解锁 Private Talk`,
          `Unlock Private Talk with ${biometryLabel}`,
        );
        const ok = await api.biometricEvaluate(reason);
        if (!ok) {
          return;
        }
        await setBiometricUnlockEnabled(true);
      } catch (err) {
        setBiometryError(
          err instanceof Error
            ? err.message
            : t(`无法启用 ${biometryLabel}。`, `Could not enable ${biometryLabel}.`),
        );
      }
      return;
    }
    await setBiometricUnlockEnabled(false);
  }

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

        {pinEnabled && biometry.available ? (
          <button
            type="button"
            className="pt-settings-row pt-settings-row--interactive"
            onClick={() => void handleToggleBiometric()}
          >
            <div className="pt-settings-row__copy">
              <p className="pt-settings-row__title">
                {t(
                  `用 ${biometryLabel} 快速解锁`,
                  `Unlock with ${biometryLabel}`,
                )}
              </p>
              <p className="pt-settings-row__detail">
                {biometryError ??
                  t(
                    `下次启动 Private Talk 时直接用 ${biometryLabel}，失败仍可输入 PIN。`,
                    `Use ${biometryLabel} the next time Private Talk launches; falling back to the PIN keypad is always available.`,
                  )}
              </p>
            </div>

            <span
              className="pt-toggle"
              data-state={biometricUnlockEnabled ? "on" : "off"}
              role="switch"
              aria-checked={biometricUnlockEnabled}
            />
          </button>
        ) : null}

        {pinEnabled ? (
          <SelectSettingRow<AutoLockChoice>
            title={t("自动重新锁定", "Auto-Lock")}
            detail={t(
              "切到后台超过此时长后自动要求重新输入 PIN。",
              "Re-engage the PIN screen after the app has been backgrounded this long.",
            )}
            label={t("自动重新锁定时机", "Auto-lock timing")}
            value={clampAutoLockChoice(autoLockSeconds)}
            valueLabel={autoLockChoiceLabel(clampAutoLockChoice(autoLockSeconds), t)}
            options={AUTO_LOCK_CHOICES.map((choice) => ({
              value: choice,
              label: autoLockChoiceLabel(choice, t),
            }))}
            onChange={(choice) => {
              void setAutoLockSeconds(Number.parseInt(choice, 10));
            }}
          />
        ) : null}

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
