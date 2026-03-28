import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PinLock } from "@/components/pin/PinLock";
import * as api from "@/lib/tauri";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useAppStore } from "@/stores/appStore";

const initialAppState = useAppStore.getState();

function resetStores() {
  usePreferencesStore.setState({
    language: "en-US",
    initialized: true,
    hydrating: false,
    themeMode: "system",
    resolvedTheme: "dark",
    zoom: 1,
  });
  useAppStore.setState({
    ...initialAppState,
    isLocked: true,
    pinEnabled: true,
    assistants: [],
    conversations: [],
    messages: [],
    providers: [],
    voices: [],
    openclawInstances: [],
    pendingLocalDetections: [],
  });
}

describe("PinLock", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("unlocks the app after a valid PIN is entered", async () => {
    const verifyPin = vi.spyOn(api, "verifyPin").mockResolvedValue(true);

    render(<PinLock />);

    fireEvent.change(screen.getByLabelText("PIN input"), {
      target: { value: "12ab34" },
    });

    await waitFor(() => {
      expect(verifyPin).toHaveBeenCalledWith("1234");
    });
    expect(useAppStore.getState().isLocked).toBe(false);
  });

  it("shows an error and clears the PIN after an invalid submit", async () => {
    vi.useFakeTimers();
    const verifyPin = vi.spyOn(api, "verifyPin").mockResolvedValue(false);

    render(<PinLock />);

    const input = screen.getByLabelText("PIN input");
    await act(async () => {
      fireEvent.change(input, { target: { value: "1234" } });
    });
    expect(verifyPin).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      await Promise.resolve();
    });
    expect(screen.getByText("Incorrect PIN")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(input).toHaveValue("");
  });

  it("resets all app data after explicit confirmation", async () => {
    const resetAllData = vi.spyOn(api, "resetAllData").mockResolvedValue();
    const checkPinStatus = vi.fn().mockResolvedValue(undefined);
    const loadAssistants = vi.fn().mockResolvedValue(undefined);
    const loadVoices = vi.fn().mockResolvedValue(undefined);
    const loadConversations = vi.fn().mockResolvedValue(undefined);
    const loadProviders = vi.fn().mockResolvedValue(undefined);

    useAppStore.setState({
      checkPinStatus,
      loadAssistants,
      loadVoices,
      loadConversations,
      loadProviders,
      isLocked: true,
    });

    render(<PinLock />);

    fireEvent.click(screen.getByText("Forgot PIN? Reset app"));
    fireEvent.click(screen.getByText("Continue"));

    const confirmation = "I confirm deleting and resetting all data";
    fireEvent.change(screen.getByPlaceholderText(confirmation), {
      target: { value: confirmation },
    });
    fireEvent.click(screen.getByText("Confirm Reset"));

    await waitFor(() => {
      expect(resetAllData).toHaveBeenCalledTimes(1);
    });
    expect(checkPinStatus).toHaveBeenCalledTimes(1);
    expect(loadAssistants).toHaveBeenCalledTimes(1);
    expect(loadVoices).toHaveBeenCalledTimes(1);
    expect(loadConversations).toHaveBeenCalledTimes(1);
    expect(loadProviders).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().isLocked).toBe(false);
  });
});
