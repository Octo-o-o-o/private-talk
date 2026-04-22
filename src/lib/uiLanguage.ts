export type UiLanguage = "auto" | "zh-CN" | "en";
export type ResolvedUiLanguage = "zh-CN" | "en";

function readPreferredLocale(): string {
  if (typeof navigator === "undefined") {
    return "";
  }

  const preferredLocale =
    navigator.languages.find((locale) => locale && locale.trim()) ??
    navigator.language ??
    "";

  return preferredLocale.trim().toLowerCase();
}

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

  if (readPreferredLocale().startsWith("zh")) {
    return "zh-CN";
  }

  return "en";
}
