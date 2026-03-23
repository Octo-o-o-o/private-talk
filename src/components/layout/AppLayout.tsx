import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function AppLayout() {
  return (
    <div className="flex h-full min-h-0 w-full bg-background text-foreground">
      <Sidebar />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden text-foreground">
        <div data-tauri-drag-region className="h-11 w-full shrink-0" />
        <div className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
