import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import * as api from "@/lib/tauri";

const mockedInvoke = vi.mocked(invoke);

describe("tauri.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("normalizeConversation (via listConversations)", () => {
    it("should normalize assistant_id from backend", async () => {
      mockedInvoke.mockResolvedValue([
        {
          id: "c1",
          title: "Test",
          assistant_id: "a1",
          scenario_id: null,
          created_at: "2024-01-01",
          updated_at: "2024-01-01",
          openclaw_instance_id: null,
          openclaw_agent_id: null,
          openclaw_session_key: null,
        },
      ]);

      const result = await api.listConversations();

      expect(result[0].assistant_id).toBe("a1");
      expect(result[0].scenario_id).toBe("a1");
    });

    it("should fallback to scenario_id when assistant_id is null", async () => {
      mockedInvoke.mockResolvedValue([
        {
          id: "c2",
          title: "Legacy",
          assistant_id: null,
          scenario_id: "s1",
          created_at: "2024-01-01",
          updated_at: "2024-01-01",
          openclaw_instance_id: null,
          openclaw_agent_id: null,
          openclaw_session_key: null,
        },
      ]);

      const result = await api.listConversations();

      expect(result[0].assistant_id).toBe("s1");
      expect(result[0].scenario_id).toBe("s1");
    });

    it("should set both to null when neither exists", async () => {
      mockedInvoke.mockResolvedValue([
        {
          id: "c3",
          title: "Free",
          assistant_id: null,
          scenario_id: null,
          created_at: "2024-01-01",
          updated_at: "2024-01-01",
          openclaw_instance_id: null,
          openclaw_agent_id: null,
          openclaw_session_key: null,
        },
      ]);

      const result = await api.listConversations();

      expect(result[0].assistant_id).toBeNull();
      expect(result[0].scenario_id).toBeNull();
    });
  });

  describe("createConversation", () => {
    it("should call invoke with correct params and normalize result", async () => {
      mockedInvoke.mockResolvedValue({
        id: "new-c",
        title: "New",
        assistant_id: "a1",
        scenario_id: null,
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
        openclaw_instance_id: null,
        openclaw_agent_id: null,
        openclaw_session_key: null,
      });

      const result = await api.createConversation("New", "a1", undefined, undefined);

      expect(mockedInvoke).toHaveBeenCalledWith("create_conversation", {
        title: "New",
        assistantId: "a1",
        openclawInstanceId: undefined,
        openclawAgentId: undefined,
      });
      expect(result.assistant_id).toBe("a1");
    });
  });

  describe("deleteConversations", () => {
    it("should call delete for each id sequentially", async () => {
      mockedInvoke.mockResolvedValue(undefined);

      await api.deleteConversations(["c1", "c2", "c3"]);

      expect(mockedInvoke).toHaveBeenCalledTimes(3);
      expect(mockedInvoke).toHaveBeenCalledWith("delete_conversation", { id: "c1" });
      expect(mockedInvoke).toHaveBeenCalledWith("delete_conversation", { id: "c2" });
      expect(mockedInvoke).toHaveBeenCalledWith("delete_conversation", { id: "c3" });
    });
  });

  describe("getImageGenConfig", () => {
    it("should parse JSON string from settings", async () => {
      const config = {
        enabled: true,
        provider_id: "p1",
        model: "dall-e-3",
        api_mode: "chat",
        allow_auto_tool_call: false,
        max_images_per_request: 4,
        default_aspect_ratio: "1:1",
        default_quality: "standard",
      };
      mockedInvoke.mockResolvedValue(JSON.stringify(config));

      const result = await api.getImageGenConfig();

      expect(result).toEqual(config);
    });

    it("should return null when no config saved", async () => {
      mockedInvoke.mockResolvedValue(null);

      const result = await api.getImageGenConfig();

      expect(result).toBeNull();
    });
  });

  describe("simple invoke wrappers", () => {
    it("listProviders calls correct command", async () => {
      mockedInvoke.mockResolvedValue([]);
      await api.listProviders();
      expect(mockedInvoke).toHaveBeenCalledWith("list_providers");
    });

    it("deleteProvider calls with id", async () => {
      mockedInvoke.mockResolvedValue(undefined);
      await api.deleteProvider("p1");
      expect(mockedInvoke).toHaveBeenCalledWith("delete_provider", { id: "p1" });
    });

    it("verifyPin calls with correct args", async () => {
      mockedInvoke.mockResolvedValue(true);
      const result = await api.verifyPin("1234");
      expect(mockedInvoke).toHaveBeenCalledWith("verify_pin_cmd", { inputPin: "1234" });
      expect(result).toBe(true);
    });
  });
});
