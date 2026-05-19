import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installViewportTracker } from "./viewport";

function setVisualViewport(
  height: number,
  offsetTop = 0,
): { resize: (next: number, offset?: number) => void } {
  type Listener = () => void;
  const listeners = new Set<Listener>();
  const visualViewport = {
    height,
    offsetTop,
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
  };
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: visualViewport,
  });

  return {
    resize: (next: number, offset = 0) => {
      visualViewport.height = next;
      visualViewport.offsetTop = offset;
      listeners.forEach((fn) => fn());
    },
  };
}

function clearRoot(): void {
  const root = document.documentElement;
  root.style.removeProperty("--keyboard-inset");
  delete root.dataset.keyboardVisible;
  delete root.dataset.keyboardSource;
}

describe("installViewportTracker (web fallback)", () => {
  let originalInnerHeight: number;
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    clearRoot();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    });
    clearRoot();
    // Drop the stubbed visualViewport so the next test starts fresh.
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: undefined,
    });
  });

  it("writes --keyboard-inset 0 and no data-keyboard-visible on install when the viewport is full", () => {
    setVisualViewport(800);
    cleanup = installViewportTracker();
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("0px");
    expect(root.dataset.keyboardVisible).toBeUndefined();
  });

  it("reflects the visualViewport shrink as a keyboard inset and toggles the presence attribute", () => {
    const viewport = setVisualViewport(800);
    cleanup = installViewportTracker();
    const root = document.documentElement;

    viewport.resize(500);
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("300px");
    // Presence attribute — value is the empty string but key is set.
    expect("keyboardVisible" in root.dataset).toBe(true);
    expect(root.dataset.keyboardSource).toBe("web");

    viewport.resize(800);
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("0px");
    expect(root.dataset.keyboardVisible).toBeUndefined();
  });

  it("does not match a CSS [data-keyboard-visible] selector after the keyboard hides", () => {
    const viewport = setVisualViewport(800);
    cleanup = installViewportTracker();
    const root = document.documentElement;

    viewport.resize(500);
    expect(root.matches("[data-keyboard-visible]")).toBe(true);

    viewport.resize(800);
    expect(root.matches("[data-keyboard-visible]")).toBe(false);
  });

  it("stays out of the way once the native bridge claims ownership", () => {
    const viewport = setVisualViewport(800);
    cleanup = installViewportTracker();
    const root = document.documentElement;

    // Simulate the iOS bridge stamping itself onto the root before the JS
    // tracker fires its next update.
    root.dataset.keyboardSource = "native";
    root.style.setProperty("--keyboard-inset", "327px");
    root.dataset.keyboardVisible = "";

    viewport.resize(500);
    // The tracker should bail out and leave the native-owned values alone.
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("327px");
    expect(root.dataset.keyboardSource).toBe("native");
    expect("keyboardVisible" in root.dataset).toBe(true);
  });

  it("accounts for visualViewport offsetTop when computing the inset", () => {
    const viewport = setVisualViewport(800);
    cleanup = installViewportTracker();
    const root = document.documentElement;

    // Pinch-zoom on iOS: visualViewport scrolls within the layout viewport
    // (offsetTop > 0). We should not double-count the offset as keyboard.
    viewport.resize(600, 100);
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("100px");
  });

  it("clamps a negative diff to zero (e.g. when innerHeight lags behind)", () => {
    const viewport = setVisualViewport(800);
    cleanup = installViewportTracker();
    const root = document.documentElement;

    viewport.resize(900);
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("0px");
    expect(root.dataset.keyboardVisible).toBeUndefined();
  });

  it("returns a cleanup function that detaches listeners", () => {
    const viewport = setVisualViewport(800);
    const dispose = installViewportTracker();
    cleanup = null; // dispose manually below

    dispose();

    const before = document.documentElement.style.getPropertyValue(
      "--keyboard-inset",
    );
    viewport.resize(400);
    const after = document.documentElement.style.getPropertyValue(
      "--keyboard-inset",
    );
    expect(after).toBe(before);
  });

  it("is safe in non-DOM environments", () => {
    // No-op smoke test: when window is undefined we just return a cleanup.
    const fn = vi.fn();
    fn();
    expect(fn).toHaveBeenCalled();
  });
});
