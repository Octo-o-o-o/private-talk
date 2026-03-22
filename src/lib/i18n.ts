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

  return {
    language,
    isZh,
    locale: isZh ? "zh-CN" : "en-US",
    t,
    setLanguage,
    toggleLanguage,
    zoom,
    resetZoom,
  };
}
