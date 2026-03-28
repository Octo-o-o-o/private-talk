import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UsagePage } from "@/components/usage/UsagePage";
import * as api from "@/lib/tauri";

vi.mock("@/components/layout/MobileMenuButton", () => ({
  MobileMenuButton: () => null,
}));

vi.mock("@/hooks/useDesktopWindowDrag", () => ({
  useDesktopWindowDrag: () => ({}),
}));

vi.mock("@/lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tauri")>("@/lib/tauri");
  return {
    ...actual,
    getUsageByConversation: vi.fn(),
    getUsageByDate: vi.fn(),
  };
});

describe("UsagePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getUsageByConversation).mockResolvedValue([]);
    vi.mocked(api.getUsageByDate).mockResolvedValue([]);
  });

  it("keeps pricing offline until the user explicitly syncs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ data: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<UsagePage />);

    await waitFor(() => {
      expect(api.getUsageByConversation).toHaveBeenCalledTimes(1);
      expect(api.getUsageByDate).toHaveBeenCalledTimes(1);
    });

    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: /Sync pricing|同步定价/i })
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("https://openrouter.ai/api/v1/models");
    });
  });
});
