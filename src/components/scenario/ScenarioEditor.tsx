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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { SCENARIO_ICONS } from "./scenarioIcons";

export function ScenarioEditor() {
  const navigate = useNavigate();
  const location = useLocation();
  const { scenarioId } = useParams();
  const { t, tField } = useI18n();
  const scenarios = useAppStore((s) => s.scenarios);
  const loadScenarios = useAppStore((s) => s.loadScenarios);
  const editingScenario = scenarioId
    ? scenarios.find((scenario) => scenario.id === scenarioId) ?? null
    : null;
  const isNew = !scenarioId;
  const isPreset = location.pathname.includes("/view/") || (editingScenario?.is_preset ?? false);
  const isMissing = Boolean(scenarioId) && !editingScenario;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [voiceMapping, setVoiceMapping] = useState<Record<string, string | null>>({});
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingScenario) {
      setName(tField(editingScenario.name, editingScenario.name_en));
      setDescription(tField(editingScenario.description, editingScenario.description_en));
      setIcon(editingScenario.icon || "");
      setSystemPrompt(editingScenario.system_prompt);
      setVoiceMapping(editingScenario.voice_mapping || {});
      setTtsEnabled(editingScenario.tts_enabled ?? false);
      setAutoPlay(editingScenario.auto_play ?? false);
      return;
    }

    setName("");
    setDescription("");
    setIcon("");
    setSystemPrompt("");
    setVoiceMapping({});
    setTtsEnabled(false);
    setAutoPlay(false);
  }, [editingScenario, tField]);

  const handleSave = async () => {
    setError("");
    if (!name.trim()) {
      setError(t("场景名称不能为空", "Scenario name is required"));
      return;
    }

    setSaving(true);
    try {
      if (isNew) {
        await api.createScenario(
          name.trim(),
          description.trim(),
          systemPrompt,
          icon || undefined,
          voiceMapping,
          ttsEnabled,
          autoPlay
        );
      } else if (editingScenario) {
        await api.updateScenario(
          editingScenario.id,
          name.trim(),
          description.trim(),
          systemPrompt,
          icon,
          voiceMapping,
          ttsEnabled,
          autoPlay
        );
      }

      await loadScenarios();
      navigate("/scenarios");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    navigate("/scenarios");
  };

  if (isMissing) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex h-14 items-center gap-3 border-b border-border px-6">
          <Button variant="ghost" size="icon-sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">{t("场景", "Scenario")}</h1>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <Card className="w-full max-w-xl">
            <CardContent className="flex items-center gap-3 p-6">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <p className="text-sm text-muted-foreground">
                {t("未找到所选场景。", "The selected scenario could not be found.")}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-14 items-center gap-3 border-b border-border px-6">
        <Button variant="ghost" size="icon-sm" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">
              {isPreset
                ? t("场景预览", "Scenario Preview")
                : isNew
                  ? t("新建场景", "New Scenario")
                  : t("编辑场景", "Edit Scenario")}
            </h1>
            {isPreset ? <Badge variant="secondary">{t("预设", "Preset")}</Badge> : null}
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-4xl space-y-4 p-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("场景资料", "Scenario Profile")}</CardTitle>
              <CardDescription>
                {t(
                  "定义场景选择器中展示的标题和简介。",
                  "Define the label and summary shown in the scenario picker."
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
                    placeholder={t("角色扮演、翻译、导师...", "Character roleplay, Translation, Tutor...")}
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
                    {t("选择一个图标，在会话列表中标识此场景。", "Pick an icon to identify this scenario in the session list.")}
                  </FieldDescription>
                  <ScenarioIconPicker value={icon} onChange={setIcon} disabled={isPreset} />
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("提示词设计", "Prompt Design")}</CardTitle>
              <CardDescription>
                {t(
                  "设置所有基于这个场景创建的新会话都会继承的系统指令。",
                  "Set the system instructions applied to every new session created under this scenario."
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
                  "控制场景回复是否可以合成语音，并把特定角色路由到指定声音。",
                  "Control whether scenario replies can synthesize audio and route specific roles to voices."
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
                        "允许这个场景里的助手回复被合成为语音。",
                        "Allow assistant replies in this scenario to be synthesized."
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

// ── Scenario Icon Picker ──

function ScenarioIconPicker({
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
      {Object.entries(SCENARIO_ICONS).map(([key, Icon]) => (
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
