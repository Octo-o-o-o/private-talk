import { useEffect } from "react";

function roundToDevicePixel(value: number) {
  return Math.round(value);
}

export function useViewportCssVars() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const root = document.documentElement;
    const viewport = window.visualViewport;
    let animationFrameId = 0;

    const syncViewportCssVars = () => {
      animationFrameId = 0;

      const visualBottom = viewport
        ? roundToDevicePixel(viewport.height + viewport.offsetTop)
        : roundToDevicePixel(window.innerHeight);
      const layoutHeight = Math.max(roundToDevicePixel(window.innerHeight), visualBottom);

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
