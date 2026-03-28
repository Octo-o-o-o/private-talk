import { useEffect } from "react";

export function useViewportCssVars() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const root = document.documentElement;
    const viewport = window.visualViewport;
    let animationFrameId = 0;

    const syncViewportCssVars = () => {
      animationFrameId = 0;

      const visualBottom = viewport
        ? Math.round(viewport.height + viewport.offsetTop)
        : Math.round(window.innerHeight);
      const layoutHeight = Math.max(Math.round(window.innerHeight), visualBottom);

      root.style.setProperty("--app-layout-height", `${layoutHeight}px`);
    };

    const scheduleViewportSync = () => {
      if (animationFrameId !== 0) return;
      animationFrameId = window.requestAnimationFrame(syncViewportCssVars);
    };

    scheduleViewportSync();

    window.addEventListener("resize", scheduleViewportSync);
    window.addEventListener("orientationchange", scheduleViewportSync);
    viewport?.addEventListener("resize", scheduleViewportSync);
    viewport?.addEventListener("scroll", scheduleViewportSync);

    return () => {
      window.removeEventListener("resize", scheduleViewportSync);
      window.removeEventListener("orientationchange", scheduleViewportSync);
      viewport?.removeEventListener("resize", scheduleViewportSync);
      viewport?.removeEventListener("scroll", scheduleViewportSync);

      if (animationFrameId !== 0) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, []);
}
