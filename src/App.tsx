import { lazy, Suspense, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { ChatView } from "./components/chat/ChatView";
import { PinLock } from "./components/pin/PinLock";
import { useAppStore } from "./stores/appStore";
import { appZoomStep, usePreferencesStore } from "./stores/preferencesStore";

const SettingsPage = lazy(() => import("./components/settings/SettingsPage").then(m => ({ default: m.SettingsPage })));
const UsagePage = lazy(() => import("./components/usage/UsagePage").then(m => ({ default: m.UsagePage })));
const VoiceManager = lazy(() => import("./components/voice/VoiceManager").then(m => ({ default: m.VoiceManager })));
const VoiceEditor = lazy(() => import("./components/voice/VoiceEditor").then(m => ({ default: m.VoiceEditor })));
const AssistantManager = lazy(() => import("./components/assistant/AssistantManager").then(m => ({ default: m.AssistantManager })));
const AssistantEditor = lazy(() => import("./components/assistant/AssistantEditor").then(m => ({ default: m.AssistantEditor })));

interface MenuZoomPayload {
  action: "in" | "out" | "reset" | "set";
  zoom?: number | null;
}

function App() {
  const {
    isLocked,
    pinEnabled,
    checkPinStatus,
    loadConversations,
    loadProviders,
    loadSpeechSettings,
    loadAssistants,
    loadVoices,
    loadOpenClawInstances,
    scanLocalServices,
  } = useAppStore();
  const initPreferences = usePreferencesStore((state) => state.initPreferences);

  useEffect(() => {
    const init = async () => {
      const preferencesTask = initPreferences().catch((error) => {
        console.error("Failed to initialize preferences:", error);
      });
      const bootstrapResults = await Promise.allSettled([
        checkPinStatus(),
        loadAssistants(),
        loadVoices(),
        loadConversations(),
        loadProviders(),
        loadSpeechSettings(),
        loadOpenClawInstances(),
      ]);

      for (const result of bootstrapResults) {
        if (result.status === "rejected") {
          console.error("Bootstrap task failed:", result.reason);
        }
      }

      await preferencesTask;

      // Dismiss splash screen
      const splash = document.getElementById("splash-screen");
      if (splash) {
        splash.classList.add("fade-out");
        setTimeout(() => splash.remove(), 300);
      }

      // Silent background scan — results cached for settings page
      void scanLocalServices();
    };
    void init();
  }, [
    checkPinStatus,
    initPreferences,
    loadConversations,
    loadOpenClawInstances,
    loadProviders,
    loadSpeechSettings,
    loadAssistants,
    loadVoices,
    scanLocalServices,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleThemeChange = () => {
      usePreferencesStore.getState().syncThemeWithSystem();
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleThemeChange);
      return () => mediaQuery.removeEventListener("change", handleThemeChange);
    }

    mediaQuery.addListener(handleThemeChange);
    return () => mediaQuery.removeListener(handleThemeChange);
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<MenuZoomPayload>("app-menu-zoom", (event) => {
      const { action, zoom } = event.payload;
      const { adjustZoom, resetZoom, setZoom } = usePreferencesStore.getState();

      if (action === "in") {
        void adjustZoom(appZoomStep);
        return;
      }

      if (action === "out") {
        void adjustZoom(-appZoomStep);
        return;
      }

      if (action === "reset") {
        void resetZoom();
        return;
      }

      if (action === "set" && typeof zoom === "number") {
        void setZoom(zoom);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;

      const key = event.key;
      const isZoomIn = key === "=" || key === "+" || event.code === "NumpadAdd";
      const isZoomOut = key === "-" || key === "_" || event.code === "NumpadSubtract";
      const isReset = key === "0" || event.code === "Numpad0";

      if (!isZoomIn && !isZoomOut && !isReset) return;

      event.preventDefault();

      const { adjustZoom, resetZoom } = usePreferencesStore.getState();
      if (isReset) {
        void resetZoom();
        return;
      }

      void adjustZoom(isZoomIn ? appZoomStep : -appZoomStep);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (pinEnabled && isLocked) {
    return (
      <div className="h-full bg-background text-foreground">
        <PinLock />
      </div>
    );
  }

  return (
    <div className="h-full bg-background text-foreground">
      <Suspense>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<ChatView />} />
            <Route path="/usage" element={<UsagePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/voices" element={<VoiceManager />} />
            <Route path="/voices/new" element={<VoiceEditor />} />
            <Route path="/voices/edit/:voiceId" element={<VoiceEditor />} />
            <Route path="/assistants" element={<AssistantManager />} />
            <Route path="/assistants/new" element={<AssistantEditor />} />
            <Route path="/assistants/edit/:assistantId" element={<AssistantEditor />} />
            <Route path="/assistants/view/:assistantId" element={<AssistantEditor />} />
            <Route path="/scenarios" element={<AssistantManager />} />
            <Route path="/scenarios/new" element={<AssistantEditor />} />
            <Route path="/scenarios/edit/:scenarioId" element={<AssistantEditor />} />
            <Route path="/scenarios/view/:scenarioId" element={<AssistantEditor />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}

export default App;
