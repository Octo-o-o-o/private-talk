import { describe, expect, it } from "vitest";
import {
  previewFromContent,
  previewFromMessage,
  updateConversationPreview,
} from "./appStore";
import type { Attachment, Conversation, Message } from "../lib/types";

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "att-1",
    message_id: "msg-1",
    file_type: "image",
    file_name: "photo.png",
    file_path: "/tmp/photo.png",
    mime_type: "image/png",
    file_size: 0,
    metadata: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    conversation_id: "conv-1",
    role: "user",
    content: "",
    attachments: [],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1",
    title: "Test",
    preview: "",
    assistant_id: null,
    created_at: new Date(Date.now() - 60_000).toISOString(),
    updated_at: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

describe("previewFromContent", () => {
  it("collapses image markdown into the 🖼 Image placeholder", () => {
    expect(previewFromContent("hello ![alt](http://x/y.png) world")).toBe(
      "hello 🖼 Image world",
    );
  });

  it("replaces non-image markdown links with their URL", () => {
    expect(previewFromContent("see [docs](https://example.com/d)")).toBe(
      "see https://example.com/d",
    );
  });

  it("collapses whitespace runs into a single space", () => {
    expect(previewFromContent("a\n\nb   c\tDE")).toBe("a b c DE");
  });

  it("returns empty string for content that is whitespace-only", () => {
    expect(previewFromContent("   \n\t  ")).toBe("");
  });

  it("strips markdown but preserves plain prose", () => {
    expect(
      previewFromContent(
        "Generated 1 image(s).\n\n![Generated image 1](localb64://abc)",
      ),
    ).toBe("Generated 1 image(s). 🖼 Image");
  });
});

describe("previewFromMessage", () => {
  it("returns content preview when content is non-empty", () => {
    const m = message({ content: "hello world" });
    expect(previewFromMessage(m)).toBe("hello world");
  });

  it("falls back to single attachment's file_name when content is empty", () => {
    const m = message({
      content: "",
      attachments: [attachment({ file_name: "report.pdf" })],
    });
    expect(previewFromMessage(m)).toBe("report.pdf");
  });

  it("falls back to '<N> attachments' when content is empty and >1 attachments", () => {
    const m = message({
      content: "",
      attachments: [attachment({ id: "a" }), attachment({ id: "b" })],
    });
    expect(previewFromMessage(m)).toBe("2 attachments");
  });

  it("returns empty string when content empty and no attachments", () => {
    const m = message({ content: "" });
    expect(previewFromMessage(m)).toBe("");
  });

  it("prefers content over attachments when both present", () => {
    const m = message({
      content: "look at this",
      attachments: [attachment({ file_name: "x.png" })],
    });
    expect(previewFromMessage(m)).toBe("look at this");
  });
});

describe("updateConversationPreview", () => {
  it("returns the input list unchanged when the message's conversation is not in the list", () => {
    const list = [conversation({ id: "a" }), conversation({ id: "b" })];
    const m = message({ conversation_id: "ghost", content: "x" });
    const next = updateConversationPreview(list, m);
    expect(next).toBe(list); // same reference: no copy needed
  });

  it("moves the matched conversation to the front and updates preview + updated_at", () => {
    const newer = new Date("2026-05-17T12:00:00.000Z").toISOString();
    const list = [
      conversation({ id: "a", preview: "old a", updated_at: "2026-05-17T10:00:00.000Z" }),
      conversation({ id: "b", preview: "old b", updated_at: "2026-05-17T09:00:00.000Z" }),
      conversation({ id: "c", preview: "old c", updated_at: "2026-05-17T08:00:00.000Z" }),
    ];

    const m = message({
      conversation_id: "b",
      content: "fresh reply",
      created_at: newer,
    });

    const next = updateConversationPreview(list, m);

    expect(next.map((c) => c.id)).toEqual(["b", "a", "c"]);
    expect(next[0].preview).toBe("fresh reply");
    expect(next[0].updated_at).toBe(newer);
    // other conversations untouched
    expect(next[1].preview).toBe("old a");
    expect(next[2].preview).toBe("old c");
  });

  it("regression: does not drop sibling conversations when reordering", () => {
    const list = [
      conversation({ id: "a" }),
      conversation({ id: "b" }),
      conversation({ id: "c" }),
      conversation({ id: "d" }),
    ];
    const m = message({ conversation_id: "c", content: "x" });
    const next = updateConversationPreview(list, m);

    expect(next).toHaveLength(4);
    expect(new Set(next.map((c) => c.id))).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("uses attachment fallback when content is empty", () => {
    const list = [conversation({ id: "x", preview: "old" })];
    const m = message({
      conversation_id: "x",
      content: "",
      attachments: [attachment({ file_name: "scan.pdf" })],
    });
    const next = updateConversationPreview(list, m);
    expect(next[0].preview).toBe("scan.pdf");
  });
});
