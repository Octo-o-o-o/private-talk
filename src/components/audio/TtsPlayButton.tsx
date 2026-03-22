import { useState, useRef, useEffect, useCallback } from "react";
import { Volume2, Loader2, Square, VolumeX } from "lucide-react";
import * as api from "../../lib/tauri";
import { useI18n } from "@/lib/i18n";
import { useAppStore } from "../../stores/appStore";

interface Props {
  messageContent: string;
  scenarioId?: string | null;
  voiceId?: string | null;
}

function base64ToBlob(base64: string, contentType: string): Blob {
  const byteChars = atob(base64);
  const byteArrays: Uint8Array[] = [];
  // Process in 512-byte slices for memory efficiency
  for (let offset = 0; offset < byteChars.length; offset += 512) {
    const slice = byteChars.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    byteArrays.push(new Uint8Array(byteNumbers));
  }
  return new Blob(byteArrays, { type: contentType });
}

export function TtsPlayButton({ messageContent, scenarioId, voiceId }: Props) {
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const skipStopRef = useRef(false);
  const { ttsStopGeneration, setTtsPlaying, stopAllTts } = useAppStore();
  const { t } = useI18n();

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const stopPlayback = useCallback(() => {
    cleanupAudio();
    setPlaying(false);
  }, [cleanupAudio]);

  // When another TtsPlayButton calls stopAllTts, stop this button's audio
  useEffect(() => {
    if (skipStopRef.current) {
      skipStopRef.current = false;
      return;
    }
    if (playing) {
      stopPlayback();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsStopGeneration]);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanupAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePlay = async () => {
    setError(false);

    if (playing) {
      stopPlayback();
      setTtsPlaying(false);
      return;
    }

    setLoading(true);
    try {
      let targetVoiceId = voiceId;

      if (!targetVoiceId && scenarioId) {
        const segments = await api.parseVoiceSegments(messageContent, scenarioId);
        console.log("[TTS] parseVoiceSegments result:", segments);
        if (segments.length > 0 && segments[0].voice_id) {
          targetVoiceId = segments[0].voice_id;
        }
      }

      // Fallback: if no voice mapping configured, use the first available voice
      if (!targetVoiceId) {
        const voices = useAppStore.getState().voices;
        if (voices.length > 0) {
          targetVoiceId = voices[0].id;
          console.log("[TTS] No voice mapping, falling back to first voice:", voices[0].display_name, voices[0].id);
        }
      }

      if (!targetVoiceId) {
        setLoading(false);
        setError(true);
        setTimeout(() => setError(false), 3000);
        console.error("[TTS] No voice available at all. scenarioId:", scenarioId, "voiceId:", voiceId);
        return;
      }

      console.log("[TTS] Synthesizing with voiceId:", targetVoiceId, "text length:", messageContent.length, "text preview:", JSON.stringify(messageContent.slice(0, 200)));
      const result = await api.ttsSynthesize(targetVoiceId, messageContent);
      console.log("[TTS] Synthesis OK, content_type:", result.content_type, "base64 length:", result.audio_base64.length);

      // Use Blob URL instead of data: URL for reliable playback in Tauri webview
      const blob = base64ToBlob(result.audio_base64, result.content_type);
      const blobUrl = URL.createObjectURL(blob);

      // Stop any other playing TTS first (skip ourselves in the effect)
      skipStopRef.current = true;
      stopAllTts();
      cleanupAudio();

      const audio = new Audio(blobUrl);
      audioRef.current = audio;
      blobUrlRef.current = blobUrl;

      audio.onended = () => {
        setPlaying(false);
        setTtsPlaying(false);
        cleanupAudio();
      };
      audio.onerror = (e) => {
        console.error("[TTS] Audio playback error:", e);
        setPlaying(false);
        setTtsPlaying(false);
        setError(true);
        setTimeout(() => setError(false), 3000);
        cleanupAudio();
      };

      setLoading(false);
      setPlaying(true);
      setTtsPlaying(true);
      await audio.play();
      console.log("[TTS] Playback started");
    } catch (e) {
      console.error("[TTS] Failed:", e);
      setLoading(false);
      setPlaying(false);
      setTtsPlaying(false);
      setError(true);
      setTimeout(() => setError(false), 3000);
    }
  };

  return (
    <button
      onClick={handlePlay}
      disabled={loading}
      className={`rounded-md p-1 transition-colors disabled:opacity-50 ${
        error
          ? "text-destructive"
          : playing
            ? "bg-primary/10 text-primary hover:bg-primary/15"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
      title={
        error
          ? t("播放失败", "Playback failed")
          : playing
            ? t("停止播放", "Stop")
            : t("播放语音", "Play audio")
      }
    >
      {loading ? (
        <Loader2 size={13} className="animate-spin" />
      ) : error ? (
        <VolumeX size={13} />
      ) : playing ? (
        <Square size={13} fill="currentColor" />
      ) : (
        <Volume2 size={13} />
      )}
    </button>
  );
}
