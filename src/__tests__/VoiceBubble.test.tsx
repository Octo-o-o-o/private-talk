import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VoiceBubble } from "@/components/chat/VoiceBubble";
import type { Attachment } from "@/lib/types";
import { usePreferencesStore } from "@/stores/preferencesStore";

const attachment: Attachment = {
  id: "attachment-1",
  message_id: "message-1",
  file_type: "audio",
  file_name: "voice.webm",
  file_path: "/tmp/voice.webm",
  mime_type: "audio/webm",
  file_size: 1234,
  created_at: "2024-01-01T00:00:00Z",
};

describe("VoiceBubble", () => {
  beforeEach(() => {
    usePreferencesStore.setState({ language: "en-US" });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  });

  it("plays audio, formats duration, and toggles the transcript", async () => {
    render(<VoiceBubble attachment={attachment} transcript="Hello transcript" />);

    fireEvent.click(screen.getByTitle("Play"));

    await waitFor(() => {
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTitle("Pause")).toBeInTheDocument();

    const audio = document.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: 65,
    });
    fireEvent(audio, new Event("loadedmetadata"));

    expect(screen.getByText("1:05")).toBeInTheDocument();

    fireEvent.click(screen.getByText("View transcript"));
    expect(screen.getByText("Hello transcript")).toBeInTheDocument();

    fireEvent(audio, new Event("ended"));
    expect(screen.getByTitle("Play")).toBeInTheDocument();
  });

  it("shows a fallback message when the audio file fails to load", () => {
    render(<VoiceBubble attachment={attachment} transcript="Hello transcript" />);

    fireEvent(document.querySelector("audio") as HTMLAudioElement, new Event("error"));

    expect(screen.getByText("Voice file could not be loaded")).toBeInTheDocument();
  });
});
