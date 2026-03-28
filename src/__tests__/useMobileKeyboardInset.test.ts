import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMobileKeyboardInset } from "@/hooks/useMobileKeyboardInset";

type ViewportListener = () => void;

describe("useMobileKeyboardInset", () => {
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
      height: 500,
      offsetTop: 0,
      addEventListener: vi.fn((event: string, listener: ViewportListener) => {
        viewportListeners[event] = listener;
      }),
      removeEventListener: vi.fn((event: string) => {
        delete viewportListeners[event];
      }),
    };

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
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

  it("reports a keyboard inset when an editable element is focused", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    const { result } = renderHook(() => useMobileKeyboardInset(true));

    act(() => {
      input.focus();
      document.dispatchEvent(new Event("focusin"));
      flushAnimationFrame();
    });

    expect(result.current.keyboardInset).toBe(300);
    expect(result.current.keyboardVisible).toBe(true);

    input.remove();
  });

  it("stays at zero when disabled", () => {
    const input = document.createElement("textarea");
    document.body.appendChild(input);

    const { result } = renderHook(() => useMobileKeyboardInset(false));

    act(() => {
      input.focus();
      flushAnimationFrame();
    });

    expect(result.current.keyboardInset).toBe(0);
    expect(result.current.keyboardVisible).toBe(false);

    input.remove();
  });
});
