import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  base64ToArrayBuffer,
  expandPlaybackChunks,
  formatDuration,
  mergeAdjacentPlaybackSegments,
  splitTextIntoChunks,
  TtsPlaybackBar,
  TtsTriggerButton,
  useTts,
} from "@/components/audio/TtsPlayButton";
import * as api from "@/lib/tauri";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useAppStore } from "@/stores/appStore";

const initialAppState = useAppStore.getState();

class FakeAudioBufferSourceNode {
  buffer: { duration: number } | null = null;
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
  disconnect = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  state: "running" | "suspended" | "closed" = "running";
  currentTime = 0;
  destination = {};
  close = vi.fn().mockResolvedValue(undefined);
  resume = vi.fn().mockResolvedValue(undefined);
  decodeAudioData = vi.fn(async () => ({ duration: 1.25 }));
  createBufferSource = vi.fn(() => new FakeAudioBufferSourceNode());

  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

describe("TTS UI helpers", () => {
  beforeEach(() => {
    usePreferencesStore.setState({ language: "en-US" });
    useAppStore.setState({
      ...initialAppState,
      voices: [],
      isTtsPlaying: false,
      ttsStopGeneration: 0,
    });
    FakeAudioContext.instances = [];
    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders the correct trigger control for idle, loading, and error states", () => {
    const onClick = vi.fn();
    const { rerender } = render(<TtsTriggerButton phase="idle" onClick={onClick} />);

    fireEvent.click(screen.getByTitle("Read aloud"));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<TtsTriggerButton phase="loading" onClick={onClick} />);
    expect(screen.getByTitle("Stop reading")).toBeInTheDocument();

    rerender(<TtsTriggerButton phase="error" onClick={onClick} />);
    expect(screen.getByTitle("Failed")).toBeInTheDocument();
  });

  it("renders playback progress and forwards the stop action", () => {
    const onStop = vi.fn();

    render(
      <TtsPlaybackBar
        phase="playing"
        progress={50}
        elapsed={30}
        totalDuration={90}
        onStop={onStop}
      />
    );

    expect(screen.getByText("0:30 / 1:30")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Stop"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("covers the pure TTS helpers", () => {
    expect(
      splitTextIntoChunks("# Heading\n**Bold** text\nshort\n[Link](https://example.com)")
    ).toEqual(["Heading，Bold text，short，Link"]);

    expect(
      mergeAdjacentPlaybackSegments([
        { roleName: "assistant", text: "Hello", voiceId: "voice-1" },
        { roleName: "assistant", text: "World", voiceId: "voice-1" },
        { roleName: "assistant", text: "  ", voiceId: "voice-1" },
        { roleName: "narrator", text: "Scene", voiceId: "voice-2" },
      ])
    ).toEqual([
      { roleName: "assistant", text: "Hello\nWorld", voiceId: "voice-1" },
      { roleName: "narrator", text: "Scene", voiceId: "voice-2" },
    ]);

    expect(
      expandPlaybackChunks([
        {
          roleName: "assistant",
          text: "This is a sufficiently long line.\nAnother sufficiently long line.",
          voiceId: "voice-1",
        },
      ])
    ).toEqual([
      {
        roleName: "assistant",
        text: "This is a sufficiently long line.",
        voiceId: "voice-1",
      },
      {
        roleName: "assistant",
        text: "Another sufficiently long line.",
        voiceId: "voice-1",
      },
    ]);

    expect(Array.from(new Uint8Array(base64ToArrayBuffer("QQ==")))).toEqual([65]);
    expect(formatDuration(90)).toBe("1:30");
    expect(formatDuration(-1)).toBe("0:00");
  });

  it("moves through an error state when no voice is available for playback", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() =>
      useTts({
        messageContent: "Hello world",
      })
    );

    await act(async () => {
      await result.current.toggle();
    });

    expect(result.current.phase).toBe("error");
    expect(consoleError).toHaveBeenCalledWith("[TTS] No voice available");

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.phase).toBe("idle");
  });

  it("plays synthesized chunks and can be stopped manually", async () => {
    const ttsSynthesize = vi.spyOn(api, "ttsSynthesize").mockResolvedValue({
      audio_base64: "QQ==",
      content_type: "audio/wav",
    });

    const { result } = renderHook(() =>
      useTts({
        messageContent:
          "This is a sufficiently long line for the first chunk.\nThis is another sufficiently long line for the second chunk.",
        voiceId: "voice-1",
      })
    );

    await act(async () => {
      await result.current.toggle();
    });

    expect(result.current.phase).toBe("playing");
    expect(useAppStore.getState().isTtsPlaying).toBe(true);
    expect(ttsSynthesize).toHaveBeenCalledTimes(2);
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].createBufferSource).toHaveBeenCalledTimes(2);

    await act(async () => {
      await result.current.toggle();
    });

    expect(result.current.phase).toBe("idle");
    expect(useAppStore.getState().isTtsPlaying).toBe(false);
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalledTimes(1);
  });
});
