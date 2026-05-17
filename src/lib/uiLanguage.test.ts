import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeUiLanguage, resolveUiLanguage } from "./uiLanguage";

describe("normalizeUiLanguage", () => {
  it.each(["zh-CN", "en"] as const)("passes through valid code %s", (code) => {
    expect(normalizeUiLanguage(code)).toBe(code);
  });

  it.each(["", null, undefined, "auto", "ZH-CN", "zh", "en-US", "ja"])(
    "falls back to 'auto' for unsupported input %p",
    (value) => {
      expect(normalizeUiLanguage(value as string | null)).toBe("auto");
    },
  );
});

describe("resolveUiLanguage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns explicit language when not 'auto'", () => {
    expect(resolveUiLanguage("zh-CN")).toBe("zh-CN");
    expect(resolveUiLanguage("en")).toBe("en");
  });

  it("infers zh-CN from navigator.languages starting with 'zh'", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN", "en-US"]);
    vi.spyOn(navigator, "language", "get").mockReturnValue("zh-CN");
    expect(resolveUiLanguage("auto")).toBe("zh-CN");
  });

  it("infers zh-CN even when locale string is uppercase or includes region", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["ZH-TW"]);
    vi.spyOn(navigator, "language", "get").mockReturnValue("ZH-TW");
    expect(resolveUiLanguage("auto")).toBe("zh-CN");
  });

  it("defaults to 'en' when navigator locale is non-zh", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US", "fr"]);
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
    expect(resolveUiLanguage("auto")).toBe("en");
  });

  it("defaults to 'en' when navigator.languages is empty", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([]);
    vi.spyOn(navigator, "language", "get").mockReturnValue("");
    expect(resolveUiLanguage("auto")).toBe("en");
  });
});
