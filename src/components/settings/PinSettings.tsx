import { useState } from "react";
import * as api from "../../lib/tauri";
import { useAppStore } from "../../stores/appStore";
import { Shield, ShieldOff, AlertTriangle } from "lucide-react";

export function PinSettings() {
  const { pinEnabled, checkPinStatus } = useAppStore();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [showReset, setShowReset] = useState(false);

  const handleEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (pin.length < 4 || pin.length > 6) {
      setError("PIN must be 4-6 digits");
      return;
    }
    if (!/^\d+$/.test(pin)) {
      setError("PIN must be numbers only");
      return;
    }
    if (pin !== confirmPin) {
      setError("PINs do not match");
      return;
    }
    await api.enablePin(pin);
    await checkPinStatus();
    setPin("");
    setConfirmPin("");
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const ok = await api.disablePin(pin);
    if (!ok) {
      setError("Incorrect PIN");
      return;
    }
    await checkPinStatus();
    setPin("");
  };

  const handleReset = async () => {
    await api.resetAllData();
    await checkPinStatus();
    useAppStore.getState().loadConversations();
    useAppStore.getState().loadProviders();
    setShowReset(false);
  };

  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-300 mb-3">PIN Lock</h3>

      <div className="bg-zinc-800 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          {pinEnabled ? (
            <>
              <Shield size={16} className="text-green-400" />
              <span className="text-sm text-green-400">PIN is enabled</span>
            </>
          ) : (
            <>
              <ShieldOff size={16} className="text-zinc-500" />
              <span className="text-sm text-zinc-400">PIN is disabled</span>
            </>
          )}
        </div>

        {!pinEnabled ? (
          <form onSubmit={handleEnable} className="space-y-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">New PIN (4-6 digits)</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className="w-full bg-zinc-900 text-zinc-200 rounded-lg px-3 py-2 text-sm outline-none border border-zinc-700 focus:border-zinc-500"
                placeholder="●●●●"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Confirm PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                className="w-full bg-zinc-900 text-zinc-200 rounded-lg px-3 py-2 text-sm outline-none border border-zinc-700 focus:border-zinc-500"
                placeholder="●●●●"
              />
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
            >
              Enable PIN
            </button>
          </form>
        ) : (
          <form onSubmit={handleDisable} className="space-y-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Current PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className="w-full bg-zinc-900 text-zinc-200 rounded-lg px-3 py-2 text-sm outline-none border border-zinc-700 focus:border-zinc-500"
                placeholder="●●●●"
              />
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              type="submit"
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm rounded-lg transition-colors"
            >
              Disable PIN
            </button>
          </form>
        )}

        {/* Reset section */}
        <div className="mt-6 pt-4 border-t border-zinc-700">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} className="text-red-400" />
            <span className="text-xs text-red-400">Danger Zone</span>
          </div>
          {!showReset ? (
            <button
              onClick={() => setShowReset(true)}
              className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
            >
              Forgot PIN? Reset all data...
            </button>
          ) : (
            <div className="bg-red-950/30 rounded-lg p-3 border border-red-900/50">
              <p className="text-xs text-red-300 mb-3">
                This will permanently delete all conversations, providers, and settings.
                This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleReset}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs rounded-lg transition-colors"
                >
                  Reset Everything
                </button>
                <button
                  onClick={() => setShowReset(false)}
                  className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
