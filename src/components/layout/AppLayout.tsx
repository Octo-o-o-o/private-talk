import { useState } from "react";
import { getProvidersForPurpose } from "../../lib/providerModels";
import { useAppStore } from "../../stores/appStore";
import { ChatView } from "../chat/ChatView";
import { NewConversationPicker } from "./NewConversationPicker";
import { SettingsPage } from "../settings/SettingsPage";
import { Sidebar } from "./Sidebar";
import { useLayoutMode } from "./useLayoutMode";

export function AppLayout() {
  const [newConversationPickerOpen, setNewConversationPickerOpen] = useState(false);
  const layout = useLayoutMode();
  const view = useAppStore((s) => s.view);
  const currentConversationId = useAppStore((s) => s.currentConversationId);
  const providers = useAppStore((s) => s.providers);
  const providerModelRegistry = useAppStore((s) => s.providerModelRegistry);
  const clearConversationSelection = useAppStore(
    (s) => s.clearConversationSelection,
  );
  const createConversation = useAppStore((s) => s.createConversation);
  const setView = useAppStore((s) => s.setView);
  const openSettings = useAppStore((s) => s.openSettings);

  const isPhone = layout === "phone";
  const showDetail = isPhone && (view === "settings" || !!currentConversationId);
  const showSettings = view === "settings";
  const hasTextProviders =
    getProvidersForPurpose(providers, providerModelRegistry, "chat").length > 0;

  function handleRequestNewConversation(): void {
    if (!hasTextProviders) {
      openSettings("models", providers.length === 0 ? "create-provider" : "repair-chat");
      return;
    }

    if (isPhone) {
      void createConversation(null);
      return;
    }

    setNewConversationPickerOpen(true);
  }

  return (
    <div
      className={`app-shell${showDetail ? " is-detail-visible" : ""}`}
      data-layout={layout}
    >
      <aside className="app-sidebar-pane">
        <div className="app-panel app-panel--sidebar">
          <Sidebar
            layout={layout}
            onRequestNewConversation={handleRequestNewConversation}
          />
        </div>
      </aside>

      <main className="app-main-pane">
        <div className="app-panel app-panel--main">
          <div className="app-view-stack">
            <section
              className={`app-view-layer${showSettings ? "" : " is-active"}`}
              aria-hidden={showSettings}
            >
              <ChatView
                layout={layout}
                onBack={clearConversationSelection}
                onOpenSettings={() => openSettings()}
                onRequestNewConversation={handleRequestNewConversation}
              />
            </section>

            <section
              className={`app-view-layer${showSettings ? " is-active" : ""}`}
              aria-hidden={!showSettings}
            >
              <SettingsPage
                layout={layout}
                onBack={() => setView("chat")}
              />
            </section>
          </div>
        </div>
      </main>

      <NewConversationPicker
        open={newConversationPickerOpen}
        layout={layout}
        onClose={() => setNewConversationPickerOpen(false)}
      />
    </div>
  );
}
