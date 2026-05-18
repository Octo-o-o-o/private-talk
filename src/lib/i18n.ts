import { useAppStore } from "../stores/appStore";

export function useI18n() {
  const locale = useAppStore((state) => state.resolvedLanguage);

  return {
    locale,
    t(zh: string, en: string): string {
      return locale === "zh-CN" ? zh : en;
    },
  };
}
