import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function AppLayout() {
  return (
    <div className="flex h-full min-h-0 w-full bg-background text-foreground">
      <Sidebar />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden text-foreground">
        <Outlet />
      </main>
    </div>
  );
}
