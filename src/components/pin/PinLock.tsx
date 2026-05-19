import { Delete, Fingerprint, Lock, ScanFace } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  hapticNotification,
  hapticSelection,
} from "../../lib/haptics";
import { useI18n } from "../../lib/i18n";
import * as api from "../../lib/tauri";
import type { BiometryAvailability } from "../../lib/tauri";
import { useAppStore } from "../../stores/appStore";

const PIN_LENGTH = 6;
const MIN_VERIFY_LENGTH = 4;
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

function dotClass(filled: boolean, isError: boolean): string {
  if (!filled) {
    return "pt-pin-lock__dot";
  }

  return `pt-pin-lock__dot is-filled${isError ? " is-error" : ""}`;
}

export function PinLock() {
  const { t } = useI18n();
  const setLocked = useAppStore((s) => s.setLocked);
  const biometricUnlockEnabled = useAppStore((s) => s.biometricUnlockEnabled);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const [pinLength, setPinLength] = useState(PIN_LENGTH);
  const [biometry, setBiometry] = useState<BiometryAvailability>({
    available: false,
    kind: "none",
  });
  // Cooldown countdown: 0 means "no cooldown active". Set whenever the
  // Rust backend reports `lockout_remaining_seconds > 0` and ticked
  // every second by an effect below.
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  // The auto-prompt fires once per mount; without this guard, React StrictMode
  // (and any future re-renders) could re-trigger the system biometric sheet.
  const autoPromptStartedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void api
      .getPinLength()
      .then((length) => {
        if (!cancelled && length && length >= MIN_VERIFY_LENGTH) {
          setPinLength(length);
        }
      })
      .catch((err) => {
        console.warn("Unable to read PIN length:", err);
      });

    void api
      .biometricAvailability()
      .then((info) => {
        if (!cancelled) {
          setBiometry(info);
        }
      })
      .catch((err) => {
        console.warn("Unable to query biometry availability:", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function tryVerify(candidate: string): Promise<boolean> {
    const result = await api.verifyPin(candidate);
    if (result.success) {
      hapticNotification("success");
      setLocked(false);
      setCooldownSeconds(0);
      return true;
    }
    if (result.lockout_remaining_seconds > 0) {
      setCooldownSeconds(result.lockout_remaining_seconds);
    }
    return false;
  }

  async function tryBiometric(): Promise<void> {
    const reason = t(
      "用 Face ID 解锁 Private Talk",
      "Unlock Private Talk with Face ID",
    );
    try {
      const ok = await api.biometricEvaluate(reason);
      if (ok) {
        setLocked(false);
      }
    } catch (err) {
      // Surface only in the console — the PIN keypad is right there for the
      // user, so we shouldn't pop a banner just because the system sheet
      // failed.
      console.warn("Biometric authentication failed:", err);
    }
  }

  // Tick the cooldown countdown every second while it's > 0. Reaching 0
  // unlocks the keypad; users can immediately try again (or wait for
  // another wrong attempt to trigger another lockout).
  useEffect(() => {
    if (cooldownSeconds <= 0) {
      return;
    }
    const id = window.setInterval(() => {
      setCooldownSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldownSeconds]);

  useEffect(() => {
    if (autoPromptStartedRef.current) {
      return;
    }
    if (!biometricUnlockEnabled || !biometry.available) {
      return;
    }
    autoPromptStartedRef.current = true;
    void tryBiometric();
    // tryBiometric is stable for this component's lifetime and only reads
    // state via closures; including it would loop because reason text is
    // localized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometricUnlockEnabled, biometry.available]);

  const biometryLabel =
    biometry.kind === "face-id"
      ? t("用 Face ID 解锁", "Unlock with Face ID")
      : biometry.kind === "optic-id"
        ? t("用 Optic ID 解锁", "Unlock with Optic ID")
        : t("用 Touch ID 解锁", "Unlock with Touch ID");
  const showBiometricButton =
    biometricUnlockEnabled && biometry.available && biometry.kind !== "none";
  const BiometryIcon = biometry.kind === "face-id" ? ScanFace : Fingerprint;

  function failVerification(): void {
    hapticNotification("error");
    setError(true);
    setShake(true);
    window.setTimeout(() => {
      setShake(false);
      setPin("");
    }, 500);
  }

  function handleDigit(digit: string): void {
    if (cooldownSeconds > 0) {
      // Cooldown is in effect — ignore digit presses entirely so the user
      // can't burn through their attempts while waiting.
      return;
    }
    if (pin.length >= pinLength) {
      return;
    }

    hapticSelection();
    const next = pin + digit;
    setPin(next);
    setError(false);

    if (next.length >= MIN_VERIFY_LENGTH) {
      void (async () => {
        const ok = await tryVerify(next);
        if (!ok && next.length === pinLength) {
          failVerification();
        }
      })();
    }
  }

  function handleDelete(): void {
    setPin((current) => current.slice(0, -1));
    setError(false);
  }

  async function handleSubmit(): Promise<void> {
    if (pin.length < MIN_VERIFY_LENGTH) {
      return;
    }

    const ok = await tryVerify(pin);
    if (ok) {
      return;
    }
    failVerification();
  }

  return (
    <div className="pt-pin-lock-shell">
      <div className="pt-pin-lock-card">
        <div className="pt-pin-lock__badge">
          <Lock size={22} />
        </div>

        <h1 className="pt-pin-lock__title">{t("输入 PIN 码", "Enter Passcode")}</h1>
        <p className="pt-pin-lock__copy">
          {t("在当前设备上解锁 Private Talk。", "Unlock Private Talk on this device.")}
        </p>

        <div
          className={`pt-pin-lock__dots${shake ? " is-shaking" : ""}`}
          role="status"
          aria-label={t(
            `已输入 ${pin.length} / ${pinLength} 位`,
            `${pin.length} of ${pinLength} digits entered`,
          )}
        >
          {Array.from({ length: pinLength }, (_, index) => (
            <span
              key={index}
              className={dotClass(index < pin.length, error)}
            />
          ))}
        </div>

        <div className="pt-pin-lock__error">
          {cooldownSeconds > 0 ? (
            <span>
              {t(
                `连续输错多次，请 ${cooldownSeconds} 秒后再试`,
                `Too many wrong attempts — try again in ${cooldownSeconds}s`,
              )}
            </span>
          ) : error ? (
            <span>{t("PIN 错误", "Incorrect PIN")}</span>
          ) : null}
        </div>

        {showBiometricButton ? (
          <button
            type="button"
            className="pt-pin-lock__biometric"
            onClick={() => void tryBiometric()}
            aria-label={biometryLabel}
          >
            <BiometryIcon size={18} />
            <span>{biometryLabel}</span>
          </button>
        ) : null}

        <div className="pt-pin-lock__keypad">
          {DIGITS.map((digit) => (
            <button
              key={digit}
              type="button"
              className="pt-pin-lock__key"
              onClick={() => handleDigit(digit)}
              disabled={cooldownSeconds > 0}
              aria-label={t(`数字 ${digit}`, `Digit ${digit}`)}
            >
              {digit}
            </button>
          ))}

          <div className="pt-pin-lock__key pt-pin-lock__key--spacer" />

          <button
            type="button"
            className="pt-pin-lock__key"
            onClick={() => handleDigit("0")}
            disabled={cooldownSeconds > 0}
            aria-label={t("数字 0", "Digit 0")}
          >
            0
          </button>

          <button
            type="button"
            className="pt-pin-lock__action"
            onClick={pin.length > 0 ? handleDelete : () => void handleSubmit()}
            disabled={cooldownSeconds > 0}
            aria-label={pin.length > 0 ? t("删除", "Delete") : t("提交 PIN", "Submit PIN")}
          >
            <Delete size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
