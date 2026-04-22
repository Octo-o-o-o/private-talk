import { useState } from "react";
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
  const clearConversationSelection = useAppStore(
    (s) => s.clearConversationSelection,
  );
  const setView = useAppStore((s) => s.setView);

  const isPhone = layout === "phone";
  const showDetail = isPhone && (view === "settings" || !!currentConversationId);
  const showSettings = view === "settings";

  return (
    <div
      className={`app-shell${showDetail ? " is-detail-visible" : ""}`}
      data-layout={layout}
    >
      <aside className="app-sidebar-pane">
        <div className="app-panel app-panel--sidebar">
          <Sidebar
            layout={layout}
            onRequestNewConversation={() => setNewConversationPickerOpen(true)}
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
                onOpenSettings={() => setView("settings")}
                onRequestNewConversation={() => setNewConversationPickerOpen(true)}
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
