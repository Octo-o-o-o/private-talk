import { useState } from "react";
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

function validatePin(pin: string): string | null {
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) {
    return `PIN must be ${PIN_MIN}-${PIN_MAX} digits.`;
  }
  if (!/^\d+$/.test(pin)) {
    return "PIN must contain numbers only.";
  }
  return null;
}

export function PinSettings() {
  return <PinSettingsSection />;
}

export function PinSettingsSection() {
  const { pinEnabled, checkPinStatus, loadConversations, loadProviders } =
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

    const validationError = validatePin(pin);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (pin !== confirmPin) {
      setError("PINs do not match.");
      return;
    }

    try {
      await api.enablePin(pin);
      await checkPinStatus();
      closePanel();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to enable PIN.",
      );
    }
  }

  async function handleDisable(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    try {
      const ok = await api.disablePin(pin);
      if (!ok) {
        setError("Incorrect PIN.");
        return;
      }

      await checkPinStatus();
      closePanel();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to disable PIN.",
      );
    }
  }

  async function handleReset(): Promise<void> {
    try {
      await api.resetAllData();
      await checkPinStatus();
      await loadConversations();
      await loadProviders();
      setShowReset(false);
      closePanel();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to reset local data.",
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
        title="Security"
        footer={
          pinEnabled
            ? "The PIN is checked before anything is unlocked. Forgetting it means resetting the app."
            : "Enable a PIN to require verification every time Private Talk opens on this device."
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
            <p className="pt-settings-row__title">PIN Lock</p>
            <p className="pt-settings-row__detail">
              {pinEnabled
                ? "Required on every launch"
                : "Anyone with this device can open the app"}
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
                  label="Current PIN"
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
                    Cancel
                  </button>
                  <button type="submit" className={buttonStyles.primary}>
                    Disable PIN
                  </button>
                </div>
              </form>
            ) : (
              <form className="pt-settings-form" onSubmit={handleEnable}>
                <TextField
                  label={`New PIN (${PIN_MIN}-${PIN_MAX} digits)`}
                  {...inputProps}
                  value={pin}
                  onChange={(event) =>
                    setPin(sanitizeDigits(event.target.value))
                  }
                  className={PIN_INPUT_CLASS}
                />

                <TextField
                  label="Confirm PIN"
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
                    Cancel
                  </button>
                  <button type="submit" className={buttonStyles.primary}>
                    Enable PIN
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="Data"
        footer="Resetting removes all conversations, providers, and PIN settings from this device. This action cannot be undone."
      >
        {showReset ? (
          <div className="pt-settings-expand">
            <p className="pt-settings-warning">
              This will permanently erase all local data on this device.
            </p>
            <div className="pt-settings-form__actions">
              <button
                type="button"
                className={buttonStyles.secondary}
                onClick={() => setShowReset(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={buttonStyles.danger}
                onClick={() => void handleReset()}
              >
                Reset Everything
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
              <p className="pt-settings-row__title">Reset All Local Data</p>
            </div>
          </button>
        )}
      </SettingsSection>
    </>
  );
}
