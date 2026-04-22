import { Check, Copy } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface MarkdownCodeBlockProps {
  code: string;
  copied: boolean;
  language: string;
  onCopy: (value: string) => void;
  copyLabel: string;
}

export function MarkdownCodeBlock({
  code,
  copied,
  language,
  onCopy,
  copyLabel,
}: MarkdownCodeBlockProps) {
  return (
    <div className="pt-code-block">
      <div className="pt-code-block__toolbar">
        <span>{language}</span>
        <button
          type="button"
          className="pt-code-block__copy"
          onClick={() => onCopy(code)}
          aria-label={copyLabel}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language}
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
}
