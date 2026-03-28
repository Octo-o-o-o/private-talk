import { useState, useRef, useEffect, useCallback } from "react";
import { Volume2, Loader2, Square, VolumeX } from "lucide-react";
import * as api from "../../lib/tauri";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAppStore } from "../../stores/appStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Inter-chunk silence in seconds. 600ms is the research-backed optimum for
 *  natural inter-sentence pauses (Frontiers in Psychology, PMC8874014). */
const CHUNK_GAP_SECONDS = 0.6;

/** Split text into TTS-friendly chunks by newlines. */
export function splitTextIntoChunks(text: string): string[] {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, "")                        // code blocks
    .replace(/^#{1,6}\s+/gm, "")                           // headings
    .replace(/\*\*(.+?)\*\*/g, "$1")                       // bold
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1") // italic
    .replace(/~~(.+?)~~/g, "$1")                           // strikethrough
    .replace(/`(.+?)`/g, "$1")                             // inline code
    .replace(/!\[.*?\]\(.*?\)/g, "")                       // images
    .replace(/\[(.+?)\]\(.*?\)/g, "$1")                    // links → text
    .replace(/^[-*]\s+/gm, "")                             // unordered list markers
    .replace(/^\d+\.\s+/gm, "");                           // ordered list markers

  const rawLines = cleaned.split(/\n+/).map((l) => l.trim()).filter(Boolean);

  // Merge short lines (< 12 chars) with neighbours
  const merged: string[] = [];
  let buffer = "";
  for (const line of rawLines) {
    if (buffer) {
      buffer += "，" + line;
      if (buffer.length >= 12) {
        merged.push(buffer);
        buffer = "";
      }
    } else if (line.length < 12 && merged.length > 0) {
      merged[merged.length - 1] += "，" + line;
    } else if (line.length < 12) {
      buffer = line;
    } else {
      merged.push(line);
    }
  }
  if (buffer) {
    if (merged.length > 0) {
      merged[merged.length - 1] += "，" + buffer;
    } else {
      merged.push(buffer);
    }
  }

  return merged.length > 0 ? merged : [text.trim()];
}

interface ResolvedPlaybackSegment {
  roleName: string;
  text: string;
  voiceId: string;
}

interface PlaybackChunk {
  roleName: string;
  text: string;
  voiceId: string;
}

export function mergeAdjacentPlaybackSegments(
  segments: ResolvedPlaybackSegment[]
): ResolvedPlaybackSegment[] {
  const merged: ResolvedPlaybackSegment[] = [];

  for (const segment of segments) {
    if (!segment.text.trim()) continue;

    const previous = merged[merged.length - 1];
    if (previous && previous.voiceId === segment.voiceId) {
      previous.text = `${previous.text}\n${segment.text}`;
      continue;
    }

    merged.push({ ...segment });
  }

  return merged;
}

export function expandPlaybackChunks(
  segments: ResolvedPlaybackSegment[]
): PlaybackChunk[] {
  return mergeAdjacentPlaybackSegments(segments).flatMap((segment) =>
    splitTextIntoChunks(segment.text)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({
        roleName: segment.roleName,
        text,
        voiceId: segment.voiceId,
      }))
  );
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    bytes[i] = byteChars.charCodeAt(i);
  }
  return bytes.buffer;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Hook: useTts
// ---------------------------------------------------------------------------

export type TtsPhase = "idle" | "loading" | "playing" | "error";

interface UseTtsOptions {
  messageContent: string;
  assistantId?: string;
  voiceId?: string;
}

export function useTts({ messageContent, assistantId, voiceId }: UseTtsOptions) {
  const [phase, setPhase] = useState<TtsPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const { ttsStopGeneration, setTtsPlaying, stopAllTts } = useAppStore();

  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  /** Total audio duration (sum of buffer durations + gaps), NOT wall-clock. */
  const audioDurationRef = useRef(0);
  const playStartTimeRef = useRef(0);
  const rafRef = useRef<number>(0);
  const cancelledRef = useRef(false);
  const skipStopRef = useRef(false);
  const activeRef = useRef(false);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  /** Use a ref for phase so async code always sees the latest value. */
  const phaseRef = useRef<TtsPhase>("idle");

  const setPhaseAndRef = useCallback((p: TtsPhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const resetState = useCallback(() => {
    setProgress(0);
    setElapsed(0);
    setTotalDuration(0);
  }, []);

  const cleanup = useCallback(() => {
    cancelledRef.current = true;
    activeRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    for (const src of sourcesRef.current) {
      try { src.stop(); } catch { /* ok */ }
      try { src.disconnect(); } catch { /* ok */ }
    }
    sourcesRef.current = [];
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    nextStartTimeRef.current = 0;
    audioDurationRef.current = 0;
    playStartTimeRef.current = 0;
  }, []);

  useEffect(() => {
    if (skipStopRef.current) {
      skipStopRef.current = false;
      return;
    }
    if (phaseRef.current === "playing" || phaseRef.current === "loading") {
      cleanup();
      setPhaseAndRef("idle");
      resetState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsStopGeneration]);

  useEffect(() => {
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startProgressTracking = useCallback(() => {
    const tick = () => {
      const ctx = audioCtxRef.current;
      if (!ctx || !activeRef.current) return;

      const total = audioDurationRef.current;
      const elapsedTime = ctx.currentTime - playStartTimeRef.current;
      const clamped = Math.min(elapsedTime, total);
      setElapsed(clamped);
      setProgress(total > 0 ? (clamped / total) * 100 : 0);
      setTotalDuration(total);

      if (elapsedTime >= total + 0.1 && total > 0) {
        // Playback finished (small buffer to avoid premature cut)
        activeRef.current = false;
        setPhaseAndRef("idle");
        setTtsPlaying(false);
        resetState();
        cleanup();
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [cleanup, setTtsPlaying, setPhaseAndRef, resetState]);

  const resolvePlaybackChunks = useCallback(async (): Promise<PlaybackChunk[]> => {
    const voices = useAppStore.getState().voices;
    const fallbackVoiceId = voiceId ?? voices[0]?.id ?? null;

    if (voiceId) {
      return expandPlaybackChunks([
        { roleName: "assistant", text: messageContent, voiceId },
      ]);
    }

    if (!assistantId) {
      return fallbackVoiceId
        ? expandPlaybackChunks([
            { roleName: "assistant", text: messageContent, voiceId: fallbackVoiceId },
          ])
        : [];
    }

    let parsedSegments;
    try {
      parsedSegments = await api.parseVoiceSegments(messageContent, assistantId);
    } catch (error) {
      console.warn("[TTS] Failed to parse voice segments, falling back to default voice:", error);
      return fallbackVoiceId
        ? expandPlaybackChunks([
            { roleName: "assistant", text: messageContent, voiceId: fallbackVoiceId },
          ])
        : [];
    }

    const resolvedSegments = parsedSegments
      .map((segment) => ({
        roleName: segment.role_name,
        text: segment.text,
        voiceId: segment.voice_id ?? fallbackVoiceId,
      }))
      .filter((segment): segment is ResolvedPlaybackSegment => Boolean(segment.voiceId));

    if (resolvedSegments.length === 0) {
      return fallbackVoiceId
        ? expandPlaybackChunks([
            { roleName: "assistant", text: messageContent, voiceId: fallbackVoiceId },
          ])
        : [];
    }

    return expandPlaybackChunks(resolvedSegments);
  }, [messageContent, assistantId, voiceId]);

  const toggle = useCallback(async () => {
    // Use ref to avoid stale closure issues with phase
    const currentPhase = phaseRef.current;

    if (currentPhase === "playing" || currentPhase === "loading") {
      cleanup();
      setPhaseAndRef("idle");
      resetState();
      setTtsPlaying(false);
      return;
    }

    setPhaseAndRef("loading");
    cancelledRef.current = false;
    activeRef.current = true;

    try {
      const playbackChunks = await resolvePlaybackChunks();
      if (playbackChunks.length === 0 || cancelledRef.current) {
        console.error("[TTS] No voice available");
        setPhaseAndRef("error");
        setTimeout(() => setPhaseAndRef("idle"), 3000);
        return;
      }

      console.log("[TTS] Progressive: split into", playbackChunks.length, "chunks", playbackChunks);

      // Create AudioContext and ensure it's running
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      // Resume context — required by some WebView autoplay policies
      if (ctx.state === "suspended") {
        console.log("[TTS] AudioContext suspended, resuming...");
        await ctx.resume();
      }
      console.log("[TTS] AudioContext state:", ctx.state);

      skipStopRef.current = true;
      stopAllTts();
      setTtsPlaying(true);

      let firstPlayed = false;
      audioDurationRef.current = 0;

      for (let i = 0; i < playbackChunks.length; i++) {
        if (cancelledRef.current) break;
        try {
          const chunk = playbackChunks[i];
          console.log(
            `[TTS] Synthesizing chunk ${i + 1}/${playbackChunks.length} (${chunk.roleName}, ${chunk.voiceId}): "${chunk.text.slice(0, 50)}..."`
          );
          const result = await api.ttsSynthesize(chunk.voiceId, chunk.text);
          if (cancelledRef.current) break;

          const arrayBuf = base64ToArrayBuffer(result.audio_base64);
          const audioBuffer = await ctx.decodeAudioData(arrayBuf);
          if (cancelledRef.current) break;

          // Schedule playback
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);

          const gap = firstPlayed ? CHUNK_GAP_SECONDS : 0;

          if (!firstPlayed) {
            // First chunk: start immediately at current time
            firstPlayed = true;
            const startAt = ctx.currentTime;
            source.start(startAt);
            playStartTimeRef.current = startAt;
            nextStartTimeRef.current = startAt + audioBuffer.duration;
            audioDurationRef.current = audioBuffer.duration;

            setPhaseAndRef("playing");
            startProgressTracking();
            console.log("[TTS] First chunk playing, duration:", audioBuffer.duration.toFixed(2), "s");
          } else {
            // Subsequent chunks: schedule after previous + gap
            const startAt = Math.max(nextStartTimeRef.current + gap, ctx.currentTime);
            source.start(startAt);
            nextStartTimeRef.current = startAt + audioBuffer.duration;
            audioDurationRef.current = nextStartTimeRef.current - playStartTimeRef.current;
          }

          sourcesRef.current.push(source);
          setTotalDuration(audioDurationRef.current);
        } catch (err) {
          console.error(`[TTS] Chunk ${i + 1} failed:`, err);
        }
      }

      if (!firstPlayed && !cancelledRef.current) {
        console.error("[TTS] All chunks failed");
        cleanup();
        setPhaseAndRef("error");
        setTtsPlaying(false);
        setTimeout(() => setPhaseAndRef("idle"), 3000);
      }
    } catch (e) {
      console.error("[TTS] Progressive playback failed:", e);
      cleanup();
      setPhaseAndRef("error");
      setTtsPlaying(false);
      setTimeout(() => setPhaseAndRef("idle"), 3000);
    }
  }, [cleanup, resolvePlaybackChunks, startProgressTracking, stopAllTts, setTtsPlaying, setPhaseAndRef, resetState]);

  return { phase, progress, elapsed, totalDuration, toggle };
}

// ---------------------------------------------------------------------------
// TtsTriggerButton — small icon for the action bar
// ---------------------------------------------------------------------------

interface TriggerProps {
  phase: TtsPhase;
  onClick: () => void;
}

export function TtsTriggerButton({ phase, onClick }: TriggerProps) {
  const { t } = useI18n();
  const isActive = phase === "loading" || phase === "playing";

  if (isActive) {
    return (
      <button
        onClick={onClick}
        className="rounded-md p-1 text-primary transition-colors hover:bg-accent"
        title={t("停止朗读", "Stop reading")}
      >
        {phase === "loading" ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Square size={11} fill="currentColor" />
        )}
      </button>
    );
  }

  if (phase === "error") {
    return (
      <button className="rounded-md p-1 text-destructive" title={t("播放失败", "Failed")}>
        <VolumeX size={13} />
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      title={t("朗读", "Read aloud")}
    >
      <Volume2 size={13} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// TtsPlaybackBar — visible progress bar when loading/playing
// ---------------------------------------------------------------------------

interface BarProps {
  phase: TtsPhase;
  progress: number;
  elapsed: number;
  totalDuration: number;
  onStop: () => void;
}

export function TtsPlaybackBar({ phase, progress, elapsed, totalDuration, onStop }: BarProps) {
  const { t } = useI18n();
  const isActive = phase === "loading" || phase === "playing";
  const isLoading = phase === "loading";

  if (!isActive) return null;

  return (
    <div className="mt-1 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5">
      <button
        onClick={onStop}
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors",
          "bg-primary/10 text-primary hover:bg-primary/20"
        )}
        title={t("停止播放", "Stop")}
      >
        {isLoading ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Square size={10} fill="currentColor" />
        )}
      </button>

      <div className="flex-1">
        <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
          {isLoading ? (
            <div
              className="h-full w-1/3 rounded-full bg-primary/60"
              style={{ animation: "tts-loading 1.2s ease-in-out infinite" }}
            />
          ) : (
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          )}
        </div>
      </div>

      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
        {isLoading
          ? t("加载中…", "Loading…")
          : `${formatDuration(elapsed)} / ${formatDuration(totalDuration)}`}
      </span>

      <style>{`
        @keyframes tts-loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}
