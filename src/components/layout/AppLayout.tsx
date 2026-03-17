import { Sidebar } from "./Sidebar";
import { ChatView } from "../chat/ChatView";
import { SettingsPage } from "../settings/SettingsPage";
import { useAppStore } from "../../stores/appStore";

export function AppLayout() {
  const view = useAppStore((s) => s.view);

  return (
    <div className="flex h-full bg-zinc-900 text-zinc-100">
      <Sidebar />
      <div className="flex-1 h-full overflow-hidden">
        {view === "settings" ? <SettingsPage /> : <ChatView />}
      </div>
    </div>
  );
}
