import { useEffect, useState } from "react";
import { ArrowLeft, Save, Volume2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import * as api from "@/lib/tauri";
import { useI18n } from "@/lib/i18n";
import { useAppStore } from "@/stores/appStore";
import type { VoiceEngineConfig } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldGroup, Field, FieldLabel } from "@/components/ui/field";

const FORMATS = ["mp3", "wav", "opus"] as const;

export function VoiceEditor() {
  const navigate = useNavigate();
  const { voiceId } = useParams();
  const { t } = useI18n();
  const voices = useAppStore((s) => s.voices);
  const loadVoices = useAppStore((s) => s.loadVoices);
  const voice = voiceId ? voices.find((item) => item.id === voiceId) ?? null : null;

  const [formData, setFormData] = useState({
    name: "",
    engine: "qwen3-tts",
    endpoint: "http://127.0.0.1:8012",
    model: "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit",
    voiceName: "Vivian",
    speed: 1,
    format: "mp3" as (typeof FORMATS)[number],
    characterType: "character",
    tags: "",
  });

  const engineOptions = [
    { value: "qwen3-tts", label: t("Qwen3-TTS（本地）", "Qwen3-TTS (Local)") },
    { value: "custom", label: "Custom TTS" },
    { value: "openai-tts", label: "OpenAI TTS" },
  ];

  const characterTypeOptions = [
    { value: "character", label: t("角色", "Character") },
    { value: "background", label: t("旁白", "Narrator") },
  ];

  useEffect(() => {
    if (!voice) return;
    setFormData({
      name: voice.display_name,
      engine: voice.engine,
      endpoint: voice.engine_config.endpoint,
      model: voice.engine_config.model,
      voiceName: voice.engine_config.voice,
      speed: voice.engine_config.speed,
      format: voice.engine_config.response_format as (typeof FORMATS)[number],
      characterType: voice.role_type,
      tags: voice.tags.join(", "),
    });
  }, [voice]);

  const handleSubmit = async () => {
    const payload: VoiceEngineConfig = {
      endpoint: formData.endpoint,
      model: formData.model,
      voice: formData.voiceName,
      speed: formData.speed,
      response_format: formData.format,
    };
    const tags = formData.tags.split(",").map((tag) => tag.trim()).filter(Boolean);

    if (voice) {
      await api.updateVoice(
        voice.id,
        formData.name,
        formData.engine,
        payload,
        formData.characterType,
        tags
      );
    } else {
      await api.createVoice(
        formData.name,
        formData.engine,
        payload,
        formData.characterType,
        tags
      );
    }

    await loadVoices();
    navigate("/voices");
  };

  const handleCancel = () => {
    navigate("/voices");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-14 items-center gap-3 border-b border-border px-6">
        <Button variant="ghost" size="icon-sm" onClick={handleCancel}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3">
          <Volume2 className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-lg font-semibold">
            {voice ? t("编辑声音", "Edit Voice") : t("新建声音", "New Voice")}
          </h1>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-2xl p-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("声音配置", "Voice Profile")}</CardTitle>
              <CardDescription>
                {t(
                  "配置 TTS 引擎和声音参数，创建你的自定义语音配置。",
                  "Configure the TTS engine and voice parameters for a custom voice profile."
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="space-y-6">
                <Field>
                  <FieldLabel>{t("名称", "Name")}</FieldLabel>
                  <Input
                    placeholder={t("如：知性女声、低沉男声...", "Warm narrator, energetic voice...")}
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </Field>

                <Field>
                  <FieldLabel>{t("引擎", "Engine")}</FieldLabel>
                  <Select
                    value={formData.engine}
                    onValueChange={(value) => setFormData({ ...formData, engine: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("选择 TTS 引擎", "Choose a TTS engine")} />
                    </SelectTrigger>
                    <SelectContent>
                      {engineOptions.map((engine) => (
                        <SelectItem key={engine.value} value={engine.value}>
                          {engine.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("引擎配置", "Engine Settings")}
                  </p>

                  <Field>
                    <FieldLabel>Endpoint</FieldLabel>
                    <Input
                      value={formData.endpoint}
                      onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
                      className="font-mono text-sm"
                    />
                  </Field>

                  <Field>
                    <FieldLabel>Model</FieldLabel>
                    <Input
                      value={formData.model}
                      onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                      className="font-mono text-sm"
                    />
                  </Field>
                </div>

                <Field>
                  <FieldLabel>{t("音色", "Voice")}</FieldLabel>
                  <Input
                    placeholder="Vivian"
                    value={formData.voiceName}
                    onChange={(e) => setFormData({ ...formData, voiceName: e.target.value })}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel>{t("语速", "Speed")}</FieldLabel>
                    <Select
                      value={String(formData.speed)}
                      onValueChange={(value) =>
                        setFormData({ ...formData, speed: Number.parseFloat(value) })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                          <SelectItem key={speed} value={String(speed)}>
                            {speed}x
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel>{t("格式", "Format")}</FieldLabel>
                    <Select
                      value={formData.format}
                      onValueChange={(value) =>
                        setFormData({ ...formData, format: value as (typeof FORMATS)[number] })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FORMATS.map((format) => (
                          <SelectItem key={format} value={format}>
                            {format.toUpperCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <Field>
                  <FieldLabel>{t("角色类型", "Role Type")}</FieldLabel>
                  <Select
                    value={formData.characterType}
                    onValueChange={(value) =>
                      setFormData({ ...formData, characterType: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {characterTypeOptions.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel>{t("标签（逗号分隔）", "Tags (comma-separated)")}</FieldLabel>
                  <Input
                    placeholder={t("中文, 女声, 温柔", "English, narrator, warm")}
                    value={formData.tags}
                    onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  />
                </Field>

                <div className="flex items-center gap-3 border-t border-border pt-4">
                  <Button onClick={() => void handleSubmit()} disabled={!formData.name}>
                    <Save className="mr-2 h-4 w-4" />
                    {t("保存", "Save")}
                  </Button>
                  <Button variant="ghost" onClick={handleCancel}>
                    {t("取消", "Cancel")}
                  </Button>
                </div>
              </FieldGroup>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}
