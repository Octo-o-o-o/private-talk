import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyZoomFactor,
  DEFAULT_APPEARANCE_MODE,
  DEFAULT_SYSTEM_TEXT_SCALE,
  DEFAULT_ZOOM_FACTOR,
  MAX_SYSTEM_TEXT_SCALE,
  MAX_ZOOM_FACTOR,
  MIN_SYSTEM_TEXT_SCALE,
  MIN_ZOOM_FACTOR,
  formatZoomLabel,
  isDesktopPlatform,
  isMobilePlatform,
  normalizeAppearanceMode,
  normalizeSystemTextScale,
  normalizeZoomFactor,
  resolveAppearanceTheme,
  serializeZoomFactor,
  stepZoomFactor,
} from "./appearance";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: vi.fn() }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    theme: () => Promise.resolve("dark"),
    setTheme: vi.fn(),
    setBackgroundColor: vi.fn(),
    onThemeChanged: () => Promise.resolve(() => {}),
  }),
}));

describe("normalizeAppearanceMode", () => {
  it("accepts the three valid mode strings", () => {
    expect(normalizeAppearanceMode("system")).toBe("system");
    expect(normalizeAppearanceMode("light")).toBe("light");
    expect(normalizeAppearanceMode("dark")).toBe("dark");
  });

  it.each(["", null, undefined, "auto", "DARK", "blue"])(
    "falls back to the default for unrecognized input %p",
    (value) => {
      expect(normalizeAppearanceMode(value)).toBe(DEFAULT_APPEARANCE_MODE);
    },
  );
});

describe("normalizeZoomFactor", () => {
  it("returns the default for non-finite or unparseable input", () => {
    expect(normalizeZoomFactor(null)).toBe(DEFAULT_ZOOM_FACTOR);
    expect(normalizeZoomFactor(undefined)).toBe(DEFAULT_ZOOM_FACTOR);
    expect(normalizeZoomFactor("")).toBe(DEFAULT_ZOOM_FACTOR);
    expect(normalizeZoomFactor("nope")).toBe(DEFAULT_ZOOM_FACTOR);
    expect(normalizeZoomFactor(Number.NaN)).toBe(DEFAULT_ZOOM_FACTOR);
  });

  it("clamps to [MIN, MAX] and rounds to 2 decimals", () => {
    expect(normalizeZoomFactor(0.1)).toBe(MIN_ZOOM_FACTOR);
    expect(normalizeZoomFactor(99)).toBe(MAX_ZOOM_FACTOR);
    expect(normalizeZoomFactor(1.234)).toBe(1.23);
    expect(normalizeZoomFactor("1.50000001")).toBe(1.5);
  });

  it("is idempotent for already-normalized values (prevents dirty-write loops)", () => {
    for (const value of [0.8, 1.0, 1.2, 1.5, 2.0]) {
      expect(normalizeZoomFactor(normalizeZoomFactor(value))).toBe(value);
    }
  });
});

describe("serializeZoomFactor", () => {
  it("formats to 2-decimal fixed string", () => {
    expect(serializeZoomFactor(1)).toBe("1.00");
    expect(serializeZoomFactor(1.5)).toBe("1.50");
    expect(serializeZoomFactor(0.8)).toBe("0.80");
  });

  it("normalizes before serializing", () => {
    expect(serializeZoomFactor(99)).toBe(MAX_ZOOM_FACTOR.toFixed(2));
    expect(serializeZoomFactor(0.1)).toBe(MIN_ZOOM_FACTOR.toFixed(2));
  });
});

describe("stepZoomFactor", () => {
  it("steps up by 0.1 and stays within MAX", () => {
    expect(stepZoomFactor(1, 1)).toBe(1.1);
    expect(stepZoomFactor(MAX_ZOOM_FACTOR, 1)).toBe(MAX_ZOOM_FACTOR);
  });

  it("steps down by 0.1 and stays within MIN", () => {
    expect(stepZoomFactor(1, -1)).toBe(0.9);
    expect(stepZoomFactor(MIN_ZOOM_FACTOR, -1)).toBe(MIN_ZOOM_FACTOR);
  });
});

describe("formatZoomLabel", () => {
  it("renders as integer percent", () => {
    expect(formatZoomLabel(1)).toBe("100%");
    expect(formatZoomLabel(1.5)).toBe("150%");
    expect(formatZoomLabel(0.8)).toBe("80%");
  });

  it("normalizes before formatting", () => {
    expect(formatZoomLabel(99)).toBe(`${Math.round(MAX_ZOOM_FACTOR * 100)}%`);
  });
});

describe("resolveAppearanceTheme", () => {
  it("returns the mode when explicit light/dark", () => {
    expect(resolveAppearanceTheme("light", "dark")).toBe("light");
    expect(resolveAppearanceTheme("dark", "light")).toBe("dark");
  });

  it("falls back to systemTheme when mode is system", () => {
    expect(resolveAppearanceTheme("system", "light")).toBe("light");
    expect(resolveAppearanceTheme("system", "dark")).toBe("dark");
  });
});

describe("normalizeSystemTextScale", () => {
  it("falls back to the default for non-finite or non-positive input", () => {
    expect(normalizeSystemTextScale(null)).toBe(DEFAULT_SYSTEM_TEXT_SCALE);
    expect(normalizeSystemTextScale(undefined)).toBe(DEFAULT_SYSTEM_TEXT_SCALE);
    expect(normalizeSystemTextScale("")).toBe(DEFAULT_SYSTEM_TEXT_SCALE);
    expect(normalizeSystemTextScale(Number.NaN)).toBe(DEFAULT_SYSTEM_TEXT_SCALE);
    expect(normalizeSystemTextScale(0)).toBe(DEFAULT_SYSTEM_TEXT_SCALE);
    expect(normalizeSystemTextScale(-2)).toBe(DEFAULT_SYSTEM_TEXT_SCALE);
  });

  it("clamps to [MIN, MAX] and rounds to 3 decimals", () => {
    expect(normalizeSystemTextScale(0.01)).toBe(MIN_SYSTEM_TEXT_SCALE);
    expect(normalizeSystemTextScale(10)).toBe(MAX_SYSTEM_TEXT_SCALE);
    expect(normalizeSystemTextScale(1.23456)).toBe(1.235);
  });

  it("preserves the default identity", () => {
    expect(normalizeSystemTextScale(DEFAULT_SYSTEM_TEXT_SCALE)).toBe(
      DEFAULT_SYSTEM_TEXT_SCALE,
    );
  });
});

describe("platform predicates", () => {
  it("treats macos/windows/linux as desktop", () => {
    expect(isDesktopPlatform("macos")).toBe(true);
    expect(isDesktopPlatform("windows")).toBe(true);
    expect(isDesktopPlatform("linux")).toBe(true);
    expect(isDesktopPlatform("ios")).toBe(false);
    expect(isDesktopPlatform("android")).toBe(false);
    expect(isDesktopPlatform("unknown")).toBe(false);
  });

  it("treats ios/android as mobile", () => {
    expect(isMobilePlatform("ios")).toBe(true);
    expect(isMobilePlatform("android")).toBe(true);
    expect(isMobilePlatform("macos")).toBe(false);
    expect(isMobilePlatform("unknown")).toBe(false);
  });
});

describe("applyZoomFactor (CSS fallback)", () => {
  afterEach(() => {
    const root = document.documentElement;
    root.style.removeProperty("--ui-scale");
    root.style.removeProperty("--ui-zoom-base");
    root.style.removeProperty("--ui-system-text-scale");
    delete root.dataset.zoomMode;
  });

  it("writes the CSS variables on the root in browser mode", async () => {
    await applyZoomFactor(1.2, { platform: "unknown" });
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--ui-zoom-base")).toBe("1.200");
    expect(root.style.getPropertyValue("--ui-system-text-scale")).toBe("1.000");
    expect(root.style.getPropertyValue("--ui-scale")).toBe("1.200");
    expect(root.dataset.zoomMode).toBe("css");
  });

  it("resets the scale variable at the default factor", async () => {
    await applyZoomFactor(1, { platform: "unknown" });
    expect(document.documentElement.style.getPropertyValue("--ui-scale")).toBe(
      "1.000",
    );
  });

  it("composes user zoom with the system text scale", async () => {
    await applyZoomFactor(1.1, { platform: "ios", systemTextScale: 1.2 });
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--ui-zoom-base")).toBe("1.100");
    expect(root.style.getPropertyValue("--ui-system-text-scale")).toBe("1.200");
    // 1.1 * 1.2 = 1.32, rounded to 3 decimals
    expect(root.style.getPropertyValue("--ui-scale")).toBe("1.320");
    expect(root.dataset.zoomMode).toBe("css");
  });
});
