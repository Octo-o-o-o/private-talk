import { useState, useRef, useCallback } from "react";
import { Plus, Volume2, Play, Square, Loader2, Trash2, Edit2, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import * as api from "@/lib/tauri";
import { useI18n } from "@/lib/i18n";
import { useAppStore } from "@/stores/appStore";
import type { Voice } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Empty, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const TEST_TEXT_ZH =
  "春风轻轻吹过窗台，带来了花园里淡淡的清香。这样美好的午后，最适合泡一杯茶，静静地读一本好书。";
const TEST_TEXT_EN =
  "The morning sun cast golden light across the quiet garden, filling the air with warmth. It was the kind of day that made you want to slow down and simply enjoy the moment.";

export function VoiceManager() {
  const navigate = useNavigate();
  const { voices, loadVoices, loadAssistants } = useAppStore();
  const { t } = useI18n();

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopCurrent = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current = null;
    }
    setPlayingId(null);
  }, []);

  const handleTest = useCallback(
    async (voice: Voice) => {
      // If clicking the currently playing voice, just stop it
      if (playingId === voice.id) {
        stopCurrent();
        return;
      }

      // Stop any currently playing audio first
      stopCurrent();
      setErrorId(null);
      setLoadingId(voice.id);

      try {
        const result = await api.ttsSynthesize(
          voice.id,
          t(TEST_TEXT_ZH, TEST_TEXT_EN)
        );
        const audio = new Audio(
          `data:${result.content_type};base64,${result.audio_base64}`
        );
        audioRef.current = audio;

        audio.onended = () => {
          audioRef.current = null;
          setPlayingId(null);
        };
        audio.onerror = () => {
          audioRef.current = null;
          setPlayingId(null);
          setErrorId(voice.id);
          setErrorMsg(t("音频播放失败，请重试", "Audio playback failed, please try again"));
        };

        setLoadingId(null);
        setPlayingId(voice.id);
        await audio.play();
      } catch (e) {
        setLoadingId(null);
        setErrorId(voice.id);
        const msg =
          e instanceof Error ? e.message : typeof e === "string" ? e : "";
        if (msg.includes("connect") || msg.includes("Connection")) {
          setErrorMsg(
            t(
              "无法连接语音服务，请确认 TTS 服务已启动",
              "Cannot connect to TTS service. Please make sure the TTS server is running."
            )
          );
        } else {
          setErrorMsg(
            t(
              `语音合成失败：${msg || "未知错误"}`,
              `Voice synthesis failed: ${msg || "Unknown error"}`
            )
          );
        }
      }
    },
    [playingId, stopCurrent, t]
  );

  const presetVoices = voices.filter((voice) => voice.is_preset);
  const customVoices = voices.filter((voice) => !voice.is_preset);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-14 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <Volume2 className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t("声音管理", "Voice Manager")}</h1>
        </div>

        <Button onClick={() => navigate("/voices/new")}>
          <Plus className="mr-2 h-4 w-4" />
          {t("新建声音", "New Voice")}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-4xl space-y-8 p-6">
          <section>
            <h2 className="mb-4 text-sm uppercase tracking-wider text-muted-foreground">
              {t("预设声音", "Preset Voices")}
            </h2>
            <div className="space-y-3">
              {presetVoices.map((voice) => (
                <VoiceCard
                  key={voice.id}
                  voice={voice}
                  isPlaying={playingId === voice.id}
                  isLoading={loadingId === voice.id}
                  error={errorId === voice.id ? errorMsg : undefined}
                  onTest={() => void handleTest(voice)}
                  onDismissError={() => setErrorId(null)}
                />
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-sm uppercase tracking-wider text-muted-foreground">
              {t("自定义声音", "Custom Voices")}
            </h2>
            {customVoices.length > 0 ? (
              <div className="space-y-3">
                {customVoices.map((voice) => (
                  <VoiceCard
                    key={voice.id}
                    voice={voice}
                    isPlaying={playingId === voice.id}
                    isLoading={loadingId === voice.id}
                    error={errorId === voice.id ? errorMsg : undefined}
                    onEdit={() => navigate(`/voices/edit/${voice.id}`)}
                    onDelete={() => { setPendingDeleteId(voice.id); setDeleteConfirmOpen(true); }}
                    onTest={() => void handleTest(voice)}
                    onDismissError={() => setErrorId(null)}
                  />
                ))}
              </div>
            ) : (
              <Empty className="py-12">
                <EmptyTitle>{t("还没有自定义声音", "No custom voices yet")}</EmptyTitle>
                <EmptyDescription>
                  {t(
                    "点击右上角「新建声音」创建你的第一个自定义语音配置。",
                    'Click "New Voice" in the top-right corner to create your first custom voice profile.'
                  )}
                </EmptyDescription>
              </Empty>
            )}
          </section>
        </div>
      </ScrollArea>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("删除声音？", "Delete voice?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "此操作将永久删除该声音配置，无法撤销。",
                "This will permanently delete this voice. This action cannot be undone."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("取消", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (pendingDeleteId) {
                if (playingId === pendingDeleteId) stopCurrent();
                void api.deleteVoice(pendingDeleteId).then(() =>
                  Promise.all([loadVoices(), loadAssistants()])
                );
              }
            }}>
              {t("确认删除", "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function VoiceCard({
  voice,
  onEdit,
  onDelete,
  onTest,
  onDismissError,
  isPlaying,
  isLoading,
  error,
}: {
  voice: Voice;
  onEdit?: () => void;
  onDelete?: () => void;
  onTest?: () => void;
  onDismissError?: () => void;
  isPlaying?: boolean;
  isLoading?: boolean;
  error?: string;
}) {
  const { t, tField, tArray } = useI18n();

  const displayName = tField(voice.display_name, voice.display_name_en);
  const displayTags = tArray(voice.tags, voice.tags_en);

  return (
    <Card className="transition-colors hover:bg-muted/30">
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          <Button
            variant={isPlaying ? "default" : "outline"}
            size="icon"
            className="h-12 w-12 shrink-0 rounded-full"
            onClick={onTest}
            disabled={!onTest || isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : isPlaying ? (
              <Square className="h-4 w-4" />
            ) : (
              <Play className="h-5 w-5" />
            )}
          </Button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{displayName}</h3>
              {voice.is_preset ? (
                <Badge variant="secondary" className="text-xs">
                  {t("预设", "Preset")}
                </Badge>
              ) : null}
              <span className="font-mono text-xs text-muted-foreground">{voice.engine}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {displayTags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
            {error ? (
              <button
                className="mt-2 flex items-center gap-1.5 text-xs text-destructive hover:opacity-70"
                onClick={onDismissError}
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {onEdit ? (
              <Button variant="ghost" size="icon" onClick={onEdit}>
                <Edit2 className="h-4 w-4" />
              </Button>
            ) : null}
            {!voice.is_preset && onDelete ? (
              <Button variant="ghost" size="icon" onClick={onDelete}>
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
