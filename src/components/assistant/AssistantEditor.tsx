import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Save,
  Sparkles,
} from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import * as api from "../../lib/tauri";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAppStore } from "../../stores/appStore";
import { SystemPromptEditor } from "./SystemPromptEditor";
import { VoiceMappingEditor } from "../voice/VoiceMappingEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDesktopWindowDrag } from "@/hooks/useDesktopWindowDrag";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { ASSISTANT_ICONS } from "./assistantIcons";

export function AssistantEditor() {
  const navigate = useNavigate();
  const location = useLocation();
  const { assistantId, scenarioId } = useParams();
  const activeAssistantId = assistantId ?? scenarioId;
  const { t, tField } = useI18n();
  const assistants = useAppStore((s) => s.assistants);
  const loadAssistants = useAppStore((s) => s.loadAssistants);
  const editingAssistant = activeAssistantId
    ? assistants.find((assistant) => assistant.id === activeAssistantId) ?? null
    : null;
  const isNew = !activeAssistantId;
  const isPreset = location.pathname.includes("/view/") || (editingAssistant?.is_preset ?? false);
  const isMissing = Boolean(activeAssistantId) && !editingAssistant;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [voiceMapping, setVoiceMapping] = useState<Record<string, string | null>>({});
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const headerDragProps = useDesktopWindowDrag();

  useEffect(() => {
    if (editingAssistant) {
      setName(tField(editingAssistant.name, editingAssistant.name_en));
      setDescription(tField(editingAssistant.description, editingAssistant.description_en));
      setIcon(editingAssistant.icon || "");
      setSystemPrompt(editingAssistant.system_prompt);
      setVoiceMapping(editingAssistant.voice_mapping || {});
      setTtsEnabled(editingAssistant.tts_enabled ?? false);
      setAutoPlay(editingAssistant.auto_play ?? false);
      return;
    }

    setName("");
    setDescription("");
    setIcon("");
    setSystemPrompt("");
    setVoiceMapping({});
    setTtsEnabled(false);
    setAutoPlay(false);
  }, [editingAssistant, tField]);

  const handleSave = async () => {
    setError("");
    if (!name.trim()) {
      setError(t("助手名称不能为空", "Assistant name is required"));
      return;
    }

    setSaving(true);
    try {
      if (isNew) {
        await api.createAssistant(
          name.trim(),
          description.trim(),
          systemPrompt,
          icon || undefined,
          voiceMapping,
          ttsEnabled,
          autoPlay
        );
      } else if (editingAssistant) {
        await api.updateAssistant(
          editingAssistant.id,
          name.trim(),
          description.trim(),
          systemPrompt,
          icon,
          voiceMapping,
          ttsEnabled,
          autoPlay
        );
      }

      await loadAssistants();
      navigate("/assistants");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    navigate("/assistants");
  };

  if (isMissing) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div
          {...headerDragProps}
          className="flex h-14 select-none items-center gap-3 border-b border-border px-4 md:px-6"
        >
          <Button variant="ghost" size="icon-sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">{t("助手", "Assistant")}</h1>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <Card className="w-full max-w-xl">
            <CardContent className="flex items-center gap-3 p-6">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <p className="text-sm text-muted-foreground">
                {t("未找到所选助手。", "The selected assistant could not be found.")}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col bg-background">
      <div
        {...headerDragProps}
        className="flex h-14 select-none items-center gap-3 border-b border-border px-4 md:px-6"
      >
        <Button variant="ghost" size="icon-sm" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">
              {isPreset
                ? t("助手预览", "Assistant Preview")
                : isNew
                  ? t("新建助手", "New Assistant")
                  : t("编辑助手", "Edit Assistant")}
            </h1>
            {isPreset ? <Badge variant="secondary">{t("预设", "Preset")}</Badge> : null}
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-4xl space-y-4 p-4 pb-safe-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("助手资料", "Assistant Profile")}</CardTitle>
              <CardDescription>
                {t(
                  "定义助手列表中展示的名称和简介。",
                  "Define the name and summary shown in the assistant list."
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="space-y-4">
                <Field>
                  <FieldLabel>{t("名称", "Name")}</FieldLabel>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    readOnly={isPreset}
                    placeholder={t("翻译、写作、导师、陪练...", "Translator, Writing coach, Tutor...")}
                  />
                </Field>

                <Field>
                  <FieldLabel>{t("描述", "Description")}</FieldLabel>
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    readOnly={isPreset}
                    placeholder={t("给侧边栏和选择器看的简短摘要。", "Short summary for the sidebar and picker.")}
                  />
                </Field>

                <Field>
                  <FieldLabel>{t("图标", "Icon")}</FieldLabel>
                  <FieldDescription>
                    {t("选择一个图标，在会话列表中标识这个助手。", "Pick an icon to identify this assistant in the chat list.")}
                  </FieldDescription>
                  <AssistantIconPicker value={icon} onChange={setIcon} disabled={isPreset} />
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("提示词设计", "Prompt Design")}</CardTitle>
              <CardDescription>
                {t(
                  "设置所有使用这个助手开始的新会话都会继承的系统指令。",
                  "Set the instructions every new chat started with this assistant will inherit."
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SystemPromptEditor value={systemPrompt} onChange={setSystemPrompt} readOnly={isPreset} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("语音行为", "Voice Behavior")}</CardTitle>
              <CardDescription>
                {t(
                  "控制这个助手的回复是否可以合成语音，并把特定角色路由到指定声音。",
                  "Control whether this assistant's replies can be spoken aloud and route specific roles to voices."
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="space-y-4">
                <Field orientation="horizontal">
                  <FieldLabel>{t("启用 TTS", "Enable TTS")}</FieldLabel>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={ttsEnabled}
                      onCheckedChange={setTtsEnabled}
                      disabled={isPreset}
                    />
                    <FieldDescription>
                      {t(
                        "允许这个助手的回复被合成为语音。",
                        "Allow this assistant's replies to be synthesized."
                      )}
                    </FieldDescription>
                  </div>
                </Field>

                <Field orientation="horizontal">
                  <FieldLabel>{t("自动播放回复", "Autoplay Replies")}</FieldLabel>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={autoPlay}
                      onCheckedChange={setAutoPlay}
                      disabled={isPreset || !ttsEnabled}
                    />
                    <FieldDescription>
                      {t(
                        "有可用语音时自动开始播放。",
                        "Start playback automatically when a compatible voice is available."
                      )}
                    </FieldDescription>
                  </div>
                </Field>

                {ttsEnabled ? (
                  <VoiceMappingEditor
                    mapping={voiceMapping}
                    onChange={setVoiceMapping}
                    readOnly={isPreset}
                  />
                ) : null}
              </FieldGroup>
            </CardContent>
          </Card>

          {error ? (
            <Card className="border-destructive/40">
              <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
            </Card>
          ) : null}

          {!isPreset ? (
            <div className="flex items-center gap-3">
              <Button onClick={() => void handleSave()} disabled={saving || !name.trim()}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? t("保存中...", "Saving...") : t("保存", "Save")}
              </Button>
              <Button variant="ghost" onClick={handleBack}>
                {t("取消", "Cancel")}
              </Button>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Assistant Icon Picker ──

function AssistantIconPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(ASSISTANT_ICONS).map(([key, Icon]) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(value === key ? "" : key)}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
            value === key
              ? "border-primary bg-primary/10 text-primary"
              : "border-border/50 text-muted-foreground hover:border-border hover:bg-muted/50",
            disabled && "pointer-events-none opacity-50"
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}
