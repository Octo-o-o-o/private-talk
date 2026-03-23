import { useState } from "react";
import * as api from "../../lib/tauri";
import { useAppStore } from "../../stores/appStore";
import { Lock, Delete } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const numpadBase =
  "h-[68px] w-[68px] rounded-2xl border border-[color:var(--lock-border)] bg-[var(--lock-panel-soft)] transition-all duration-150 hover:bg-[var(--lock-panel-hover)] active:scale-[0.96]";

export function PinLock() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const setLocked = useAppStore((s) => s.setLocked);
  const { t } = useI18n();

  const handleDigit = (digit: string) => {
    if (pin.length >= 6) return;
    const newPin = pin + digit;
    setPin(newPin);
    setError(false);

    if (newPin.length >= 4) {
      api.verifyPin(newPin).then((ok) => {
        if (ok) {
          setLocked(false);
        }
      }).catch(() => {});
    }
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
    setError(false);
  };

  const handleSubmit = async () => {
    if (pin.length < 4) return;
    const ok = await api.verifyPin(pin);
    if (ok) {
      setLocked(false);
    } else {
      setError(true);
      setShake(true);
      setTimeout(() => {
        setShake(false);
        setPin("");
      }, 500);
    }
  };

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-[var(--lock-background)]">
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-1/2 top-1/3 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--lock-glow)] blur-[100px]" />
      </div>

      <div className="flex flex-col items-center relative z-10 animate-fade-in">
        <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl border border-[color:var(--lock-border)] bg-[var(--lock-panel)] shadow-2xl shadow-black/10 dark:shadow-black/30">
          <Lock size={26} className="text-[var(--lock-foreground)]" />
        </div>

        <h2 className="mb-8 text-[15px] font-semibold tracking-tight text-[var(--lock-foreground)]">
          {t("输入 PIN", "Enter PIN")}
        </h2>

        {/* PIN dots */}
        <div
          className={`flex gap-4 mb-10 ${shake ? "animate-[shake_0.5s_ease-in-out]" : ""}`}
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-full transition-all duration-200 ${
                i < pin.length
                  ? error
                    ? "bg-red-500 shadow-sm shadow-red-500/40"
                    : "bg-primary shadow-sm shadow-primary/40"
                  : "border border-[color:var(--lock-border)] bg-[var(--lock-empty-dot)]"
              }`}
            />
          ))}
        </div>

        {error && (
          <p className="mb-4 animate-slide-up text-sm text-destructive">
            {t("PIN 错误", "Incorrect PIN")}
          </p>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3.5">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map(
            (key) => {
              if (key === "") return <div key="spacer" />;
              if (key === "del") {
                return (
                  <button
                    key="del"
                    onClick={pin.length > 0 ? handleDelete : handleSubmit}
                    className={`${numpadBase} flex items-center justify-center text-[var(--lock-muted)]`}
                  >
                    <Delete size={20} />
                  </button>
                );
              }
              return (
                <button
                  key={key}
                  onClick={() => handleDigit(key)}
                  className={`${numpadBase} text-xl font-light text-[var(--lock-foreground)]`}
                >
                  {key}
                </button>
              );
            }
          )}
        </div>
      </div>
    </div>
  );
}
