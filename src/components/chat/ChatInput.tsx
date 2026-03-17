import { useState, useRef, useCallback } from "react";
import { Send, Square } from "lucide-react";
import { useAppStore } from "../../stores/appStore";

interface Props {
  onSend: (content: string) => void;
  onStop: () => void;
}

export function ChatInput({ onSend, onStop }: Props) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useAppStore((s) => s.isStreaming);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, isStreaming, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-zinc-800 p-4">
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          className="flex-1 bg-zinc-800 text-zinc-100 rounded-xl px-4 py-3 text-sm resize-none outline-none placeholder-zinc-500 border border-zinc-700 focus:border-zinc-500 transition-colors max-h-40 overflow-y-auto"
        />
        {isStreaming ? (
          <button
            onClick={onStop}
            className="p-3 rounded-xl bg-red-600 hover:bg-red-500 text-white transition-colors shrink-0"
            title="Stop generation"
          >
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="p-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white transition-colors shrink-0"
            title="Send message"
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
