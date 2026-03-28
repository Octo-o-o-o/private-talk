import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useViewportCssVars } from "@/hooks/useViewportCssVars";

type ViewportListener = () => void;

describe("useViewportCssVars", () => {
  let viewportListeners: Record<string, ViewportListener | undefined>;
  let viewport: {
    height: number;
    offsetTop: number;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };
  let scheduledFrame: FrameRequestCallback | null;

  const flushAnimationFrame = () => {
    const callback = scheduledFrame;
    scheduledFrame = null;
    callback?.(0);
  };

  beforeEach(() => {
    viewportListeners = {};
    scheduledFrame = null;
    viewport = {
      height: 700,
      offsetTop: 200,
      addEventListener: vi.fn((event: string, listener: ViewportListener) => {
        viewportListeners[event] = listener;
      }),
      removeEventListener: vi.fn((event: string) => {
        delete viewportListeners[event];
      }),
    };

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    });

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      scheduledFrame = callback;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  });

  it("syncs CSS variables on mount using the tallest viewport value", () => {
    renderHook(() => useViewportCssVars());

    flushAnimationFrame();

    expect(
      document.documentElement.style.getPropertyValue("--app-layout-height")
    ).toBe("900px");
  });

  it("updates CSS variables after viewport changes", () => {
    renderHook(() => useViewportCssVars());
    flushAnimationFrame();

    viewport.height = 500;
    viewport.offsetTop = 50;

    act(() => {
      viewportListeners.resize?.();
    });
    flushAnimationFrame();

    expect(
      document.documentElement.style.getPropertyValue("--app-layout-height")
    ).toBe("800px");
  });
});
