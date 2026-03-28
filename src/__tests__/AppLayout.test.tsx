import { act, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppLayout } from "@/components/layout/AppLayout";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useAppStore } from "@/stores/appStore";

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: vi.fn(),
}));

vi.mock("@/components/layout/Sidebar", () => ({
  Sidebar: () => <div>sidebar</div>,
}));

const initialAppState = useAppStore.getState();

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<div>content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("AppLayout", () => {
  beforeEach(() => {
    useAppStore.setState({
      ...initialAppState,
      sidebarOpen: true,
      conversations: [],
      messages: [],
      providers: [],
      assistants: [],
      voices: [],
      openclawInstances: [],
      pendingLocalDetections: [],
    });
    vi.clearAllMocks();
  });

  it("closes the sidebar only once when entering a mobile session", () => {
    vi.mocked(useIsMobile).mockReturnValue(true);

    renderLayout();

    expect(useAppStore.getState().sidebarOpen).toBe(false);

    act(() => {
      useAppStore.getState().setSidebarOpen(true);
    });

    expect(useAppStore.getState().sidebarOpen).toBe(true);
  });

  it("closes the mobile drawer when the backdrop is clicked", () => {
    vi.mocked(useIsMobile).mockReturnValue(true);

    const { container } = renderLayout();

    act(() => {
      useAppStore.getState().setSidebarOpen(true);
    });

    const backdrop = container.querySelector(".fixed.inset-0");
    expect(backdrop).toBeInTheDocument();

    fireEvent.click(backdrop!);

    expect(useAppStore.getState().sidebarOpen).toBe(false);
  });

  it("renders the desktop layout without the legacy empty drag strip", () => {
    vi.mocked(useIsMobile).mockReturnValue(false);

    const { container, getByText } = renderLayout();

    expect(getByText("sidebar")).toBeInTheDocument();
    expect(getByText("content")).toBeInTheDocument();
    expect(container.querySelector("[data-tauri-drag-region]")).not.toBeInTheDocument();
    expect(container.querySelector(".fixed.inset-0")).not.toBeInTheDocument();
  });
});
