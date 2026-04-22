const HEIGHT_VAR = "--visual-viewport-height";
const KEYBOARD_VAR = "--keyboard-inset";

function hasNativeKeyboardBridge(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.documentElement.dataset.keyboardVisible !== undefined;
}

export function installViewportTracker(): () => void {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined"
  ) {
    return () => {};
  }

  const root = document.documentElement;
  const viewport = window.visualViewport;

  const update = () => {
    // iOS native bridge (keyboard_accessory.m) owns these vars when it's
    // installed — let it drive the values to avoid a fight with WKWebView's
    // own auto-scrolling on focus.
    if (hasNativeKeyboardBridge()) {
      return;
    }

    const height = viewport?.height ?? window.innerHeight;
    const offsetTop = viewport?.offsetTop ?? 0;
    const layoutHeight = window.innerHeight;
    const keyboardInset = Math.max(0, layoutHeight - height - offsetTop);

    root.style.setProperty(HEIGHT_VAR, `${height}px`);
    root.style.setProperty(KEYBOARD_VAR, `${keyboardInset}px`);
  };

  update();

  if (viewport) {
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
  }

  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);

  return () => {
    if (viewport) {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    }
    window.removeEventListener("resize", update);
    window.removeEventListener("orientationchange", update);
  };
}
