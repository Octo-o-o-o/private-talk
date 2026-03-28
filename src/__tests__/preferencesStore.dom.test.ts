import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePreferencesStore } from "@/stores/preferencesStore";

const mockedInvoke = vi.mocked(invoke);
const mockedGetCurrentWebview = vi.mocked(getCurrentWebview);
const initialPreferencesState = usePreferencesStore.getState();

function resetPreferencesStore() {
  usePreferencesStore.setState({
    ...initialPreferencesState,
    initialized: false,
    hydrating: false,
    language: "zh-CN",
    themeMode: "system",
    resolvedTheme: "dark",
    zoom: 1,
  });
  document.documentElement.lang = "";
  document.documentElement.className = "";
  document.documentElement.dataset.themeMode = "";
  document.documentElement.dataset.theme = "";
  document.documentElement.style.colorScheme = "";
  document.documentElement.style.fontSize = "";
  localStorage.clear();
}

describe("preferencesStore DOM side effects", () => {
  beforeEach(() => {
    resetPreferencesStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies language, theme, and zoom side effects during initialization", async () => {
    mockedInvoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command !== "get_setting") return null;

      const key = (args as Record<string, unknown> | undefined)?.key;
      if (key === "ui_language") return "en-US";
      if (key === "ui_zoom") return "1.25";
      if (key === "ui_theme_mode") return "dark";
      return null;
    });

    await usePreferencesStore.getState().initPreferences();

    expect(document.documentElement.lang).toBe("en-US");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.themeMode).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(localStorage.getItem("private-talk-ui-theme-mode")).toBe("dark");
    expect(usePreferencesStore.getState().zoom).toBe(1.25);
  });

  it("falls back to the locally stored theme when backend theme settings are missing", async () => {
    localStorage.setItem("private-talk-ui-theme-mode", "light");
    mockedInvoke.mockResolvedValue(null);

    await usePreferencesStore.getState().initPreferences();

    expect(usePreferencesStore.getState().themeMode).toBe("light");
    expect(usePreferencesStore.getState().resolvedTheme).toBe("light");
    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("syncs with system theme changes only when the theme mode is system", () => {
    const matchMedia = vi.fn(() => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia,
    });

    usePreferencesStore.setState({
      themeMode: "system",
      resolvedTheme: "dark",
    });
    usePreferencesStore.getState().syncThemeWithSystem();

    expect(usePreferencesStore.getState().resolvedTheme).toBe("light");

    usePreferencesStore.setState({
      themeMode: "light",
      resolvedTheme: "light",
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        media: "(prefers-color-scheme: dark)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
    usePreferencesStore.getState().syncThemeWithSystem();

    expect(usePreferencesStore.getState().resolvedTheme).toBe("light");
  });

  it("falls back to root font scaling when the Tauri zoom API is unavailable", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    mockedGetCurrentWebview.mockReturnValue({
      setZoom: vi.fn().mockRejectedValue(new Error("webview unavailable")),
    } as never);

    await usePreferencesStore.getState().setZoom(1.3);

    expect(document.documentElement.style.fontSize).toBe("130%");
  });
});
