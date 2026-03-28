import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useI18n } from "@/lib/i18n";
import { usePreferencesStore } from "@/stores/preferencesStore";

describe("useI18n", () => {
  beforeEach(() => {
    usePreferencesStore.setState({ language: "zh-CN" });
  });

  describe("t()", () => {
    it("should return Chinese when language is zh-CN", () => {
      usePreferencesStore.setState({ language: "zh-CN" });
      const { result } = renderHook(() => useI18n());

      expect(result.current.t("你好", "Hello")).toBe("你好");
    });

    it("should return English when language is en-US", () => {
      usePreferencesStore.setState({ language: "en-US" });
      const { result } = renderHook(() => useI18n());

      expect(result.current.t("你好", "Hello")).toBe("Hello");
    });
  });

  describe("tField()", () => {
    it("should return Chinese when zh-CN", () => {
      usePreferencesStore.setState({ language: "zh-CN" });
      const { result } = renderHook(() => useI18n());

      expect(result.current.tField("中文名", "English Name")).toBe("中文名");
    });

    it("should return English when en-US", () => {
      usePreferencesStore.setState({ language: "en-US" });
      const { result } = renderHook(() => useI18n());

      expect(result.current.tField("中文名", "English Name")).toBe("English Name");
    });

    it("should fallback to zh when en is null", () => {
      usePreferencesStore.setState({ language: "en-US" });
      const { result } = renderHook(() => useI18n());

      expect(result.current.tField("中文名", null)).toBe("中文名");
    });

    it("should fallback to zh when en is undefined", () => {
      usePreferencesStore.setState({ language: "en-US" });
      const { result } = renderHook(() => useI18n());

      expect(result.current.tField("中文名", undefined)).toBe("中文名");
    });

    it("should fallback to zh when en is empty string", () => {
      usePreferencesStore.setState({ language: "en-US" });
      const { result } = renderHook(() => useI18n());

      expect(result.current.tField("中文名", "")).toBe("中文名");
    });
  });

  describe("tArray()", () => {
    it("should return Chinese array when zh-CN", () => {
      usePreferencesStore.setState({ language: "zh-CN" });
      const { result } = renderHook(() => useI18n());

      expect(result.current.tArray(["甲", "乙"], ["A", "B"])).toEqual(["甲", "乙"]);
    });

    it("should return English array when en-US", () => {
      usePreferencesStore.setState({ language: "en-US" });
      const { result } = renderHook(() => useI18n());

      expect(result.current.tArray(["甲", "乙"], ["A", "B"])).toEqual(["A", "B"]);
    });

    it("should fallback to zh when en array is null", () => {
      usePreferencesStore.setState({ language: "en-US" });
      const { result } = renderHook(() => useI18n());

      expect(result.current.tArray(["甲", "乙"], null)).toEqual(["甲", "乙"]);
    });

    it("should fallback to zh when en array is empty", () => {
      usePreferencesStore.setState({ language: "en-US" });
      const { result } = renderHook(() => useI18n());

      expect(result.current.tArray(["甲", "乙"], [])).toEqual(["甲", "乙"]);
    });
  });

  describe("derived values", () => {
    it("should set isZh and locale for zh-CN", () => {
      usePreferencesStore.setState({ language: "zh-CN" });
      const { result } = renderHook(() => useI18n());

      expect(result.current.isZh).toBe(true);
      expect(result.current.locale).toBe("zh-CN");
    });

    it("should set isZh and locale for en-US", () => {
      usePreferencesStore.setState({ language: "en-US" });
      const { result } = renderHook(() => useI18n());

      expect(result.current.isZh).toBe(false);
      expect(result.current.locale).toBe("en-US");
    });
  });
});
