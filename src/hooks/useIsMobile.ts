import { useSyncExternalStore } from "react";

const MOBILE_BREAKPOINT = 768;
const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function getMediaQueryList() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }

  return window.matchMedia(MOBILE_MEDIA_QUERY);
}

function getSnapshot() {
  return getMediaQueryList()?.matches ?? false;
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const mediaQueryList = getMediaQueryList();
  const handleChange = () => onStoreChange();

  if (mediaQueryList) {
    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", handleChange);
    } else {
      mediaQueryList.addListener(handleChange);
    }
  }

  window.addEventListener("resize", handleChange);
  window.addEventListener("orientationchange", handleChange);
  window.visualViewport?.addEventListener("resize", handleChange);

  return () => {
    if (mediaQueryList) {
      if (typeof mediaQueryList.removeEventListener === "function") {
        mediaQueryList.removeEventListener("change", handleChange);
      } else {
        mediaQueryList.removeListener(handleChange);
      }
    }

    window.removeEventListener("resize", handleChange);
    window.removeEventListener("orientationchange", handleChange);
    window.visualViewport?.removeEventListener("resize", handleChange);
  };
}

export function useIsMobile() {
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => false,
  );
}
