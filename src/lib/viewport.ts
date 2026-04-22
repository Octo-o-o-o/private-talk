const HEIGHT_VAR = "--visual-viewport-height";
const KEYBOARD_VAR = "--keyboard-inset";

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
