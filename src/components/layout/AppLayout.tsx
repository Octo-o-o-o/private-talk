import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useAppStore } from "@/stores/appStore";

export function AppLayout() {
  const isMobile = useIsMobile();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);

  // On mobile, default sidebar to closed
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, setSidebarOpen]);

  return (
    <div className="flex h-full min-h-0 w-full bg-background text-foreground">
      {isMobile ? (
        <>
          {/* Backdrop */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/50 transition-opacity"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          {/* Drawer */}
          <div
            className={`fixed inset-y-0 left-0 z-50 w-72 transform transition-transform duration-200 ease-out ${
              sidebarOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <Sidebar />
          </div>
        </>
      ) : (
        <Sidebar />
      )}
      <main
        className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground"
        style={isMobile ? { paddingTop: "env(safe-area-inset-top, 0px)" } : undefined}
      >
        {!isMobile && (
          <div data-tauri-drag-region className="h-11 w-full shrink-0" />
        )}
        <div className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
