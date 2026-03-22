import { useState } from "react";
import { Plus, Volume2, Play, Trash2, Edit2 } from "lucide-react";
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

export function VoiceManager() {
  const navigate = useNavigate();
  const { voices, loadVoices } = useAppStore();
  const [testingId, setTestingId] = useState<string | null>(null);
  const { t } = useI18n();

  const presetVoices = voices.filter((voice) => voice.is_preset);
  const customVoices = voices.filter((voice) => !voice.is_preset);

  const handleCreateNew = () => {
    navigate("/voices/new");
  };

  const handleDelete = async (id: string) => {
    await api.deleteVoice(id);
    await loadVoices();
  };

  const handleTest = async (voice: Voice) => {
    setTestingId(voice.id);
    try {
      const result = await api.ttsSynthesize(
        voice.id,
        t("你好，这是一段测试语音。", "Hello, this is a voice sample.")
      );
      const audio = new Audio(`data:${result.content_type};base64,${result.audio_base64}`);
      audio.onended = () => setTestingId(null);
      audio.onerror = () => setTestingId(null);
      await audio.play();
    } catch {
      setTestingId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-14 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <Volume2 className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t("声音管理", "Voice Manager")}</h1>
        </div>

        <Button onClick={handleCreateNew}>
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
                  isTesting={testingId === voice.id}
                  onTest={() => void handleTest(voice)}
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
                    isTesting={testingId === voice.id}
                    onEdit={() => navigate(`/voices/edit/${voice.id}`)}
                    onDelete={() => void handleDelete(voice.id)}
                    onTest={() => void handleTest(voice)}
                  />
                ))}
              </div>
            ) : (
              <Empty className="py-12">
                <EmptyTitle>{t("还没有自定义声音", "No custom voices yet")}</EmptyTitle>
                <EmptyDescription>
                  {t(
                    "点击右上角“新建声音”创建你的第一个自定义语音配置。",
                    'Click "New Voice" in the top-right corner to create your first custom voice profile.'
                  )}
                </EmptyDescription>
              </Empty>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

function VoiceCard({
  voice,
  onEdit,
  onDelete,
  onTest,
  isTesting,
}: {
  voice: Voice;
  onEdit?: () => void;
  onDelete?: () => void;
  onTest?: () => void;
  isTesting?: boolean;
}) {
  const { t } = useI18n();

  return (
    <Card className="transition-colors hover:bg-muted/30">
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            className="h-12 w-12 shrink-0 rounded-full"
            onClick={onTest}
            disabled={!onTest || isTesting}
          >
            <Play className="h-5 w-5" />
          </Button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{voice.display_name}</h3>
              {voice.is_preset ? (
                <Badge variant="secondary" className="text-xs">
                  {t("预设", "Preset")}
                </Badge>
              ) : null}
              <span className="font-mono text-xs text-muted-foreground">{voice.engine}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {voice.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
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
