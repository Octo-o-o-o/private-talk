import { useEffect } from "react";
import { AppLayout } from "./components/layout/AppLayout";
import { PinLock } from "./components/pin/PinLock";
import {
  applyDocumentAppearance,
  applyNativeAppearance,
  applyZoomFactor,
  DEFAULT_ZOOM_FACTOR,
  detectDesktopPlatform,
  listenToWindowThemeChanges,
  normalizeZoomFactor,
  readWindowTheme,
  stepZoomFactor,
} from "./lib/appearance";
import {
  applyPreviewBootstrap,
  browserPreviewNeedsBootstrap,
  readBrowserPreviewBootstrap,
} from "./lib/preview";
import * as api from "./lib/tauri";
import { useAppStore } from "./stores/appStore";

function App() {
  const isLocked = useAppStore((s) => s.isLocked);
  const pinEnabled = useAppStore((s) => s.pinEnabled);
  const view = useAppStore((s) => s.view);
  const currentConversationId = useAppStore((s) => s.currentConversationId);
  const conversationCount = useAppStore((s) => s.conversations.length);
  const providerCount = useAppStore((s) => s.providers.length);
  const selectedProviderId = useAppStore((s) => s.selectedProviderId);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const appearanceMode = useAppStore((s) => s.appearanceMode);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const zoomFactor = useAppStore((s) => s.zoomFactor);
  const platform = detectDesktopPlatform();

  useEffect(() => {
    const {
      checkPinStatus,
      loadConversations,
      loadAssistants,
      loadProviders,
      loadAppearancePreferences,
      loadUiPreferences,
      loadChatSettings,
      loadImageGenConfig,
      loadSpeechSettings,
      refreshResolvedLanguage,
      setSystemTheme,
    } =
      useAppStore.getState();
    void (async () => {
      const browserPreview = readBrowserPreviewBootstrap();
      if (browserPreview && applyPreviewBootstrap(browserPreview)) {
        return;
      }

      try {
        const preview = await api.getPreviewBootstrap();
        if (applyPreviewBootstrap(preview)) {
          return;
        }
      } catch (error) {
        console.warn("Preview bootstrap unavailable:", error);
      }

      try {
        setSystemTheme(await readWindowTheme());
        await checkPinStatus();
        await loadAppearancePreferences();
        await loadUiPreferences();
        await loadChatSettings();
        await loadConversations();
        await loadAssistants();
        await loadProviders();
        await loadImageGenConfig();
        await loadSpeechSettings();
        refreshResolvedLanguage();
      } catch (error) {
        console.warn("App bootstrap unavailable outside Tauri:", error);
      }
    })();
  }, []);

  useEffect(() => {
    const browserPreview = readBrowserPreviewBootstrap();
    if (!browserPreview) {
      return;
    }

    if (
      browserPreviewNeedsBootstrap(browserPreview, {
        view,
        currentConversationId,
        conversationCount,
        providerCount,
        selectedProviderId,
        selectedModel,
        pinEnabled,
        isLocked,
      })
    ) {
      applyPreviewBootstrap(browserPreview);
    }
  }, [
    conversationCount,
    currentConversationId,
    isLocked,
    pinEnabled,
    providerCount,
    selectedModel,
    selectedProviderId,
    view,
  ]);

  useEffect(() => {
    applyDocumentAppearance(resolvedTheme, platform);
  }, [platform, resolvedTheme]);

  useEffect(() => {
    let cancelled = false;

    void readWindowTheme()
      .then((theme) => {
        if (!cancelled) {
          useAppStore.getState().setSystemTheme(theme);
        }
      })
      .catch((error) => {
        console.warn("Failed to read window theme:", error);
      });

    const cleanup = listenToWindowThemeChanges((theme) => {
      useAppStore.getState().setSystemTheme(theme);
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleLanguageChange = () => {
      useAppStore.getState().refreshResolvedLanguage();
    };

    window.addEventListener("languagechange", handleLanguageChange);

    return () => {
      window.removeEventListener("languagechange", handleLanguageChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void applyNativeAppearance(appearanceMode, resolvedTheme)
      .then(async () => {
        if (appearanceMode !== "system") {
          return;
        }

        const theme = await readWindowTheme();
        if (!cancelled) {
          useAppStore.getState().setSystemTheme(theme);
        }
      })
      .catch((error) => {
        console.warn("Failed to apply native appearance:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [appearanceMode, resolvedTheme]);

  useEffect(() => {
    void applyZoomFactor(zoomFactor).catch((error) => {
      console.warn("Failed to apply zoom factor:", error);
    });
  }, [zoomFactor]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) {
        return;
      }

      let nextZoomFactor: number | null = null;
      const { zoomFactor: currentZoomFactor, setZoomFactor } =
        useAppStore.getState();

      if (
        event.key === "=" ||
        event.key === "+" ||
        event.code === "NumpadAdd"
      ) {
        nextZoomFactor = stepZoomFactor(currentZoomFactor, 1);
      } else if (
        event.key === "-" ||
        event.key === "_" ||
        event.code === "NumpadSubtract"
      ) {
        nextZoomFactor = stepZoomFactor(currentZoomFactor, -1);
      } else if (event.key === "0" || event.code === "Numpad0") {
        nextZoomFactor = DEFAULT_ZOOM_FACTOR;
      }

      if (nextZoomFactor === null) {
        return;
      }

      event.preventDefault();
      const normalizedCurrentZoomFactor = normalizeZoomFactor(currentZoomFactor);
      const normalizedNextZoomFactor = normalizeZoomFactor(nextZoomFactor);

      if (normalizedCurrentZoomFactor === normalizedNextZoomFactor) {
        return;
      }

      void setZoomFactor(normalizedNextZoomFactor);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="app-window">
      <div className="pt-window-topbar" data-tauri-drag-region aria-hidden="true" />
      <div className="app-window__content">
        {pinEnabled && isLocked ? <PinLock /> : <AppLayout />}
      </div>
    </div>
  );
}

export default App;
