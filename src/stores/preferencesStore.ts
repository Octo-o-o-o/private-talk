import { create } from "zustand";
import * as api from "@/lib/tauri";

export type AppLanguage = "zh-CN" | "en-US";
export type AppThemeMode = "system" | "light" | "dark";
export type ResolvedAppTheme = "light" | "dark";

const DEFAULT_ZOOM = 1;
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;
const DEFAULT_THEME_MODE: AppThemeMode = "system";
const DEFAULT_THEME: ResolvedAppTheme = "dark";
const THEME_STORAGE_KEY = "private-talk-ui-theme-mode";

function getPreferredLanguage(): AppLanguage {
  if (typeof navigator === "undefined") return "zh-CN";
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function normalizeLanguage(value: string | null | undefined): AppLanguage {
  return value === "en-US" ? "en-US" : value === "zh-CN" ? "zh-CN" : getPreferredLanguage();
}

function normalizeThemeMode(value: string | null | undefined): AppThemeMode {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : DEFAULT_THEME_MODE;
}

function clampZoom(value: number): number {
  const rounded = Number(value.toFixed(2));
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rounded));
}

function applyLanguage(language: AppLanguage) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
}

function readThemeModeFromStorage(): AppThemeMode | null {
  if (typeof window === "undefined") return null;

  try {
    return normalizeThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeThemeModeToStorage(themeMode: AppThemeMode) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  } catch {
    // Ignore storage failures and keep the in-memory preference.
  }
}

function getSystemTheme(): ResolvedAppTheme | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;

  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return null;
  }
}

function resolveTheme(themeMode: AppThemeMode): ResolvedAppTheme {
  if (themeMode === "system") {
    return getSystemTheme() ?? DEFAULT_THEME;
  }

  return themeMode;
}

function applyTheme(themeMode: AppThemeMode, resolvedTheme: ResolvedAppTheme) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.classList.toggle("dark", resolvedTheme === "dark");
  root.dataset.themeMode = themeMode;
  root.dataset.theme = resolvedTheme;
  root.style.colorScheme = resolvedTheme;
}

async function applyZoom(zoom: number) {
  if (typeof document === "undefined") return;

  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(zoom);
    document.documentElement.style.fontSize = "";
  } catch {
    document.documentElement.style.fontSize = `${zoom * 100}%`;
  }
}

interface PreferencesState {
  initialized: boolean;
  hydrating: boolean;
  language: AppLanguage;
  themeMode: AppThemeMode;
  resolvedTheme: ResolvedAppTheme;
  zoom: number;
  initPreferences: () => Promise<void>;
  setLanguage: (language: AppLanguage) => Promise<void>;
  toggleLanguage: () => Promise<void>;
  setThemeMode: (themeMode: AppThemeMode) => Promise<void>;
  syncThemeWithSystem: () => void;
  setZoom: (zoom: number) => Promise<void>;
  adjustZoom: (delta: number) => Promise<void>;
  resetZoom: () => Promise<void>;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  initialized: false,
  hydrating: false,
  language: getPreferredLanguage(),
  themeMode: readThemeModeFromStorage() ?? DEFAULT_THEME_MODE,
  resolvedTheme: resolveTheme(readThemeModeFromStorage() ?? DEFAULT_THEME_MODE),
  zoom: DEFAULT_ZOOM,

  initPreferences: async () => {
    const { initialized, hydrating } = get();
    if (initialized || hydrating) return;

    set({ hydrating: true });

    try {
      const [savedLanguage, savedZoom, savedThemeMode] = await Promise.all([
        api.getSetting("ui_language").catch(() => null),
        api.getSetting("ui_zoom").catch(() => null),
        api.getSetting("ui_theme_mode").catch(() => null),
      ]);

      const language = normalizeLanguage(savedLanguage);
      const themeMode = normalizeThemeMode(savedThemeMode ?? readThemeModeFromStorage());
      const resolvedTheme = resolveTheme(themeMode);
      const zoomValue = savedZoom ? Number(savedZoom) : DEFAULT_ZOOM;
      const zoom = Number.isFinite(zoomValue) ? clampZoom(zoomValue) : DEFAULT_ZOOM;

      applyLanguage(language);
      applyTheme(themeMode, resolvedTheme);
      writeThemeModeToStorage(themeMode);
      await applyZoom(zoom);

      set({
        initialized: true,
        hydrating: false,
        language,
        themeMode,
        resolvedTheme,
        zoom,
      });
    } catch {
      const language = getPreferredLanguage();
      const themeMode = readThemeModeFromStorage() ?? DEFAULT_THEME_MODE;
      const resolvedTheme = resolveTheme(themeMode);
      applyLanguage(language);
      applyTheme(themeMode, resolvedTheme);
      writeThemeModeToStorage(themeMode);
      await applyZoom(DEFAULT_ZOOM);
      set({
        initialized: true,
        hydrating: false,
        language,
        themeMode,
        resolvedTheme,
        zoom: DEFAULT_ZOOM,
      });
    }
  },

  setLanguage: async (language) => {
    applyLanguage(language);
    set({ language });
    await api.setSetting("ui_language", language).catch(() => undefined);
  },

  toggleLanguage: async () => {
    const next = get().language === "zh-CN" ? "en-US" : "zh-CN";
    await get().setLanguage(next);
  },

  setThemeMode: async (themeMode) => {
    const resolvedTheme = resolveTheme(themeMode);
    applyTheme(themeMode, resolvedTheme);
    writeThemeModeToStorage(themeMode);
    set({ themeMode, resolvedTheme });
    await api.setSetting("ui_theme_mode", themeMode).catch(() => undefined);
  },

  syncThemeWithSystem: () => {
    if (get().themeMode !== "system") return;

    const resolvedTheme = resolveTheme("system");
    if (resolvedTheme === get().resolvedTheme) return;
    applyTheme("system", resolvedTheme);
    set({ resolvedTheme });
  },

  setZoom: async (zoom) => {
    const nextZoom = clampZoom(zoom);
    set({ zoom: nextZoom });
    await applyZoom(nextZoom);
    await api.setSetting("ui_zoom", String(nextZoom)).catch(() => undefined);
  },

  adjustZoom: async (delta) => {
    const nextZoom = clampZoom(get().zoom + delta);
    if (nextZoom === get().zoom) return;
    await get().setZoom(nextZoom);
  },

  resetZoom: async () => {
    if (get().zoom === DEFAULT_ZOOM) return;
    await get().setZoom(DEFAULT_ZOOM);
  },
}));

export const appZoomStep = ZOOM_STEP;
