import { fireEvent, render } from "@testing-library/react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDesktopWindowDrag, windowDragExcludeProps } from "@/hooks/useDesktopWindowDrag";
import { useIsMobile } from "@/hooks/useIsMobile";

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: vi.fn(),
}));

function TestSurface() {
  const dragSurfaceProps = useDesktopWindowDrag();

  return (
    <div {...dragSurfaceProps}>
      <span data-testid="title">Private Talk</span>
      <button type="button">Action</button>
      <div {...windowDragExcludeProps}>
        <span data-testid="excluded">Excluded</span>
      </div>
    </div>
  );
}

describe("useDesktopWindowDrag", () => {
  const startDragging = vi.fn();
  const toggleMaximize = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useIsMobile).mockReturnValue(false);
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(getCurrentWindow).mockReturnValue({
      startDragging,
      toggleMaximize,
    } as never);
  });

  it("starts dragging after the pointer moves past the threshold", () => {
    const { getByTestId } = render(<TestSurface />);

    fireEvent.mouseDown(getByTestId("title"), { button: 0, clientX: 40, clientY: 16 });
    fireEvent.mouseMove(window, { clientX: 46, clientY: 20 });

    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  it("toggles maximize on double click", () => {
    const { getByTestId } = render(<TestSurface />);

    fireEvent.doubleClick(getByTestId("title"), { button: 0 });

    expect(toggleMaximize).toHaveBeenCalledTimes(1);
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("does not drag when the interaction starts on an excluded target", () => {
    const { getByRole, getByTestId } = render(<TestSurface />);

    fireEvent.mouseDown(getByRole("button", { name: "Action" }), {
      button: 0,
      clientX: 40,
      clientY: 16,
    });
    fireEvent.mouseMove(window, { clientX: 52, clientY: 28 });

    fireEvent.mouseDown(getByTestId("excluded"), {
      button: 0,
      clientX: 40,
      clientY: 16,
    });
    fireEvent.mouseMove(window, { clientX: 52, clientY: 28 });

    expect(startDragging).not.toHaveBeenCalled();
    expect(toggleMaximize).not.toHaveBeenCalled();
  });

  it("disables desktop dragging outside Tauri or on mobile", () => {
    vi.mocked(isTauri).mockReturnValue(false);
    const { rerender, getByTestId } = render(<TestSurface />);

    fireEvent.mouseDown(getByTestId("title"), { button: 0, clientX: 40, clientY: 16 });
    fireEvent.mouseMove(window, { clientX: 46, clientY: 20 });

    vi.mocked(useIsMobile).mockReturnValue(true);
    rerender(<TestSurface />);

    fireEvent.mouseDown(getByTestId("title"), { button: 0, clientX: 40, clientY: 16 });
    fireEvent.mouseMove(window, { clientX: 46, clientY: 20 });
    fireEvent.doubleClick(getByTestId("title"), { button: 0 });

    expect(startDragging).not.toHaveBeenCalled();
    expect(toggleMaximize).not.toHaveBeenCalled();
  });
});
