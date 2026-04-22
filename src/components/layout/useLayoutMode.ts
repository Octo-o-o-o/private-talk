import { useEffect, useState } from "react";

export type LayoutMode = "phone" | "tablet" | "desktop";

export interface LayoutProfile {
  mode: LayoutMode;
}

const PHONE_MAX_WIDTH = 767;
const TABLET_MAX_WIDTH = 959;

function readLayoutMode(): LayoutMode {
  if (typeof window === "undefined") {
    return "desktop";
  }

  const width = window.innerWidth;

  if (width <= PHONE_MAX_WIDTH) {
    return "phone";
  }

  if (width <= TABLET_MAX_WIDTH) {
    return "tablet";
  }

  return "desktop";
}

export function useLayoutMode(): LayoutMode {
  return useLayoutProfile().mode;
}

export function useLayoutProfile(): LayoutProfile {
  const [profile, setProfile] = useState<LayoutProfile>(() => ({
    mode: readLayoutMode(),
  }));

  useEffect(() => {
    const update = (): void => {
      const nextMode = readLayoutMode();
      setProfile((current) =>
        current.mode === nextMode ? current : { mode: nextMode },
      );
    };

    update();
    window.addEventListener("resize", update);

    return () => {
      window.removeEventListener("resize", update);
    };
  }, []);

  return profile;
}
