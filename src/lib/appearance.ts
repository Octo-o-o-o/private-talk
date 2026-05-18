import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type AppearanceMode = "system" | "dark" | "light";
export type ResolvedAppearanceTheme = "dark" | "light";
export type DesktopPlatform = "macos" | "windows" | "linux" | "unknown";
type Unlisten = () => void;

export const DEFAULT_APPEARANCE_MODE: AppearanceMode = "dark";
export const DEFAULT_ZOOM_FACTOR = 1;
export const MIN_ZOOM_FACTOR = 0.8;
export const MAX_ZOOM_FACTOR = 2;
const ZOOM_STEP = 0.1;
const LIGHT_NATIVE_BACKGROUND = "#fcfaf5";
const DARK_NATIVE_BACKGROUND = "#050506";

function readBrowserThemePreference(): ResolvedAppearanceTheme | null {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return null;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function normalizeAppearanceMode(
  value: string | null | undefined,
): AppearanceMode {
  switch (value) {
    case "system":
    case "light":
    case "dark":
      return value;
    default:
      return DEFAULT_APPEARANCE_MODE;
  }
}

export function normalizeZoomFactor(
  value: number | string | null | undefined,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat((value ?? "").trim());

  if (!Number.isFinite(parsed)) {
    return DEFAULT_ZOOM_FACTOR;
  }

  return Number.parseFloat(
    Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, parsed)).toFixed(2),
  );
}

export function serializeZoomFactor(zoomFactor: number): string {
  return normalizeZoomFactor(zoomFactor).toFixed(2);
}

export function resolveAppearanceTheme(
  mode: AppearanceMode,
  systemTheme: ResolvedAppearanceTheme,
): ResolvedAppearanceTheme {
  return mode === "system" ? systemTheme : mode;
}

export function stepZoomFactor(
  zoomFactor: number,
  direction: 1 | -1,
): number {
  return normalizeZoomFactor(zoomFactor + ZOOM_STEP * direction);
}

export function formatZoomLabel(zoomFactor: number): string {
  return `${Math.round(normalizeZoomFactor(zoomFactor) * 100)}%`;
}

export function detectDesktopPlatform(): DesktopPlatform {
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData;
  const platform = (
    uaData?.platform ??
    navigator.platform ??
    navigator.userAgent
  ).toLowerCase();

  if (platform.includes("mac")) {
    return "macos";
  }

  if (platform.includes("win")) {
    return "windows";
  }

  if (platform.includes("linux")) {
    return "linux";
  }

  return "unknown";
}

export function applyDocumentAppearance(
  theme: ResolvedAppearanceTheme,
  platform: DesktopPlatform,
): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.platform = platform;
  root.style.colorScheme = theme;

  const metaThemeColor = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );

  if (metaThemeColor) {
    metaThemeColor.content =
      theme === "light" ? LIGHT_NATIVE_BACKGROUND : DARK_NATIVE_BACKGROUND;
  }
}

export async function readWindowTheme(): Promise<ResolvedAppearanceTheme> {
  if (isTauri()) {
    try {
      const theme = await getCurrentWindow().theme();
      if (theme === "light" || theme === "dark") {
        return theme;
      }
    } catch (error) {
      console.warn("Failed to read native window theme:", error);
    }
  }

  return readBrowserThemePreference() ?? "light";
}

export async function applyNativeAppearance(
  mode: AppearanceMode,
  theme: ResolvedAppearanceTheme,
): Promise<void> {
  if (!isTauri()) {
    return;
  }

  const backgroundColor =
    theme === "light" ? LIGHT_NATIVE_BACKGROUND : DARK_NATIVE_BACKGROUND;

  await Promise.all([
    getCurrentWindow().setTheme(mode === "system" ? null : mode),
    getCurrentWindow().setBackgroundColor(backgroundColor),
    getCurrentWebview().setBackgroundColor(backgroundColor),
  ]);
}

export async function applyZoomFactor(zoomFactor: number): Promise<void> {
  const nextZoomFactor = normalizeZoomFactor(zoomFactor);

  if (isTauri()) {
    await getCurrentWebview().setZoom(nextZoomFactor);
    return;
  }

  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("zoom", String(nextZoomFactor));
  }
}

export function listenToWindowThemeChanges(
  handler: (theme: ResolvedAppearanceTheme) => void,
): () => void {
  let offNative: Unlisten | null = null;
  let offBrowser: Unlisten | null = null;
  let lastTheme: ResolvedAppearanceTheme | null = null;

  const emit = (theme: ResolvedAppearanceTheme) => {
    if (theme === lastTheme) {
      return;
    }

    lastTheme = theme;
    handler(theme);
  };

  if (isTauri()) {
    void getCurrentWindow()
      .onThemeChanged(({ payload }) => {
        emit(payload === "light" ? "light" : "dark");
      })
      .then((unlisten) => {
        offNative = unlisten;
      })
      .catch((error) => {
        console.warn("Failed to subscribe to theme changes:", error);
      });
  }

  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
  ) {
    const mediaQuery = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ) as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    };
    const listener = (event: MediaQueryListEvent) => {
      emit(event.matches ? "dark" : "light");
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", listener);
    } else if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(listener);
    }

    offBrowser = () => {
      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", listener);
      } else if (typeof mediaQuery.removeListener === "function") {
        mediaQuery.removeListener(listener);
      }
    };
  }

  return () => {
    offNative?.();
    offBrowser?.();
  };
}
