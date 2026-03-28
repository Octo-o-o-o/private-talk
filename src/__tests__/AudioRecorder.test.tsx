import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AudioRecorder } from "@/components/audio/AudioRecorder";
import { useAppStore } from "@/stores/appStore";

class FakeFileReader {
  result: string | ArrayBuffer | null = null;
  onloadend: null | (() => void) = null;
  onerror: null | (() => void) = null;

  readAsDataURL() {
    this.result = "data:audio/webm;base64,ZmFrZQ==";
    this.onloadend?.();
  }
}

class FakeMediaRecorder {
  static lastInstance: FakeMediaRecorder | null = null;

  ondataavailable: null | ((event: { data: Blob }) => void) = null;
  onstop: null | (() => Promise<void> | void) = null;

  constructor(private readonly stream: MediaStream) {
    FakeMediaRecorder.lastInstance = this;
  }

  start() {
    return undefined;
  }

  stop() {
    this.ondataavailable?.({
      data: new Blob(["audio"], { type: "audio/webm" }),
    });
    void this.onstop?.();
    return undefined;
  }

  getStream() {
    return this.stream;
  }
}

const initialAppState = useAppStore.getState();
const getUserMedia = vi.fn();

describe("AudioRecorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useAppStore.setState({
      ...initialAppState,
      selectedProviderId: "provider-1",
      providers: [],
      conversations: [],
      messages: [],
      assistants: [],
      voices: [],
      openclawInstances: [],
      pendingLocalDetections: [],
    });

    Object.defineProperty(globalThis, "FileReader", {
      configurable: true,
      value: FakeFileReader,
    });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia,
      },
    });
  });

  it("records audio and forwards the transcription result", async () => {
    const trackStop = vi.fn();
    getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: trackStop }],
    });

    const onTranscription = vi.fn();
    const sttTranscribe = vi
      .spyOn(await import("@/lib/tauri"), "sttTranscribe")
      .mockResolvedValue("  hello world  ");

    render(<AudioRecorder onTranscription={onTranscription} />);

    fireEvent.click(screen.getByTitle("Voice input"));
    fireEvent.click(await screen.findByTitle("Stop recording"));

    await waitFor(() => {
      expect(sttTranscribe).toHaveBeenCalledWith(
        "ZmFrZQ==",
        "provider-1"
      );
    });
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(onTranscription).toHaveBeenCalledWith("hello world");
  });

  it("skips transcription when no STT provider is selected", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    });
    useAppStore.setState({ selectedProviderId: null });

    const sttTranscribe = vi
      .spyOn(await import("@/lib/tauri"), "sttTranscribe")
      .mockResolvedValue("ignored");

    render(<AudioRecorder onTranscription={vi.fn()} />);

    fireEvent.click(screen.getByTitle("Voice input"));
    fireEvent.click(await screen.findByTitle("Stop recording"));

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith("No provider selected for STT");
    });
    expect(sttTranscribe).not.toHaveBeenCalled();
  });
});
