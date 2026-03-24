import { useState, useEffect, useRef } from "react";
import * as api from "../../lib/tauri";
import { useAppStore } from "../../stores/appStore";
import { Lock, Delete, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const numpadBase =
  "h-[68px] w-[68px] rounded-2xl border border-[color:var(--lock-border)] bg-[var(--lock-panel-soft)] transition-all duration-150 hover:bg-[var(--lock-panel-hover)] active:scale-[0.96]";

export function PinLock() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const [resetStep, setResetStep] = useState<"idle" | "confirm" | "typing">("idle");
  const [confirmText, setConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const setLocked = useAppStore((s) => s.setLocked);
  const checkPinStatus = useAppStore((s) => s.checkPinStatus);
  const loadAssistants = useAppStore((s) => s.loadAssistants);
  const loadVoices = useAppStore((s) => s.loadVoices);
  const loadConversations = useAppStore((s) => s.loadConversations);
  const loadProviders = useAppStore((s) => s.loadProviders);
  const { t } = useI18n();
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  const requiredText = t(
    "我已知晓删除并重置所有数据",
    "I confirm deleting and resetting all data"
  );

  // Auto-focus the hidden input for keyboard capture
  useEffect(() => {
    if (resetStep === "idle") {
      hiddenInputRef.current?.focus();
    }
  }, [resetStep]);

  const handlePinInput = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setPin(digits);
    setError(false);

    if (digits.length >= 4) {
      api.verifyPin(digits).then((ok) => {
        if (ok) {
          setLocked(false);
        }
      }).catch(() => {});
    }
  };

  const handleDigit = (digit: string) => {
    if (pin.length >= 6) return;
    handlePinInput(pin + digit);
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

  // Handle keyboard events on the hidden input
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      void handleSubmit();
    } else if (e.key === "Backspace" && pin.length === 0) {
      // Already empty, do nothing
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await api.resetAllData();
      await checkPinStatus();
      await Promise.all([loadAssistants(), loadVoices(), loadConversations(), loadProviders()]);
      setLocked(false);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div
      className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-[var(--lock-background)]"
      onClick={() => resetStep === "idle" && hiddenInputRef.current?.focus()}
    >
      {/* Hidden input for keyboard capture and paste */}
      {resetStep === "idle" && (
        <input
          ref={hiddenInputRef}
          type="text"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => handlePinInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="absolute opacity-0 w-0 h-0 pointer-events-none"
          aria-label="PIN input"
        />
      )}

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

      {/* Reset button - subtle position at bottom */}
      <div className="absolute bottom-6 z-10">
        {resetStep === "idle" && (
          <button
            onClick={() => setResetStep("confirm")}
            className="text-xs text-[var(--lock-muted)] opacity-40 hover:opacity-70 transition-opacity"
          >
            {t("忘记 PIN？重置应用", "Forgot PIN? Reset app")}
          </button>
        )}

        {resetStep === "confirm" && (
          <div className="flex flex-col items-center gap-3 max-w-xs text-center animate-fade-in">
            <div className="flex items-center gap-1.5 text-destructive">
              <AlertTriangle size={14} />
              <span className="text-xs font-medium">
                {t("此操作不可恢复", "This action is irreversible")}
              </span>
            </div>
            <p className="text-xs text-[var(--lock-muted)]">
              {t(
                "重置后，所有对话记录、配置、API 密钥等数据将被永久删除。",
                "After reset, all conversations, settings, API keys and other data will be permanently deleted."
              )}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setResetStep("typing")}
                className="px-3 py-1.5 text-xs rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                {t("继续", "Continue")}
              </button>
              <button
                onClick={() => setResetStep("idle")}
                className="px-3 py-1.5 text-xs rounded-lg border border-[color:var(--lock-border)] text-[var(--lock-muted)] hover:bg-[var(--lock-panel-soft)] transition-colors"
              >
                {t("取消", "Cancel")}
              </button>
            </div>
          </div>
        )}

        {resetStep === "typing" && (
          <div className="flex flex-col items-center gap-3 max-w-sm text-center animate-fade-in">
            <p className="text-xs text-[var(--lock-muted)]">
              {t("请输入以下文字以确认重置：", "Type the following to confirm reset:")}
            </p>
            <p className="text-xs font-mono text-destructive select-all px-2 py-1 rounded border border-destructive/20 bg-destructive/5">
              {requiredText}
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoFocus
              placeholder={requiredText}
              className="w-full px-3 py-2 text-xs rounded-lg border border-[color:var(--lock-border)] bg-[var(--lock-panel-soft)] text-[var(--lock-foreground)] placeholder:text-[var(--lock-muted)]/30 focus:outline-none focus:ring-1 focus:ring-destructive/50"
            />
            <div className="flex gap-2">
              <button
                disabled={confirmText !== requiredText || resetting}
                onClick={() => void handleReset()}
                className="px-3 py-1.5 text-xs rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {resetting
                  ? t("重置中…", "Resetting…")
                  : t("确认重置", "Confirm Reset")}
              </button>
              <button
                onClick={() => {
                  setResetStep("idle");
                  setConfirmText("");
                }}
                className="px-3 py-1.5 text-xs rounded-lg border border-[color:var(--lock-border)] text-[var(--lock-muted)] hover:bg-[var(--lock-panel-soft)] transition-colors"
              >
                {t("取消", "Cancel")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
