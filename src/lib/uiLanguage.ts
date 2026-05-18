export type UiLanguage = "auto" | "zh-CN" | "en";
export type ResolvedUiLanguage = "zh-CN" | "en";

function readPreferredLocale(): string {
  if (typeof navigator === "undefined") {
    return "";
  }

  const preferred =
    navigator.languages.find((locale) => locale && locale.trim()) ??
    navigator.language ??
    "";

  return preferred.trim().toLowerCase();
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

  return readPreferredLocale().startsWith("zh") ? "zh-CN" : "en";
}
