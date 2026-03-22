import { useRef, useState } from "react";
import { Loader2, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { useAppStore } from "../../stores/appStore";
import { AudioRecorder } from "../audio/AudioRecorder";

interface Props {
  onSend: (content: string) => void;
  onStop: () => void;
}

export function ChatInput({ onSend, onStop }: Props) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isStreaming = useAppStore((s) => s.isStreaming);
  const streamingConversationId = useAppStore((s) => s.streamingConversationId);
  const currentConversationId = useAppStore((s) => s.currentConversationId);
  const { t } = useI18n();

  // Another conversation is streaming — block input in this conversation
  const isOtherStreaming =
    isStreaming &&
    streamingConversationId !== null &&
    streamingConversationId !== currentConversationId;

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming || isOtherStreaming) return;
    onSend(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTranscription = (text: string) => {
    setInput((prev) => (prev ? prev + " " + text : text));
    inputRef.current?.focus();
  };

  return (
    <div className="border-t border-border p-4">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-3">
        <AudioRecorder onTranscription={handleTranscription} />
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isOtherStreaming
                ? t("其他会话生成中，请稍候...", "Another session is generating, please wait...")
                : t("输入消息...", "Type a message...")
            }
            disabled={isOtherStreaming}
            className="border-border bg-input pr-12"
          />
          {isStreaming && !isOtherStreaming ? (
            <Button
              type="button"
              onClick={onStop}
              variant="ghost"
              size="icon-sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 text-destructive hover:text-destructive"
              title={t("停止生成", "Stop generation")}
            >
              <Square className="h-4 w-4 fill-current" />
            </Button>
          ) : isOtherStreaming ? (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : (
            <Button
              type="button"
              onClick={handleSend}
              disabled={!input.trim()}
              variant="ghost"
              size="icon-sm"
              className="absolute right-1 top-1/2 -translate-y-1/2"
              title={t("发送消息", "Send message")}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
