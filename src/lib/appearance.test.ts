import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE_MODE,
  DEFAULT_ZOOM_FACTOR,
  MAX_ZOOM_FACTOR,
  MIN_ZOOM_FACTOR,
  formatZoomLabel,
  normalizeAppearanceMode,
  normalizeZoomFactor,
  resolveAppearanceTheme,
  serializeZoomFactor,
  stepZoomFactor,
} from "./appearance";

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
