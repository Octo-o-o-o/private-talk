import { useState } from "react";
import * as api from "../../lib/tauri";
import { useAppStore } from "../../stores/appStore";
import { Lock, Delete } from "lucide-react";

export function PinLock() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const setLocked = useAppStore((s) => s.setLocked);

  const handleDigit = (digit: string) => {
    if (pin.length >= 6) return;
    const newPin = pin + digit;
    setPin(newPin);
    setError(false);

    // Auto-verify when 4+ digits
    if (newPin.length >= 4) {
      api.verifyPin(newPin).then((ok) => {
        if (ok) {
          setLocked(false);
        }
      });
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
    <div className="h-full flex flex-col items-center justify-center bg-zinc-950">
      <div className="flex flex-col items-center">
        <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center mb-6">
          <Lock size={24} className="text-zinc-400" />
        </div>

        <h2 className="text-lg font-medium text-zinc-200 mb-8">Enter PIN</h2>

        {/* PIN dots */}
        <div
          className={`flex gap-3 mb-8 ${shake ? "animate-[shake_0.5s_ease-in-out]" : ""}`}
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-full transition-colors ${
                i < pin.length
                  ? error
                    ? "bg-red-500"
                    : "bg-blue-500"
                  : "bg-zinc-700"
              }`}
            />
          ))}
        </div>

        {error && (
          <p className="text-sm text-red-400 mb-4">Incorrect PIN</p>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
            <button
              key={digit}
              onClick={() => handleDigit(digit)}
              className="w-16 h-16 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xl font-light transition-colors active:scale-95"
            >
              {digit}
            </button>
          ))}
          <div /> {/* empty spacer */}
          <button
            onClick={() => handleDigit("0")}
            className="w-16 h-16 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xl font-light transition-colors active:scale-95"
          >
            0
          </button>
          <button
            onClick={pin.length > 0 ? handleDelete : handleSubmit}
            className="w-16 h-16 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 flex items-center justify-center transition-colors active:scale-95"
          >
            <Delete size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
