import { useEffect } from "react";
import { AppLayout } from "./components/layout/AppLayout";
import { PinLock } from "./components/pin/PinLock";
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

  useEffect(() => {
    const { checkPinStatus, loadConversations, loadProviders } =
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
        await checkPinStatus();
        await loadConversations();
        await loadProviders();
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
    view,
  ]);

  if (pinEnabled && isLocked) {
    return <PinLock />;
  }

  return <AppLayout />;
}

export default App;
