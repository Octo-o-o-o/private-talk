const KEYBOARD_VAR = "--keyboard-inset";

function hasNativeKeyboardBridge(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  // The iOS bridge stamps "native" on the root once it pushes its first
  // measurement. From that point on we step aside and let it own the inset.
  return document.documentElement.dataset.keyboardSource === "native";
}

function applyKeyboardInset(root: HTMLElement, keyboardInset: number): void {
  root.style.setProperty(KEYBOARD_VAR, `${keyboardInset}px`);
  // Boolean *presence* attribute — only set when the keyboard is up. CSS that
  // uses `html[data-keyboard-visible]` shouldn't match when it's down.
  if (keyboardInset > 0) {
    if (root.dataset.keyboardVisible !== "") {
      root.dataset.keyboardVisible = "";
    }
    if (root.dataset.keyboardSource !== "web") {
      root.dataset.keyboardSource = "web";
    }
  } else {
    delete root.dataset.keyboardVisible;
  }
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
    // visualViewport.height shrinks by the keyboard intrusion on Chromium /
    // Firefox / modern Safari; the diff is the inset that the UI needs to
    // reserve at the bottom.
    const keyboardInset = Math.max(0, layoutHeight - height - offsetTop);
    applyKeyboardInset(root, keyboardInset);
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
