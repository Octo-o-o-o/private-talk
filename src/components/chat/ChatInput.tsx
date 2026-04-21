import { ArrowUp, Square } from "lucide-react";
import { useRef, useState } from "react";
import { useAppStore } from "../../stores/appStore";
import type { LayoutMode } from "../layout/useLayoutMode";

interface ChatInputProps {
  layout: LayoutMode;
  onSend: (content: string) => void;
  onStop: () => void;
}

function resizeTextarea(element: HTMLTextAreaElement | null): void {
  if (!element) {
    return;
  }

  element.style.height = "0px";
  element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
}

export function ChatInput({ layout, onSend, onStop }: ChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useAppStore((s) => s.isStreaming);
  const selectedProviderId = useAppStore((s) => s.selectedProviderId);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const currentConversationId = useAppStore((s) => s.currentConversationId);

  const trimmed = input.trim();
  const canSend = !!selectedProviderId && !!selectedModel;
  const showStop = isStreaming;
  const sendDisabled = !showStop && (!trimmed || !canSend);
  const placeholder = !canSend
    ? "Add a provider in Settings to start chatting"
    : currentConversationId
      ? "Message Private Talk"
      : "Start a new conversation";

  function send(): void {
    if (!trimmed || isStreaming || !canSend) {
      return;
    }

    onSend(trimmed);
    setInput("");
    resizeTextarea(textareaRef.current);
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  return (
    <div className={`pt-compose pt-compose--${layout}`}>
      <div className="pt-compose__inner">
        <div className="pt-compose__field">
          <textarea
            ref={textareaRef}
            value={input}
            rows={1}
            placeholder={placeholder}
            className="pt-compose__textarea"
            onChange={(event) => {
              setInput(event.target.value);
              resizeTextarea(event.target);
            }}
            onKeyDown={handleKeyDown}
          />

          <button
            type="button"
            className={`pt-compose__send${
              sendDisabled ? " is-disabled" : ""
            }${showStop ? " is-stop" : ""}`}
            onClick={showStop ? onStop : send}
            disabled={sendDisabled}
            aria-label={showStop ? "Stop generation" : "Send message"}
            title={showStop ? "Stop generation" : "Send message"}
          >
            {showStop ? (
              <Square size={13} fill="currentColor" />
            ) : (
              <ArrowUp size={16} strokeWidth={2.8} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
