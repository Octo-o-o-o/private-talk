import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { usePreferencesStore } from "@/stores/preferencesStore";

const mockedInvoke = vi.mocked(invoke);

// Reset store between tests
function resetStore() {
  usePreferencesStore.setState({
    initialized: false,
    hydrating: false,
    language: "zh-CN",
    themeMode: "system",
    resolvedTheme: "dark",
    zoom: 1,
  });
}

describe("preferencesStore", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  describe("initPreferences", () => {
    it("should hydrate from saved settings", async () => {
      mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
        const key = (args as Record<string, unknown> | undefined)?.key as string;
        if (cmd === "get_setting") {
          if (key === "ui_language") return "en-US";
          if (key === "ui_zoom") return "1.5";
          if (key === "ui_theme_mode") return "light";
        }
        return null;
      });

      await usePreferencesStore.getState().initPreferences();
      const state = usePreferencesStore.getState();

      expect(state.initialized).toBe(true);
      expect(state.hydrating).toBe(false);
      expect(state.language).toBe("en-US");
      expect(state.zoom).toBe(1.5);
      expect(state.themeMode).toBe("light");
      expect(state.resolvedTheme).toBe("light");
    });

    it("should use defaults when settings are missing", async () => {
      mockedInvoke.mockResolvedValue(null);

      await usePreferencesStore.getState().initPreferences();
      const state = usePreferencesStore.getState();

      expect(state.initialized).toBe(true);
      expect(state.zoom).toBe(1);
    });

    it("should not re-initialize if already initialized", async () => {
      usePreferencesStore.setState({ initialized: true });
      mockedInvoke.mockResolvedValue(null);

      await usePreferencesStore.getState().initPreferences();

      expect(mockedInvoke).not.toHaveBeenCalled();
    });

    it("should clamp zoom value within bounds", async () => {
      mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
        const key = (args as Record<string, unknown> | undefined)?.key as string;
        if (cmd === "get_setting" && key === "ui_zoom") return "10";
        return null;
      });

      await usePreferencesStore.getState().initPreferences();
      expect(usePreferencesStore.getState().zoom).toBe(2); // max is 2
    });

    it("should handle backend errors gracefully", async () => {
      mockedInvoke.mockRejectedValue(new Error("db error"));

      await usePreferencesStore.getState().initPreferences();
      const state = usePreferencesStore.getState();

      expect(state.initialized).toBe(true);
      expect(state.zoom).toBe(1);
    });
  });

  describe("setLanguage", () => {
    it("should update language and persist", async () => {
      mockedInvoke.mockResolvedValue(undefined);

      await usePreferencesStore.getState().setLanguage("en-US");

      expect(usePreferencesStore.getState().language).toBe("en-US");
      expect(mockedInvoke).toHaveBeenCalledWith("set_setting", {
        key: "ui_language",
        value: "en-US",
      });
    });
  });

  describe("toggleLanguage", () => {
    it("should toggle from zh-CN to en-US", async () => {
      usePreferencesStore.setState({ language: "zh-CN" });
      mockedInvoke.mockResolvedValue(undefined);

      await usePreferencesStore.getState().toggleLanguage();

      expect(usePreferencesStore.getState().language).toBe("en-US");
    });

    it("should toggle from en-US to zh-CN", async () => {
      usePreferencesStore.setState({ language: "en-US" });
      mockedInvoke.mockResolvedValue(undefined);

      await usePreferencesStore.getState().toggleLanguage();

      expect(usePreferencesStore.getState().language).toBe("zh-CN");
    });
  });

  describe("setThemeMode", () => {
    it("should set light theme", async () => {
      mockedInvoke.mockResolvedValue(undefined);

      await usePreferencesStore.getState().setThemeMode("light");

      const state = usePreferencesStore.getState();
      expect(state.themeMode).toBe("light");
      expect(state.resolvedTheme).toBe("light");
    });

    it("should set dark theme", async () => {
      mockedInvoke.mockResolvedValue(undefined);

      await usePreferencesStore.getState().setThemeMode("dark");

      const state = usePreferencesStore.getState();
      expect(state.themeMode).toBe("dark");
      expect(state.resolvedTheme).toBe("dark");
    });
  });

  describe("zoom", () => {
    it("should clamp zoom to minimum 0.8", async () => {
      mockedInvoke.mockResolvedValue(undefined);

      await usePreferencesStore.getState().setZoom(0.1);

      expect(usePreferencesStore.getState().zoom).toBe(0.8);
    });

    it("should clamp zoom to maximum 2", async () => {
      mockedInvoke.mockResolvedValue(undefined);

      await usePreferencesStore.getState().setZoom(5);

      expect(usePreferencesStore.getState().zoom).toBe(2);
    });

    it("should adjust zoom by delta", async () => {
      usePreferencesStore.setState({ zoom: 1 });
      mockedInvoke.mockResolvedValue(undefined);

      await usePreferencesStore.getState().adjustZoom(0.1);

      expect(usePreferencesStore.getState().zoom).toBe(1.1);
    });

    it("should not adjust zoom if result is same (already at limit)", async () => {
      usePreferencesStore.setState({ zoom: 2 });
      mockedInvoke.mockResolvedValue(undefined);

      await usePreferencesStore.getState().adjustZoom(0.1);

      // zoom stays at 2, no invoke called for set_setting
      expect(usePreferencesStore.getState().zoom).toBe(2);
    });

    it("should reset zoom to 1", async () => {
      usePreferencesStore.setState({ zoom: 1.5 });
      mockedInvoke.mockResolvedValue(undefined);

      await usePreferencesStore.getState().resetZoom();

      expect(usePreferencesStore.getState().zoom).toBe(1);
    });
  });
});
