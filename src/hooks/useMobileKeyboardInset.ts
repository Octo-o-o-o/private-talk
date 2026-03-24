import { useEffect, useRef, useState } from "react";

function hasEditableFocus() {
  const activeElement = document.activeElement;
  if (!activeElement) return false;

  if (
    activeElement instanceof HTMLTextAreaElement ||
    activeElement instanceof HTMLInputElement
  ) {
    return true;
  }

  return activeElement instanceof HTMLElement && activeElement.isContentEditable;
}

export function useMobileKeyboardInset(enabled: boolean) {
  const [keyboardInset, setKeyboardInset] = useState(0);
  const keyboardViewportBaselineRef = useRef(0);
  const keyboardViewportWidthRef = useRef(0);
  const keyboardAnimationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setKeyboardInset(0);
      keyboardViewportBaselineRef.current = 0;
      keyboardViewportWidthRef.current = 0;
      if (keyboardAnimationFrameRef.current !== null) {
        cancelAnimationFrame(keyboardAnimationFrameRef.current);
        keyboardAnimationFrameRef.current = null;
      }
      return;
    }

    const viewport = window.visualViewport;
    if (!viewport) return;

    const threshold = 100;

    const updateKeyboardInset = () => {
      keyboardAnimationFrameRef.current = null;

      const layoutWidth = window.innerWidth;
      const currentBottom = viewport.height + viewport.offsetTop;
      const baselineHeight = Math.max(currentBottom, window.innerHeight);

      if (
        keyboardViewportWidthRef.current > 0 &&
        Math.abs(layoutWidth - keyboardViewportWidthRef.current) > 100
      ) {
        keyboardViewportBaselineRef.current = baselineHeight;
      }

      keyboardViewportWidthRef.current = layoutWidth;
      keyboardViewportBaselineRef.current = Math.max(
        keyboardViewportBaselineRef.current,
        baselineHeight
      );

      const nextInset = keyboardViewportBaselineRef.current - currentBottom;
      setKeyboardInset(
        hasEditableFocus() && nextInset > threshold ? nextInset : 0
      );
    };

    const scheduleKeyboardInsetUpdate = () => {
      if (keyboardAnimationFrameRef.current !== null) return;
      keyboardAnimationFrameRef.current = window.requestAnimationFrame(updateKeyboardInset);
    };

    scheduleKeyboardInsetUpdate();
    viewport.addEventListener("resize", scheduleKeyboardInsetUpdate);
    viewport.addEventListener("scroll", scheduleKeyboardInsetUpdate);
    window.addEventListener("resize", scheduleKeyboardInsetUpdate);
    window.addEventListener("orientationchange", scheduleKeyboardInsetUpdate);
    document.addEventListener("focusin", scheduleKeyboardInsetUpdate);
    document.addEventListener("focusout", scheduleKeyboardInsetUpdate);

    return () => {
      viewport.removeEventListener("resize", scheduleKeyboardInsetUpdate);
      viewport.removeEventListener("scroll", scheduleKeyboardInsetUpdate);
      window.removeEventListener("resize", scheduleKeyboardInsetUpdate);
      window.removeEventListener("orientationchange", scheduleKeyboardInsetUpdate);
      document.removeEventListener("focusin", scheduleKeyboardInsetUpdate);
      document.removeEventListener("focusout", scheduleKeyboardInsetUpdate);
      if (keyboardAnimationFrameRef.current !== null) {
        cancelAnimationFrame(keyboardAnimationFrameRef.current);
        keyboardAnimationFrameRef.current = null;
      }
    };
  }, [enabled]);

  return {
    keyboardInset,
    keyboardVisible: keyboardInset > 0,
  };
}
