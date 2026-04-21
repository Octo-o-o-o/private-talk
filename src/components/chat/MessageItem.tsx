import { Check, Copy } from "lucide-react";
import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";
import type { Role } from "../../lib/types";

interface MessageItemProps {
  role: Role;
  content: string;
  isStreaming?: boolean;
}

export function MessageItem({
  role,
  content,
  isStreaming = false,
}: MessageItemProps) {
  if (role === "user") {
    return (
      <div className="pt-message pt-message--user">
        <div className="pt-message__bubble pt-message__bubble--user">
          {content}
        </div>
      </div>
    );
  }

  return <AssistantMessage content={content} isStreaming={isStreaming} />;
}

function AssistantMessage({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming: boolean;
}) {
  const [copied, setCopied] = useState(false);

  function copyToClipboard(value: string): void {
    navigator.clipboard.writeText(value).catch((error) => {
      console.warn("Failed to copy code block:", error);
    });
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="pt-message pt-message--assistant">
      <div className="pt-message__bubble pt-message__bubble--assistant">
        <div className="pt-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={buildMarkdownComponents(copied, copyToClipboard)}
          >
            {content}
          </ReactMarkdown>
          {isStreaming ? <span className="pt-message__cursor" /> : null}
        </div>
      </div>
    </div>
  );
}

function buildMarkdownComponents(
  copied: boolean,
  onCopy: (value: string) => void,
): Components {
  return {
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || "");
      const code = String(children).replace(/\n$/, "");

      if (!match) {
        return (
          <code className="pt-markdown__inline-code" {...props}>
            {children}
          </code>
        );
      }

      return (
        <div className="pt-code-block">
          <div className="pt-code-block__toolbar">
            <span>{match[1]}</span>
            <button
              type="button"
              className="pt-code-block__copy"
              onClick={() => onCopy(code)}
              aria-label={copied ? "Copied" : "Copy code"}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
          <SyntaxHighlighter
            style={oneDark}
            language={match[1]}
            PreTag="div"
            customStyle={{
              margin: 0,
              borderRadius: 0,
              padding: "12px 14px",
              background: "#0e0e10",
              fontSize: "12px",
              lineHeight: 1.55,
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      );
    },
    p({ children }) {
      return <p>{children}</p>;
    },
    ul({ children }) {
      return <ul>{children}</ul>;
    },
    ol({ children }) {
      return <ol>{children}</ol>;
    },
    blockquote({ children }) {
      return <blockquote>{children}</blockquote>;
    },
    a({ href, children }) {
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    },
    table({ children }) {
      return (
        <div className="pt-markdown__table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  };
}
