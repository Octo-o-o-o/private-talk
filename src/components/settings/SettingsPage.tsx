import { ProviderForm } from "./ProviderForm";
import { PinSettings } from "./PinSettings";
import { ArrowLeft } from "lucide-react";
import { useAppStore } from "../../stores/appStore";

export function SettingsPage() {
  const setView = useAppStore((s) => s.setView);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => setView("chat")}
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-medium text-zinc-100">Settings</h1>
        </div>

        <div className="space-y-8">
          <ProviderForm />
          <PinSettings />

          {/* About */}
          <div>
            <h3 className="text-sm font-medium text-zinc-300 mb-3">About</h3>
            <div className="bg-zinc-800 rounded-lg p-4 text-sm text-zinc-400 space-y-1">
              <p>
                <span className="text-zinc-300">Private Talk</span> v0.1.0
              </p>
              <p>A local AI chat client. Your data stays on your device.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
