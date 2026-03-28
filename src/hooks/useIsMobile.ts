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
    mediaQueryList.addEventListener("change", handleChange);
  }

  // orientationchange is needed on older mobile browsers that don't fire MQL change
  window.addEventListener("orientationchange", handleChange);

  return () => {
    if (mediaQueryList) {
      mediaQueryList.removeEventListener("change", handleChange);
    }

    window.removeEventListener("orientationchange", handleChange);
  };
}

export function useIsMobile() {
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => false,
  );
}
