import { useAppStore } from "../stores/appStore";
import type {
  Conversation,
  Message,
  PreviewBootstrap,
  Provider,
} from "./types";

function timestamp(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

const PREVIEW_PROVIDER: Provider = {
  id: "preview-provider-openai",
  name: "OpenAI",
  api_type: "openai-compatible",
  base_url: "https://api.openai.com/v1",
  api_key: "sk-preview",
  models: ["gpt-5.4", "gpt-5.4-mini", "o4-mini"],
  is_default: true,
  created_at: timestamp(180),
};

const PREVIEW_CONVERSATIONS: Conversation[] = [
  {
    id: "preview-conversation-main",
    title: "Ship the iPad split-view polish for iOS 26",
    preview: "iPad split view needs tighter chrome and steadier safe-area spacing.",
    created_at: timestamp(210),
    updated_at: timestamp(6),
  },
  {
    id: "preview-conversation-notes",
    title: "Design notes and motion pass",
    preview: "Need to tighten the glass highlight and reduce the sidebar chrome.",
    created_at: timestamp(330),
    updated_at: timestamp(38),
  },
  {
    id: "preview-conversation-cn",
    title: "把移动端界面整理成真正的 iOS 体验",
    preview: "详情页进入时，列表要左移缩放，但仍然保持呼吸感。",
    created_at: timestamp(450),
    updated_at: timestamp(92),
  },
];

const PREVIEW_MESSAGES: Message[] = [
  {
    id: "preview-message-1",
    conversation_id: PREVIEW_CONVERSATIONS[0].id,
    role: "user",
    content: "我刚在 iPad 横屏上看了一遍，想把聊天页的 chrome 再收紧一点。",
    created_at: timestamp(24),
  },
  {
    id: "preview-message-2",
    conversation_id: PREVIEW_CONVERSATIONS[0].id,
    role: "assistant",
    content:
      "可以，先把问题拆成 3 块：\n\n- 顶部导航和安全区\n- 消息列最大宽度\n- 输入区在横屏和分屏下的底部留白",
    created_at: timestamp(23),
  },
  {
    id: "preview-message-3",
    conversation_id: PREVIEW_CONVERSATIONS[0].id,
    role: "user",
    content: "顺便检查一下 markdown 卡片和代码块在窄宽度下会不会撑破。",
    created_at: timestamp(22),
  },
  {
    id: "preview-message-4",
    conversation_id: PREVIEW_CONVERSATIONS[0].id,
    role: "assistant",
    content:
      "我会按以下规则收口：\n\n```ts\nconst maxWidth = layout === \"tablet\" ? \"72ch\" : \"64ch\";\nconst bottomInset = safeArea.bottom + 16;\n```\n\n> 目标是让 iPhone、iPad 竖屏和横屏都保持同一套触控节奏。",
    created_at: timestamp(21),
  },
];

function normalizedScreen(screen: string | null | undefined): string | null {
  if (!screen) return null;
  return screen.trim().toLowerCase();
}

interface PreviewRuntimeState {
  view: string;
  currentConversationId: string | null;
  conversationCount: number;
  providerCount: number;
  pinEnabled: boolean;
  isLocked: boolean;
}

export function readBrowserPreviewBootstrap(): PreviewBootstrap | null {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const screen = normalizedScreen(
    params.get("preview") ?? params.get("screen") ?? params.get("previewScreen"),
  );

  if (!screen) {
    return null;
  }

  return {
    screen,
    dataset:
      params.get("previewData") ?? params.get("dataset") ?? params.get("data"),
  };
}

export function browserPreviewNeedsBootstrap(
  preview: PreviewBootstrap,
  state: PreviewRuntimeState,
): boolean {
  const screen = normalizedScreen(preview.screen);
  if (!screen) {
    return false;
  }

  const dataset = (preview.dataset ?? "demo").trim().toLowerCase();
  const expectsSeededContent = dataset !== "empty" || screen === "chat";

  if (screen === "pin") {
    return !state.pinEnabled || !state.isLocked;
  }

  if (screen === "settings") {
    return (
      state.view !== "settings" ||
      (expectsSeededContent &&
        (state.providerCount === 0 || state.conversationCount === 0))
    );
  }

  if (screen === "chat") {
    return (
      state.view !== "chat" ||
      !state.currentConversationId ||
      state.providerCount === 0
    );
  }

  if (screen === "welcome") {
    return (
      state.view !== "chat" ||
      !!state.currentConversationId ||
      (dataset === "empty"
        ? state.providerCount !== 0 || state.conversationCount !== 0
        : state.providerCount === 0)
    );
  }

  return false;
}

export function applyPreviewBootstrap(preview: PreviewBootstrap): boolean {
  const screen = normalizedScreen(preview.screen);
  if (!screen) {
    return false;
  }

  const dataset = (preview.dataset ?? "demo").trim().toLowerCase();
  const hasSeededContent = dataset !== "empty" || screen === "chat";
  const providers = hasSeededContent ? [PREVIEW_PROVIDER] : [];
  const conversations =
    screen === "welcome" || dataset === "empty" ? [] : PREVIEW_CONVERSATIONS;
  const currentConversationId =
    screen === "chat" ? PREVIEW_CONVERSATIONS[0]?.id ?? null : null;

  useAppStore.setState({
    view: screen === "settings" ? "settings" : "chat",
    conversations,
    currentConversationId,
    messages: screen === "chat" ? PREVIEW_MESSAGES : [],
    isStreaming: false,
    streamingContent: "",
    providers,
    selectedProviderId: providers[0]?.id ?? null,
    selectedModel: providers[0]?.models[0] ?? null,
    pinEnabled: screen === "pin",
    isLocked: screen === "pin",
  });

  return true;
}
