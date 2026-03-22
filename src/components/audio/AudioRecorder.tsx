import { useState, useRef } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import * as api from "../../lib/tauri";
import { useI18n } from "@/lib/i18n";
import { useAppStore } from "../../stores/appStore";

interface Props {
  onTranscription: (text: string) => void;
}

export function AudioRecorder({ onTranscription }: Props) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const { selectedProviderId } = useAppStore();
  const { t } = useI18n();

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());

        if (!selectedProviderId) {
          console.error("No provider selected for STT");
          return;
        }

        setTranscribing(true);
        try {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const dataUrl = reader.result as string;
              const b64 = dataUrl.split(",")[1] || "";
              resolve(b64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          const text = await api.sttTranscribe(base64, selectedProviderId);
          if (text.trim()) onTranscription(text.trim());
        } catch (e) {
          console.error("STT failed:", e);
        } finally {
          setTranscribing(false);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
    } catch (e) {
      console.error("Microphone access denied:", e);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  if (transcribing) {
    return (
      <button
        disabled
        className="shrink-0 rounded-md p-2 text-muted-foreground"
        title={t("转写中...", "Transcribing...")}
      >
        <Loader2 size={16} className="animate-spin" />
      </button>
    );
  }

  if (recording) {
    return (
      <button
        onClick={stopRecording}
        className="shrink-0 rounded-md bg-destructive/10 p-2 text-destructive transition-colors hover:bg-destructive/15"
        style={{ animation: "pulse-ring 1.5s ease-out infinite" }}
        title={t("停止录音", "Stop recording")}
      >
        <Square size={16} fill="currentColor" />
      </button>
    );
  }

  return (
    <button
      onClick={startRecording}
      className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      title={t("语音输入", "Voice input")}
    >
      <Mic size={16} />
    </button>
  );
}
