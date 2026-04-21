import { Delete, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import * as api from "../../lib/tauri";
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
  const setLocked = useAppStore((s) => s.setLocked);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const [pinLength, setPinLength] = useState(PIN_LENGTH);

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

    return () => {
      cancelled = true;
    };
  }, []);

  async function tryVerify(candidate: string): Promise<boolean> {
    const ok = await api.verifyPin(candidate);
    if (ok) {
      setLocked(false);
    }
    return ok;
  }

  function failVerification(): void {
    setError(true);
    setShake(true);
    window.setTimeout(() => {
      setShake(false);
      setPin("");
    }, 500);
  }

  function handleDigit(digit: string): void {
    if (pin.length >= pinLength) {
      return;
    }

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

        <h1 className="pt-pin-lock__title">Enter Passcode</h1>
        <p className="pt-pin-lock__copy">
          Unlock Private Talk on this device.
        </p>

        <div
          className={`pt-pin-lock__dots${shake ? " is-shaking" : ""}`}
          role="status"
          aria-label={`${pin.length} of ${pinLength} digits entered`}
        >
          {Array.from({ length: pinLength }, (_, index) => (
            <span
              key={index}
              className={dotClass(index < pin.length, error)}
            />
          ))}
        </div>

        <div className="pt-pin-lock__error">
          {error ? <span>Incorrect PIN</span> : null}
        </div>

        <div className="pt-pin-lock__keypad">
          {DIGITS.map((digit) => (
            <button
              key={digit}
              type="button"
              className="pt-pin-lock__key"
              onClick={() => handleDigit(digit)}
              aria-label={`Digit ${digit}`}
            >
              {digit}
            </button>
          ))}

          <div className="pt-pin-lock__key pt-pin-lock__key--spacer" />

          <button
            type="button"
            className="pt-pin-lock__key"
            onClick={() => handleDigit("0")}
            aria-label="Digit 0"
          >
            0
          </button>

          <button
            type="button"
            className="pt-pin-lock__action"
            onClick={pin.length > 0 ? handleDelete : () => void handleSubmit()}
            aria-label={pin.length > 0 ? "Delete" : "Submit PIN"}
          >
            <Delete size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
