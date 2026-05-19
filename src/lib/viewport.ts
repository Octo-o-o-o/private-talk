const KEYBOARD_VAR = "--keyboard-inset";
const HEIGHT_VAR = "--visual-viewport-height";

function applyViewportMetrics(
  root: HTMLElement,
  visualHeight: number,
  keyboardInset: number,
  source: "web" | "native" | null,
): void {
  // The CSS rule `#root { height: var(--visual-viewport-height, 100%) }`
  // anchors the layout-sensitive root box to the *visual* viewport. This is
  // the value we trust even on iOS WKWebView, which has shipped a
  // visualViewport API in lockstep with desktop Safari since iOS 13. We avoid
  // chaining `calc(100% - inset)` because iOS 26 also shrinks the layout
  // viewport when the keyboard appears, so any subtraction on top of `100%`
  // double-counts and collapses the root.
  root.style.setProperty(HEIGHT_VAR, `${visualHeight}px`);
  root.style.setProperty(KEYBOARD_VAR, `${keyboardInset}px`);

  // Boolean presence attribute — only set when the keyboard is up. CSS that
  // uses `html[data-keyboard-visible]` shouldn't match when it's down.
  if (keyboardInset > 0) {
    if (root.dataset.keyboardVisible !== "") {
      root.dataset.keyboardVisible = "";
    }
    if (source && root.dataset.keyboardSource !== source) {
      root.dataset.keyboardSource = source;
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
    const visualHeight = viewport?.height ?? window.innerHeight;
    const offsetTop = viewport?.offsetTop ?? 0;
    const layoutHeight = window.innerHeight;
    // The browser-reported keyboard intrusion. On iOS WKWebView the layout
    // viewport also collapses around the keyboard, so this number trends
    // toward zero — the visualHeight write above is the one that actually
    // pulls the compose bar up. We still write the inset so other elements
    // (margins, paddings) can opt in if they want a numeric height.
    const keyboardInset = Math.max(0, layoutHeight - visualHeight - offsetTop);

    // If the iOS native bridge has already claimed ownership of the inset,
    // respect its value (it can read the AVKeyboard frame more accurately
    // than visualViewport during transitions). Otherwise stamp ourselves.
    const nativeOwned =
      root.dataset.keyboardSource === "native" &&
      root.dataset.keyboardVisible !== undefined;

    if (nativeOwned) {
      // Native bridge maintains keyboard-inset + data-keyboard-visible;
      // we only refresh the visual viewport height so #root sizes correctly.
      root.style.setProperty(HEIGHT_VAR, `${visualHeight}px`);
      return;
    }

    applyViewportMetrics(root, visualHeight, keyboardInset, "web");
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
