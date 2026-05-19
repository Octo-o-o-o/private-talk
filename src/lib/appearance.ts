import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type AppearanceMode = "system" | "dark" | "light";
export type ResolvedAppearanceTheme = "dark" | "light";
export type DesktopPlatform = "macos" | "windows" | "linux" | "unknown";
export type Platform = DesktopPlatform | "ios" | "android";
type Unlisten = () => void;

export const DEFAULT_APPEARANCE_MODE: AppearanceMode = "dark";
export const DEFAULT_ZOOM_FACTOR = 1;
export const MIN_ZOOM_FACTOR = 0.8;
export const MAX_ZOOM_FACTOR = 2;
export const DEFAULT_SYSTEM_TEXT_SCALE = 1;
export const MIN_SYSTEM_TEXT_SCALE = 0.5;
export const MAX_SYSTEM_TEXT_SCALE = 3;
const ZOOM_STEP = 0.1;
const LIGHT_NATIVE_BACKGROUND = "#fcfaf5";
const DARK_NATIVE_BACKGROUND = "#050506";
const SYSTEM_TEXT_SCALE_PROBE_ID = "pt-system-text-scale-probe";
const IOS_DYNAMIC_TYPE_BASE_PX = 17;
const REM_BASE_PX = 16;

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

export function normalizeSystemTextScale(
  value: number | string | null | undefined,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat((value ?? "").trim());

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SYSTEM_TEXT_SCALE;
  }

  return Number.parseFloat(
    Math.min(
      MAX_SYSTEM_TEXT_SCALE,
      Math.max(MIN_SYSTEM_TEXT_SCALE, parsed),
    ).toFixed(3),
  );
}

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  const ua = (navigator.userAgent ?? "").toLowerCase();
  const uaData = (navigator as Navigator & {
    userAgentData?: { platform?: string; mobile?: boolean };
  }).userAgentData;
  const rawPlatform = (
    uaData?.platform ??
    navigator.platform ??
    navigator.userAgent
  ).toLowerCase();
  const maxTouchPoints =
    typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints : 0;

  if (ua.includes("android")) {
    return "android";
  }

  if (/iphone|ipod/.test(ua) || rawPlatform.includes("iphone")) {
    return "ios";
  }

  if (
    /ipad/.test(ua) ||
    rawPlatform.includes("ipad") ||
    (rawPlatform.includes("mac") && maxTouchPoints > 1)
  ) {
    return "ios";
  }

  if (rawPlatform.includes("mac")) {
    return "macos";
  }

  if (rawPlatform.includes("win")) {
    return "windows";
  }

  if (rawPlatform.includes("linux")) {
    return "linux";
  }

  return "unknown";
}

export function isDesktopPlatform(
  platform: Platform,
): platform is "macos" | "windows" | "linux" {
  return (
    platform === "macos" ||
    platform === "windows" ||
    platform === "linux"
  );
}

export function isMobilePlatform(platform: Platform): boolean {
  return platform === "ios" || platform === "android";
}

export function detectDesktopPlatform(): DesktopPlatform {
  const platform = detectPlatform();
  return isDesktopPlatform(platform) ? platform : "unknown";
}

export function applyDocumentAppearance(
  theme: ResolvedAppearanceTheme,
  platform: Platform,
): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.platform = platform;
  root.dataset.platformKind = isMobilePlatform(platform)
    ? "mobile"
    : isDesktopPlatform(platform)
      ? "desktop"
      : "unknown";
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

export async function applyZoomFactor(
  zoomFactor: number,
  options?: { platform?: Platform; systemTextScale?: number },
): Promise<void> {
  const nextZoomFactor = normalizeZoomFactor(zoomFactor);
  const platform = options?.platform ?? detectPlatform();
  const systemTextScale = normalizeSystemTextScale(
    options?.systemTextScale ?? DEFAULT_SYSTEM_TEXT_SCALE,
  );
  const effective = nextZoomFactor * systemTextScale;
  const root = typeof document !== "undefined" ? document.documentElement : null;

  if (root) {
    root.style.setProperty("--ui-scale", effective.toFixed(3));
    root.style.setProperty("--ui-zoom-base", nextZoomFactor.toFixed(3));
    root.style.setProperty(
      "--ui-system-text-scale",
      systemTextScale.toFixed(3),
    );
  }

  const onDesktopTauri = isTauri() && isDesktopPlatform(platform);

  if (onDesktopTauri) {
    try {
      await getCurrentWebview().setZoom(effective);
      if (root) {
        root.dataset.zoomMode = "native";
      }
      return;
    } catch (error) {
      console.warn(
        "Native webview.setZoom failed; falling back to CSS zoom:",
        error,
      );
    }
  }

  if (root) {
    root.dataset.zoomMode = "css";
  }
}

function getProbeContainer(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  let probe = document.getElementById(SYSTEM_TEXT_SCALE_PROBE_ID);
  if (!probe) {
    probe = document.createElement("div");
    probe.id = SYSTEM_TEXT_SCALE_PROBE_ID;
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "pointer-events:none",
      "visibility:hidden",
      "contain:strict",
      "width:0",
      "height:0",
      "overflow:hidden",
      // Reset any inherited zoom so the probe sees the device-pixel value.
      "zoom:1",
    ].join(";");

    const apple = document.createElement("span");
    apple.dataset.kind = "apple-system-body";
    // `font` shorthand sets size + family explicitly, so the measurement is
    // immune to the root `font-size: 14px` baseline we apply elsewhere.
    apple.style.font = "-apple-system-body";
    probe.appendChild(apple);

    const android = document.createElement("span");
    android.dataset.kind = "android-px";
    // Use an absolute px so Android WebView's `textZoom` (which scales px-based
    // fonts) shows up as a delta from the requested value.
    android.style.fontSize = `${REM_BASE_PX}px`;
    probe.appendChild(android);

    if (document.body) {
      document.body.appendChild(probe);
    } else {
      // Defer until <body> exists, in case appearance bootstraps very early.
      const attach = () => {
        if (document.body && !document.body.contains(probe!)) {
          document.body.appendChild(probe!);
        }
      };
      document.addEventListener("DOMContentLoaded", attach, { once: true });
    }
  }

  return probe;
}

export function detectSystemTextScale(
  platform: Platform = detectPlatform(),
): number {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return DEFAULT_SYSTEM_TEXT_SCALE;
  }

  const probe = getProbeContainer();
  if (!probe || !document.body || !document.body.contains(probe)) {
    return DEFAULT_SYSTEM_TEXT_SCALE;
  }

  // iOS exposes Dynamic Type through `-apple-system-body`. The default value
  // is 17px; users can shrink to ~14 or grow well past 50 via Accessibility.
  if (platform === "ios") {
    const apple = probe.querySelector<HTMLElement>(
      '[data-kind="apple-system-body"]',
    );
    if (apple) {
      const size = Number.parseFloat(window.getComputedStyle(apple).fontSize);
      if (Number.isFinite(size) && size > 0) {
        return normalizeSystemTextScale(size / IOS_DYNAMIC_TYPE_BASE_PX);
      }
    }
    return DEFAULT_SYSTEM_TEXT_SCALE;
  }

  // Android WebView scales px-based fonts by the user's "Font size" accessibility
  // setting via WebSettings#textZoom. We request 16px and measure the actual
  // computed size — when it differs from 16, the user has adjusted system fonts.
  if (platform === "android") {
    const android = probe.querySelector<HTMLElement>(
      '[data-kind="android-px"]',
    );
    if (android) {
      const size = Number.parseFloat(
        window.getComputedStyle(android).fontSize,
      );
      if (Number.isFinite(size) && size > 0) {
        return normalizeSystemTextScale(size / REM_BASE_PX);
      }
    }
  }

  return DEFAULT_SYSTEM_TEXT_SCALE;
}

export function listenSystemTextScaleChanges(
  handler: (scale: number) => void,
  platform: Platform = detectPlatform(),
): () => void {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    !isMobilePlatform(platform)
  ) {
    return () => {};
  }

  let lastScale = detectSystemTextScale(platform);

  const emit = () => {
    const next = detectSystemTextScale(platform);
    if (Math.abs(next - lastScale) > 0.005) {
      lastScale = next;
      handler(next);
    }
  };

  const handleVisibility = () => {
    if (!document.hidden) {
      emit();
    }
  };

  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("pageshow", emit);
  window.addEventListener("focus", emit);
  window.addEventListener("resize", emit);

  return () => {
    document.removeEventListener("visibilitychange", handleVisibility);
    window.removeEventListener("pageshow", emit);
    window.removeEventListener("focus", emit);
    window.removeEventListener("resize", emit);
  };
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
