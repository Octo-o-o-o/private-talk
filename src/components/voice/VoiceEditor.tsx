import { useEffect, useState, useRef, useCallback } from "react";
import { ArrowLeft, Save, Volume2, Upload, X, FileAudio, Loader2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import * as api from "@/lib/tauri";
import { useI18n } from "@/lib/i18n";
import { useAppStore } from "@/stores/appStore";
import type { VoiceEngineConfig } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDesktopWindowDrag } from "@/hooks/useDesktopWindowDrag";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldGroup, Field, FieldLabel } from "@/components/ui/field";

const FORMATS = ["mp3", "wav", "opus"] as const;

/** Qwen3-TTS voice modes, determined by model choice */
type VoiceMode = "custom-voice" | "voice-design" | "voice-clone";

const MODEL_OPTIONS: { value: string; label: string; mode: VoiceMode }[] = [
  {
    value: "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit",
    label: "CustomVoice 1.7B (4bit)",
    mode: "custom-voice",
  },
  {
    value: "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-4bit",
    label: "CustomVoice 0.6B (4bit)",
    mode: "custom-voice",
  },
  {
    value: "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit",
    label: "VoiceDesign 1.7B (4bit)",
    mode: "voice-design",
  },
  {
    value: "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-4bit",
    label: "Base 1.7B (4bit) — Voice Clone",
    mode: "voice-clone",
  },
  {
    value: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
    label: "Base 0.6B (4bit) — Voice Clone",
    mode: "voice-clone",
  },
];

const PRESET_SPEAKERS = [
  "Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric",
  "Ryan", "Aiden", "Ono_Anna", "Sohee",
];

function detectMode(model: string): VoiceMode {
  const lower = model.toLowerCase();
  if (lower.includes("voicedesign")) return "voice-design";
  if (lower.includes("base") || lower.includes("clone")) return "voice-clone";
  return "custom-voice";
}

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "avi", "mkv", "m4v", "flv"]);
const MAX_REF_SECONDS = 10;

function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTENSIONS.has(ext);
}

function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsArrayBuffer(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/** Encode an AudioBuffer (first N seconds, mono) into a WAV Blob. */
function audioBufferToWav(buffer: AudioBuffer, maxSeconds: number): Blob {
  const sampleRate = buffer.sampleRate;
  const maxSamples = Math.min(buffer.length, Math.ceil(sampleRate * maxSeconds));
  // Mix down to mono
  const mono = new Float32Array(maxSamples);
  const channels = buffer.numberOfChannels;
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < maxSamples; i++) {
      mono[i] += data[i] / channels;
    }
  }
  // Convert to 16-bit PCM
  const pcm = new Int16Array(maxSamples);
  for (let i = 0; i < maxSamples; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  // Build WAV header
  const wavLen = 44 + pcm.length * 2;
  const wav = new ArrayBuffer(wavLen);
  const view = new DataView(wav);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, wavLen - 8, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  const output = new Int16Array(wav, 44);
  output.set(pcm);
  return new Blob([wav], { type: "audio/wav" });
}

/** Extract audio from a video file, trim to first N seconds, return as WAV base64. */
async function extractAudioFromVideo(file: File): Promise<string> {
  const arrayBuffer = await readFileAsArrayBuffer(file);
  const audioCtx = new AudioContext();
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const wavBlob = audioBufferToWav(audioBuffer, MAX_REF_SECONDS);
    return await readFileAsBase64(wavBlob);
  } finally {
    await audioCtx.close();
  }
}

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
    /** New upload: base64 data waiting to be saved to disk */
    refAudioBase64: "",
    /** Display name for the uploaded file */
    refAudioFileName: "",
    /** Existing saved file path (from a previous save) */
    refAudioPath: "",
    refText: "",
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [audioProcessing, setAudioProcessing] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const mode = detectMode(formData.model);

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
    const savedPath = voice.engine_config.ref_audio ?? "";
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
      refAudioBase64: "",
      refAudioFileName: savedPath
        ? savedPath.split("/").pop() ?? t("已保存的参考音频", "Saved reference audio")
        : "",
      refAudioPath: savedPath,
      refText: voice.engine_config.ref_text ?? "",
    });
  }, [voice, t]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setAudioError("");

    try {
      let base64: string;
      let displayName: string;

      if (isVideoFile(file)) {
        setAudioProcessing(true);
        base64 = await extractAudioFromVideo(file);
        displayName = `${file.name} (${t("已提取前 10 秒音频", "first 10s audio extracted")})`;
      } else {
        base64 = await readFileAsBase64(file);
        displayName = file.name;
      }

      setFormData((prev) => ({
        ...prev,
        refAudioBase64: base64,
        refAudioFileName: displayName,
        refAudioPath: "", // clear old saved path since we have a new upload
      }));
    } catch {
      setAudioError(
        t(
          "无法从文件中提取音频，请尝试其他文件格式",
          "Failed to extract audio from file. Please try another format."
        )
      );
    } finally {
      setAudioProcessing(false);
    }
  }, [t]);

  const handleClearAudio = useCallback(() => {
    setFormData((prev) => ({
      ...prev,
      refAudioBase64: "",
      refAudioFileName: "",
      refAudioPath: "",
    }));
  }, []);

  const handleSubmit = async () => {
    setSaving(true);
    setSaveError("");

    try {
      const payload: VoiceEngineConfig = {
        endpoint: formData.endpoint,
        model: formData.model,
        voice: formData.voiceName,
        speed: formData.speed,
        response_format: formData.format,
      };

      // Voice Clone mode: save ref audio to disk, store file path
      if (mode === "voice-clone") {
        if (formData.refAudioBase64) {
          const filePath = await api.saveRefAudio(formData.refAudioBase64, "ref.wav");
          payload.ref_audio = filePath;
        } else if (formData.refAudioPath) {
          payload.ref_audio = formData.refAudioPath;
        }
        if (formData.refText.trim()) {
          payload.ref_text = formData.refText.trim();
        }
      }

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
    } catch (e) {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    navigate("/voices");
  };

  const isQwen = formData.engine === "qwen3-tts";
  const headerDragProps = useDesktopWindowDrag();

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col bg-background">
      <div
        {...headerDragProps}
        className="flex h-14 select-none items-center gap-3 border-b border-border px-4 md:px-6"
      >
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
        <div className="mx-auto w-full max-w-2xl p-4 md:p-6" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
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

                  {isQwen ? (
                    <Field>
                      <FieldLabel>Model</FieldLabel>
                      <Select
                        value={formData.model}
                        onValueChange={(value) => setFormData({ ...formData, model: value })}
                      >
                        <SelectTrigger className="font-mono text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MODEL_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {mode === "custom-voice" &&
                          t("使用预设音色 + 可选风格指令", "Preset speakers with optional style instruct")}
                        {mode === "voice-design" &&
                          t("用自然语言描述声音特征", "Describe voice characteristics in natural language")}
                        {mode === "voice-clone" &&
                          t("上传 3 秒参考音频，零样本克隆声音", "Upload 3s reference audio for zero-shot voice cloning")}
                      </p>
                    </Field>
                  ) : (
                    <Field>
                      <FieldLabel>Model</FieldLabel>
                      <Input
                        value={formData.model}
                        onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                        className="font-mono text-sm"
                      />
                    </Field>
                  )}
                </div>

                {/* ── Mode-specific voice config ── */}

                {mode === "custom-voice" && (
                  <Field>
                    <FieldLabel>{t("音色 / Speaker", "Speaker")}</FieldLabel>
                    {isQwen ? (
                      <Select
                        value={formData.voiceName}
                        onValueChange={(value) => setFormData({ ...formData, voiceName: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRESET_SPEAKERS.map((name) => (
                            <SelectItem key={name} value={name}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        placeholder="Vivian"
                        value={formData.voiceName}
                        onChange={(e) => setFormData({ ...formData, voiceName: e.target.value })}
                      />
                    )}
                  </Field>
                )}

                {mode === "voice-design" && (
                  <Field>
                    <FieldLabel>{t("声音描述 / Voice Description", "Voice Description")}</FieldLabel>
                    <Textarea
                      placeholder={t(
                        "用自然语言描述声音，如：A cheerful young female voice with high pitch and lively energy.",
                        "Describe the voice in natural language, e.g.: A cheerful young female voice with high pitch and lively energy."
                      )}
                      value={formData.voiceName}
                      onChange={(e) => setFormData({ ...formData, voiceName: e.target.value })}
                      rows={3}
                    />
                  </Field>
                )}

                {mode === "voice-clone" && (
                  <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
                    <p className="text-sm font-medium text-muted-foreground">
                      {t("声音克隆配置", "Voice Clone Settings")}
                    </p>

                    <Field>
                      <FieldLabel>{t("参考音频", "Reference Audio")}</FieldLabel>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="audio/*,video/*"
                        className="hidden"
                        onChange={(e) => void handleFileSelect(e)}
                      />
                      {audioProcessing ? (
                        <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-3 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t("正在从视频中提取音频...", "Extracting audio from video...")}
                        </div>
                      ) : formData.refAudioFileName ? (
                        <div className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2">
                          <FileAudio className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {formData.refAudioFileName}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={handleClearAudio}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          className="w-full justify-center gap-2"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Upload className="h-4 w-4" />
                          {t("上传音频或视频文件（建议 3~10 秒）", "Upload audio or video file (3-10s recommended)")}
                        </Button>
                      )}
                      {audioError ? (
                        <p className="mt-1 text-xs text-destructive">{audioError}</p>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t(
                            "支持音频（mp3、wav、m4a）和视频（mp4、mov、webm）文件，视频会自动提取前 10 秒音频",
                            "Supports audio (mp3, wav, m4a) and video (mp4, mov, webm) files. Audio from the first 10s of video will be extracted automatically."
                          )}
                        </p>
                      )}
                    </Field>

                    <Field>
                      <FieldLabel>{t("参考音频文字", "Reference Transcript")}</FieldLabel>
                      <Textarea
                        placeholder={t(
                          "输入参考音频中说话的内容，帮助模型更准确地克隆声音",
                          "Type what is spoken in the reference audio to help the model clone the voice more accurately"
                        )}
                        value={formData.refText}
                        onChange={(e) => setFormData({ ...formData, refText: e.target.value })}
                        rows={2}
                      />
                    </Field>
                  </div>
                )}

                {/* ── Common fields ── */}

                {mode !== "voice-clone" && mode !== "voice-design" && !isQwen && (
                  <Field>
                    <FieldLabel>{t("音色", "Voice")}</FieldLabel>
                    <Input
                      placeholder="Vivian"
                      value={formData.voiceName}
                      onChange={(e) => setFormData({ ...formData, voiceName: e.target.value })}
                    />
                  </Field>
                )}

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
                        {[0.5, 0.75, 1, 1.1, 1.15, 1.2, 1.25, 1.5, 2].map((speed) => (
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

                {saveError ? (
                  <p className="text-sm text-destructive">{saveError}</p>
                ) : null}

                <div className="flex items-center gap-3 border-t border-border pt-4">
                  <Button
                    onClick={() => void handleSubmit()}
                    disabled={
                      saving ||
                      !formData.name ||
                      (mode === "voice-clone" && !formData.refAudioBase64 && !formData.refAudioPath)
                    }
                  >
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    {saving ? t("保存中...", "Saving...") : t("保存", "Save")}
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
