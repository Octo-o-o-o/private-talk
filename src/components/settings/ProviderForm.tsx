import { useState } from "react";
import * as api from "../../lib/tauri";
import { useAppStore } from "../../stores/appStore";
import type { Provider } from "../../lib/types";
import { Trash2, Star, Eye, EyeOff } from "lucide-react";

const PRESETS = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", models: "gpt-4o,gpt-4o-mini,o3-mini" },
  { name: "Grok (xAI)", baseUrl: "https://api.x.ai/v1", models: "grok-3,grok-3-mini" },
];

export function ProviderForm() {
  const { providers, loadProviders } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState("");
  const [showKey, setShowKey] = useState(false);

  const applyPreset = (preset: typeof PRESETS[0]) => {
    setName(preset.name);
    setBaseUrl(preset.baseUrl);
    setModels(preset.models);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !baseUrl.trim() || !apiKey.trim()) return;
    const modelList = models
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    await api.createProvider(name.trim(), baseUrl.trim(), apiKey.trim(), modelList);
    await loadProviders();
    setShowForm(false);
    setName("");
    setBaseUrl("");
    setApiKey("");
    setModels("");
  };

  const handleDelete = async (id: string) => {
    await api.deleteProvider(id);
    await loadProviders();
  };

  const handleSetDefault = async (id: string) => {
    await api.setDefaultProvider(id);
    await loadProviders();
  };

  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-300 mb-3">Model Providers</h3>

      {/* Existing providers */}
      <div className="space-y-2 mb-4">
        {providers.map((p: Provider) => (
          <div
            key={p.id}
            className="flex items-center justify-between bg-zinc-800 rounded-lg px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              {p.is_default && <Star size={12} className="text-amber-400 fill-amber-400" />}
              <div>
                <span className="text-sm text-zinc-200">{p.name}</span>
                <span className="text-xs text-zinc-500 ml-2">{p.models.join(", ")}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {!p.is_default && (
                <button
                  onClick={() => handleSetDefault(p.id)}
                  className="text-zinc-500 hover:text-amber-400 p-1"
                  title="Set as default"
                >
                  <Star size={14} />
                </button>
              )}
              <button
                onClick={() => handleDelete(p.id)}
                className="text-zinc-500 hover:text-red-400 p-1"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Preset buttons */}
      {!showForm && (
        <div className="space-y-2">
          <div className="flex gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => applyPreset(preset)}
                className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300 transition-colors"
              >
                + {preset.name}
              </button>
            ))}
            <button
              onClick={() => setShowForm(true)}
              className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300 transition-colors"
            >
              + Custom
            </button>
          </div>
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-3 bg-zinc-800 rounded-lg p-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-zinc-900 text-zinc-200 rounded-lg px-3 py-2 text-sm outline-none border border-zinc-700 focus:border-zinc-500"
              placeholder="e.g. OpenAI"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Base URL</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full bg-zinc-900 text-zinc-200 rounded-lg px-3 py-2 text-sm outline-none border border-zinc-700 focus:border-zinc-500"
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">API Key</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full bg-zinc-900 text-zinc-200 rounded-lg px-3 py-2 pr-10 text-sm outline-none border border-zinc-700 focus:border-zinc-500"
                placeholder="sk-..."
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Models (comma-separated)
            </label>
            <input
              value={models}
              onChange={(e) => setModels(e.target.value)}
              className="w-full bg-zinc-900 text-zinc-200 rounded-lg px-3 py-2 text-sm outline-none border border-zinc-700 focus:border-zinc-500"
              placeholder="gpt-4o, gpt-4o-mini"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
