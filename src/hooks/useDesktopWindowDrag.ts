import { useCallback, useEffect, useMemo, useRef, type HTMLAttributes, type MouseEvent as ReactMouseEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useIsMobile } from "./useIsMobile";

const WINDOW_DRAG_EXCLUDE_SELECTOR = [
  "[data-window-drag-exclude='true']",
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "option",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='slider']",
  "[role='combobox']",
  "[contenteditable='true']",
  "[draggable='true']",
  "[data-slot='dropdown-menu-trigger']",
  "[data-slot='select-trigger']",
  "[data-slot='slider']",
].join(", ");

const DRAG_THRESHOLD_PX = 4;

export const windowDragExcludeProps = {
  "data-window-drag-exclude": "true",
} as const;

type WindowDragSurfaceProps = Pick<
  HTMLAttributes<HTMLElement>,
  "onMouseDownCapture" | "onDoubleClickCapture"
> & {
  "data-window-drag-surface": "true";
};

function shouldIgnoreWindowDrag(target: EventTarget | null) {
  return target instanceof Element && target.closest(WINDOW_DRAG_EXCLUDE_SELECTOR) !== null;
}

export function useDesktopWindowDrag(): WindowDragSurfaceProps {
  const isMobile = useIsMobile();
  const appWindow = useMemo(() => {
    if (isMobile || typeof window === "undefined" || !isTauri()) {
      return null;
    }
    return getCurrentWindow();
  }, [isMobile]);

  const pendingDragRef = useRef<{ x: number; y: number } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const clearPendingDrag = useCallback(() => {
    pendingDragRef.current = null;
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  useEffect(() => clearPendingDrag, [clearPendingDrag]);

  const onMouseDownCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!appWindow) return;
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (shouldIgnoreWindowDrag(event.target)) return;

    clearPendingDrag();
    pendingDragRef.current = { x: event.clientX, y: event.clientY };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const pendingDrag = pendingDragRef.current;
      if (!pendingDrag) return;

      const deltaX = moveEvent.clientX - pendingDrag.x;
      const deltaY = moveEvent.clientY - pendingDrag.y;
      if (Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) return;

      clearPendingDrag();
      void Promise.resolve(appWindow.startDragging()).catch(() => {});
    };

    const handleMouseUp = () => {
      clearPendingDrag();
    };

    const handleWindowBlur = () => {
      clearPendingDrag();
    };

    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", handleMouseUp, true);
    window.addEventListener("blur", handleWindowBlur);

    cleanupRef.current = () => {
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [appWindow, clearPendingDrag]);

  const onDoubleClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!appWindow) return;
    if (event.defaultPrevented || event.button !== 0) return;
    if (shouldIgnoreWindowDrag(event.target)) return;

    clearPendingDrag();
    void Promise.resolve(appWindow.toggleMaximize()).catch(() => {});
  }, [appWindow, clearPendingDrag]);

  return {
    "data-window-drag-surface": "true",
    onMouseDownCapture,
    onDoubleClickCapture,
  };
}
