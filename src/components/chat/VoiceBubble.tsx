import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Pause, Play, Volume2 } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { cn } from "@/lib/utils";
import type { Attachment } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

interface VoiceBubbleProps {
  attachment: Attachment;
  transcript?: string;
  isUser?: boolean;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, "0")}`;
}

export function VoiceBubble({
  attachment,
  transcript,
  isUser = false,
}: VoiceBubbleProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const src = useMemo(() => convertFileSrc(attachment.file_path), [attachment.file_path]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setLoadFailed(false);
    setShowTranscript(false);
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const syncTime = () => setCurrentTime(audio.currentTime || 0);
    const syncDuration = () => setDuration(audio.duration || 0);
    const syncEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const syncError = () => {
      setLoadFailed(true);
      setIsPlaying(false);
    };

    audio.addEventListener("timeupdate", syncTime);
    audio.addEventListener("loadedmetadata", syncDuration);
    audio.addEventListener("ended", syncEnded);
    audio.addEventListener("error", syncError);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", syncTime);
      audio.removeEventListener("loadedmetadata", syncDuration);
      audio.removeEventListener("ended", syncEnded);
      audio.removeEventListener("error", syncError);
    };
  }, [src]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || loadFailed) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    try {
      await audio.play();
      setIsPlaying(true);
    } catch (error) {
      console.error("Failed to play voice attachment:", error);
      setLoadFailed(true);
    }
  };

  const progress = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
  const toneClass = isUser
    ? {
        button: "bg-primary-foreground/16 text-primary-foreground hover:bg-primary-foreground/24",
        track: "bg-primary-foreground/16",
        progress: "bg-primary-foreground",
        text: "text-primary-foreground/85",
        hint: "text-primary-foreground/65",
        divider: "border-primary-foreground/12",
      }
    : {
        button: "bg-accent text-foreground hover:bg-accent/80",
        track: "bg-foreground/10",
        progress: "bg-primary",
        text: "text-foreground/85",
        hint: "text-muted-foreground",
        divider: "border-border",
      };

  return (
    <div className="min-w-[220px] max-w-[320px]">
      <audio ref={audioRef} src={src} preload="metadata" />

      {loadFailed ? (
        <div
          className={cn(
            "flex items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-xs",
            toneClass.divider,
            toneClass.hint
          )}
        >
          <Volume2 className="h-3.5 w-3.5" />
          <span>{t("语音文件加载失败", "Voice file could not be loaded")}</span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={togglePlayback}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                toneClass.button
              )}
              title={isPlaying ? t("暂停", "Pause") : t("播放", "Play")}
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
            </button>
            <div className="flex-1">
              <div className={cn("h-1.5 overflow-hidden rounded-full", toneClass.track)}>
                <div
                  className={cn("h-full rounded-full transition-[width]", toneClass.progress)}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <span className={cn("w-10 text-right font-mono text-xs tabular-nums", toneClass.text)}>
              {formatDuration(duration || currentTime)}
            </span>
          </div>

          {transcript ? (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowTranscript((value) => !value)}
                className={cn(
                  "inline-flex items-center gap-1 text-xs transition-colors",
                  toneClass.hint,
                  isUser ? "hover:text-primary-foreground" : "hover:text-foreground"
                )}
              >
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    showTranscript && "rotate-180"
                  )}
                />
                {showTranscript
                  ? t("收起转写", "Hide transcript")
                  : t("查看转写", "View transcript")}
              </button>

              {showTranscript ? (
                <div
                  className={cn(
                    "mt-2 border-t pt-2 text-xs leading-relaxed whitespace-pre-wrap",
                    toneClass.divider,
                    toneClass.text
                  )}
                >
                  {transcript}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
