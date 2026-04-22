export type UiLanguage = "auto" | "zh-CN" | "en";
export type ResolvedUiLanguage = "zh-CN" | "en";

export function normalizeUiLanguage(value: string | null | undefined): UiLanguage {
  if (value === "zh-CN" || value === "en") {
    return value;
  }
  return "auto";
}

export function resolveUiLanguage(language: UiLanguage): ResolvedUiLanguage {
  if (language === "zh-CN" || language === "en") {
    return language;
  }

  if (typeof navigator !== "undefined") {
    const locale = navigator.language.toLowerCase();
    if (locale.startsWith("zh")) {
      return "zh-CN";
    }
  }

  return "en";
}

