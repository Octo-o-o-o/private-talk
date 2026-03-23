import { useCallback } from "react";
import { usePreferencesStore } from "@/stores/preferencesStore";

export function useI18n() {
  const language = usePreferencesStore((state) => state.language);
  const isZh = language === "zh-CN";
  const setLanguage = usePreferencesStore((state) => state.setLanguage);
  const toggleLanguage = usePreferencesStore((state) => state.toggleLanguage);
  const zoom = usePreferencesStore((state) => state.zoom);
  const resetZoom = usePreferencesStore((state) => state.resetZoom);

  const t = useCallback(
    (zh: string, en: string) => (isZh ? zh : en),
    [isZh]
  );

  /** Pick the right bilingual field value; falls back to `zh` when `en` is empty. */
  const tField = useCallback(
    (zh: string, en: string | undefined | null) =>
      en ? (isZh ? zh : en) : zh,
    [isZh]
  );

  /** Pick the right bilingual array; falls back to `zh` when `en` is empty. */
  const tArray = useCallback(
    <T,>(zh: T[], en: T[] | undefined | null) =>
      en && en.length > 0 ? (isZh ? zh : en) : zh,
    [isZh]
  );

  return {
    language,
    isZh,
    locale: isZh ? "zh-CN" : "en-US",
    t,
    tField,
    tArray,
    setLanguage,
    toggleLanguage,
    zoom,
    resetZoom,
  };
}
