import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsMobile } from "@/hooks/useIsMobile";

describe("useIsMobile", () => {
  let matchMediaListeners: Map<string, Set<() => void>>;
  let matchMediaResult: boolean;

  beforeEach(() => {
    matchMediaListeners = new Map();
    matchMediaResult = false;

    // Mock matchMedia
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn((query: string) => {
        if (!matchMediaListeners.has(query)) {
          matchMediaListeners.set(query, new Set());
        }
        return {
          matches: matchMediaResult,
          media: query,
          addEventListener: vi.fn((_: string, cb: () => void) => {
            matchMediaListeners.get(query)!.add(cb);
          }),
          removeEventListener: vi.fn((_: string, cb: () => void) => {
            matchMediaListeners.get(query)!.delete(cb);
          }),
          addListener: vi.fn(),
          removeListener: vi.fn(),
        };
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return false for desktop viewport", () => {
    matchMediaResult = false;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("should return true for mobile viewport", () => {
    matchMediaResult = true;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("should respond to resize events", () => {
    matchMediaResult = false;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    // Simulate viewport change to mobile
    matchMediaResult = true;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(true);
  });

  it("should fall back to legacy media query listeners when addEventListener is unavailable", () => {
    const addListener = vi.fn((cb: () => void) => {
      matchMediaListeners.get("(max-width: 767px)")!.add(cb);
    });
    const removeListener = vi.fn((cb: () => void) => {
      matchMediaListeners.get("(max-width: 767px)")!.delete(cb);
    });

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn((query: string) => {
        if (!matchMediaListeners.has(query)) {
          matchMediaListeners.set(query, new Set());
        }
        return {
          matches: matchMediaResult,
          media: query,
          addEventListener: undefined,
          removeEventListener: undefined,
          addListener,
          removeListener,
        };
      }),
    });

    const { result, unmount } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    expect(addListener).toHaveBeenCalledTimes(1);

    matchMediaResult = true;
    act(() => {
      for (const listener of matchMediaListeners.get("(max-width: 767px)") ?? []) {
        listener();
      }
    });
    expect(result.current).toBe(true);

    unmount();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
