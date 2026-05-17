import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyPreviewBootstrap,
  browserPreviewNeedsBootstrap,
  previewSettingValue,
  readBrowserPreviewBootstrap,
} from "./preview";
import { useAppStore } from "../stores/appStore";
import type { PreviewBootstrap } from "./types";

const originalSearch = window.location.search;

function setSearch(query: string): void {
  // jsdom lets us reassign `window.location.search` directly via the Location
  // setter; this scopes the URL change to the running test.
  const url = new URL(window.location.href);
  url.search = query;
  window.history.replaceState({}, "", url.toString());
}

function resetStore(): void {
  // Replace store with a minimal known state so each test starts clean.
  useAppStore.setState(
    {
      view: "chat",
      conversations: [],
      currentConversationId: null,
      messages: [],
      isStreaming: false,
      providers: [],
      providerModelRegistry: {},
      selectedProviderId: null,
      selectedModel: null,
      pinEnabled: false,
      isLocked: false,
      uiLanguage: "auto",
    },
    false,
  );
}

beforeEach(() => {
  setSearch("");
  resetStore();
});

afterEach(() => {
  setSearch(originalSearch);
});

// ============================================================
//  readBrowserPreviewBootstrap
// ============================================================

describe("readBrowserPreviewBootstrap", () => {
  it("returns null when no preview-related query param is present", () => {
    setSearch("");
    expect(readBrowserPreviewBootstrap()).toBeNull();
  });

  it("returns null when preview-related param is empty", () => {
    setSearch("?preview=");
    expect(readBrowserPreviewBootstrap()).toBeNull();
  });

  it("accepts ?preview=, ?screen= and ?previewScreen= as the same key", () => {
    for (const param of ["preview", "screen", "previewScreen"]) {
      setSearch(`?${param}=chat`);
      const result = readBrowserPreviewBootstrap();
      expect(result).not.toBeNull();
      expect(result?.screen).toBe("chat");
    }
  });

  it("captures dataset and lang from the URL", () => {
    setSearch("?preview=chat&previewData=demo&lang=zh-CN");
    const result = readBrowserPreviewBootstrap();
    expect(result).toEqual({
      screen: "chat",
      dataset: "demo",
      lang: "zh-CN",
    });
  });

  it("falls back through dataset alias keys", () => {
    setSearch("?preview=chat&dataset=empty");
    expect(readBrowserPreviewBootstrap()?.dataset).toBe("empty");
    setSearch("?preview=chat&data=foo");
    expect(readBrowserPreviewBootstrap()?.dataset).toBe("foo");
  });

  it("falls back through locale alias key", () => {
    setSearch("?preview=chat&locale=en-US");
    expect(readBrowserPreviewBootstrap()?.lang).toBe("en-US");
  });
});

// ============================================================
//  browserPreviewNeedsBootstrap
// ============================================================

function bootstrap(overrides: Partial<PreviewBootstrap> = {}): PreviewBootstrap {
  return { screen: "chat", dataset: "demo", lang: null, ...overrides };
}

function runtime(over: Record<string, unknown> = {}) {
  return {
    view: "chat",
    currentConversationId: "c1",
    conversationCount: 3,
    providerCount: 1,
    selectedProviderId: "p1",
    selectedModel: "m1",
    pinEnabled: false,
    isLocked: false,
    ...over,
  } as Parameters<typeof browserPreviewNeedsBootstrap>[1];
}

describe("browserPreviewNeedsBootstrap", () => {
  it("returns false when the screen string is empty / whitespace", () => {
    expect(
      browserPreviewNeedsBootstrap(bootstrap({ screen: "  " }), runtime()),
    ).toBe(false);
  });

  it("chat screen: bootstrap when no current conversation, even if providers exist", () => {
    expect(
      browserPreviewNeedsBootstrap(bootstrap({ screen: "chat" }), runtime({ currentConversationId: null })),
    ).toBe(true);
  });

  it("chat screen: bootstrap when no provider configured", () => {
    expect(
      browserPreviewNeedsBootstrap(
        bootstrap({ screen: "chat" }),
        runtime({ providerCount: 0, selectedProviderId: null, selectedModel: null }),
      ),
    ).toBe(true);
  });

  it("chat screen: stable when fully seeded", () => {
    expect(
      browserPreviewNeedsBootstrap(bootstrap({ screen: "chat" }), runtime()),
    ).toBe(false);
  });

  it("settings screen: bootstrap when view is wrong", () => {
    expect(
      browserPreviewNeedsBootstrap(bootstrap({ screen: "settings" }), runtime({ view: "chat" })),
    ).toBe(true);
  });

  it("settings screen with demo dataset: bootstrap when seeded content missing", () => {
    expect(
      browserPreviewNeedsBootstrap(
        bootstrap({ screen: "settings", dataset: "demo" }),
        runtime({ view: "settings", providerCount: 0 }),
      ),
    ).toBe(true);
  });

  it("settings screen with empty dataset: does not require seeded content", () => {
    expect(
      browserPreviewNeedsBootstrap(
        bootstrap({ screen: "settings", dataset: "empty" }),
        runtime({ view: "settings", providerCount: 0, conversationCount: 0 }),
      ),
    ).toBe(false);
  });

  it("list screen: bootstrap when a conversation is currently selected", () => {
    expect(
      browserPreviewNeedsBootstrap(bootstrap({ screen: "list" }), runtime({ currentConversationId: "c1" })),
    ).toBe(true);
  });

  it("list screen: bootstrap when no conversations exist at all", () => {
    expect(
      browserPreviewNeedsBootstrap(
        bootstrap({ screen: "list" }),
        runtime({ currentConversationId: null, conversationCount: 0 }),
      ),
    ).toBe(true);
  });

  it("welcome screen with demo dataset: bootstrap when providers are missing", () => {
    expect(
      browserPreviewNeedsBootstrap(
        bootstrap({ screen: "welcome", dataset: "demo" }),
        runtime({ view: "chat", currentConversationId: null, providerCount: 0 }),
      ),
    ).toBe(true);
  });

  it("welcome screen with empty dataset: bootstrap when ANY provider or conversation exists", () => {
    expect(
      browserPreviewNeedsBootstrap(
        bootstrap({ screen: "welcome", dataset: "empty" }),
        runtime({ view: "chat", currentConversationId: null, providerCount: 1, conversationCount: 0 }),
      ),
    ).toBe(true);
  });

  it("welcome screen with empty dataset: stable when truly empty", () => {
    expect(
      browserPreviewNeedsBootstrap(
        bootstrap({ screen: "welcome", dataset: "empty" }),
        runtime({
          view: "chat",
          currentConversationId: null,
          providerCount: 0,
          conversationCount: 0,
          selectedProviderId: null,
          selectedModel: null,
        }),
      ),
    ).toBe(false);
  });

  it("pin screen: bootstrap when PIN is not currently active+locked", () => {
    expect(
      browserPreviewNeedsBootstrap(
        bootstrap({ screen: "pin" }),
        runtime({ pinEnabled: false, isLocked: false }),
      ),
    ).toBe(true);
    expect(
      browserPreviewNeedsBootstrap(
        bootstrap({ screen: "pin" }),
        runtime({ pinEnabled: true, isLocked: true }),
      ),
    ).toBe(false);
  });

  it("unknown screen names default to no-bootstrap", () => {
    expect(
      browserPreviewNeedsBootstrap(bootstrap({ screen: "made-up" }), runtime()),
    ).toBe(false);
  });
});

// ============================================================
//  applyPreviewBootstrap (mutates global store)
// ============================================================

describe("applyPreviewBootstrap", () => {
  it("returns false and is a no-op for empty screen", () => {
    const before = useAppStore.getState();
    expect(applyPreviewBootstrap({ screen: "" })).toBe(false);
    expect(useAppStore.getState()).toBe(before);
  });

  it("chat screen seeds a conversation and one provider", () => {
    expect(applyPreviewBootstrap(bootstrap({ screen: "chat" }))).toBe(true);
    const s = useAppStore.getState();
    expect(s.view).toBe("chat");
    expect(s.conversations.length).toBeGreaterThan(0);
    expect(s.messages.length).toBeGreaterThan(0);
    expect(s.providers.length).toBe(1);
    expect(s.currentConversationId).not.toBeNull();
    expect(s.pinEnabled).toBe(false);
    expect(s.isLocked).toBe(false);
  });

  it("welcome screen with empty dataset clears providers and conversations", () => {
    expect(applyPreviewBootstrap(bootstrap({ screen: "welcome", dataset: "empty" }))).toBe(true);
    const s = useAppStore.getState();
    expect(s.providers).toHaveLength(0);
    expect(s.conversations).toHaveLength(0);
    expect(s.selectedProviderId).toBeNull();
    expect(s.selectedModel).toBeNull();
    expect(s.currentConversationId).toBeNull();
  });

  it("settings screen jumps to view=settings", () => {
    expect(applyPreviewBootstrap(bootstrap({ screen: "settings" }))).toBe(true);
    expect(useAppStore.getState().view).toBe("settings");
  });

  it("pin screen marks pinEnabled + isLocked true", () => {
    expect(applyPreviewBootstrap(bootstrap({ screen: "pin" }))).toBe(true);
    const s = useAppStore.getState();
    expect(s.pinEnabled).toBe(true);
    expect(s.isLocked).toBe(true);
  });

  it("lang=zh-CN swaps to the Chinese conversation/message bundle", () => {
    applyPreviewBootstrap(bootstrap({ screen: "chat", lang: "zh-CN" }));
    const titles = useAppStore.getState().conversations.map((c) => c.title);
    // The zh-CN bundle uses Chinese titles like "规划一趟京都亲子周末".
    expect(titles.some((t) => /[一-鿿]/.test(t))).toBe(true);
  });

  it("default lang (no zh) keeps the English bundle", () => {
    applyPreviewBootstrap(bootstrap({ screen: "chat", lang: null }));
    const titles = useAppStore.getState().conversations.map((c) => c.title);
    expect(titles.some((t) => /Kyoto|Series|contract/i.test(t))).toBe(true);
  });
});

// ============================================================
//  previewSettingValue
// ============================================================

describe("previewSettingValue", () => {
  it("returns null when no preview query is active", () => {
    setSearch("");
    expect(previewSettingValue("ui_language")).toBeNull();
  });

  it("returns hard-coded preview values for known setting keys when preview is active", () => {
    setSearch("?preview=chat");
    expect(previewSettingValue("ui_language")).toBe("zh-CN");
    expect(previewSettingValue("assistant_preset")).toBe("default");
    expect(previewSettingValue("stt_model")).toBe("whisper-1");
    expect(previewSettingValue("tts_model")).toBe("tts-1");
    expect(previewSettingValue("tts_voice")).toBe("alloy");
  });

  it("returns null for unknown setting keys", () => {
    setSearch("?preview=chat");
    expect(previewSettingValue("never_seen_key")).toBeNull();
  });

  it("returns a valid JSON image_gen_config string when preview is active", () => {
    setSearch("?preview=chat");
    const raw = previewSettingValue("image_gen_config");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.enabled).toBe(true);
    expect(typeof parsed.provider_id).toBe("string");
    expect(typeof parsed.model).toBe("string");
  });
});
