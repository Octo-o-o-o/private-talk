import { Check, Copy } from "lucide-react";
import type { ReactNode } from "react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import graphql from "react-syntax-highlighter/dist/esm/languages/prism/graphql";
import ini from "react-syntax-highlighter/dist/esm/languages/prism/ini";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import kotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import php from "react-syntax-highlighter/dist/esm/languages/prism/php";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import ruby from "react-syntax-highlighter/dist/esm/languages/prism/ruby";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import swift from "react-syntax-highlighter/dist/esm/languages/prism/swift";
import toml from "react-syntax-highlighter/dist/esm/languages/prism/toml";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light";
import { useAppStore } from "../../stores/appStore";

interface MarkdownCodeBlockProps {
  code: string;
  copied: boolean;
  language: string;
  onCopy: (value: string) => void;
  copyLabel: string;
}

type PrismLanguage = (typeof SUPPORTED_LANGUAGES)[number][0];

const SUPPORTED_LANGUAGES = [
  ["bash", bash],
  ["c", c],
  ["cpp", cpp],
  ["css", css],
  ["diff", diff],
  ["docker", docker],
  ["go", go],
  ["graphql", graphql],
  ["ini", ini],
  ["java", java],
  ["javascript", javascript],
  ["json", json],
  ["jsx", jsx],
  ["kotlin", kotlin],
  ["markdown", markdown],
  ["markup", markup],
  ["php", php],
  ["python", python],
  ["ruby", ruby],
  ["rust", rust],
  ["sql", sql],
  ["swift", swift],
  ["toml", toml],
  ["tsx", tsx],
  ["typescript", typescript],
  ["yaml", yaml],
] as const;

const LANGUAGE_ALIASES: Record<string, PrismLanguage | "text"> = {
  cjs: "javascript",
  conf: "ini",
  env: "bash",
  htm: "markup",
  html: "markup",
  js: "javascript",
  json5: "json",
  kt: "kotlin",
  kts: "kotlin",
  md: "markdown",
  mjs: "javascript",
  plaintext: "text",
  plain: "text",
  py: "python",
  rb: "ruby",
  rs: "rust",
  shell: "bash",
  sh: "bash",
  svg: "markup",
  text: "text",
  tomlrc: "toml",
  ts: "typescript",
  txt: "text",
  xml: "markup",
  yml: "yaml",
  zsh: "bash",
};

const REGISTERED_LANGUAGES = new Set<string>();
const SUPPORTED_LANGUAGE_NAMES = new Set<PrismLanguage>(
  SUPPORTED_LANGUAGES.map(([name]) => name),
);
const CODE_BLOCK_STYLE = {
  margin: 0,
  borderRadius: 0,
  padding: "12px 14px",
  background: "transparent",
  fontSize: "12px",
  lineHeight: 1.55,
} as const;

for (const [name, grammar] of SUPPORTED_LANGUAGES) {
  if (!REGISTERED_LANGUAGES.has(name)) {
    SyntaxHighlighter.registerLanguage(name, grammar);
    REGISTERED_LANGUAGES.add(name);
  }
}

function normalizeCodeLanguage(value: string): PrismLanguage | "text" {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "text";
  }

  const canonical = LANGUAGE_ALIASES[normalized] ?? normalized;
  return SUPPORTED_LANGUAGE_NAMES.has(canonical as PrismLanguage)
    ? (canonical as PrismLanguage)
    : "text";
}

function displayLanguageLabel(rawLanguage: string): string {
  const normalized = rawLanguage.trim().toLowerCase();
  if (!normalized) {
    return "text";
  }

  const canonical = LANGUAGE_ALIASES[normalized] ?? normalized;
  return canonical === "text" ? normalized : canonical;
}

function CodeBlockFrame({
  children,
  copied,
  code,
  copyLabel,
  label,
  onCopy,
}: {
  children: ReactNode;
  copied: boolean;
  code: string;
  copyLabel: string;
  label: string;
  onCopy: (value: string) => void;
}) {
  return (
    <div className="pt-code-block">
      <div className="pt-code-block__toolbar">
        <span>{label}</span>
        <button
          type="button"
          className="pt-code-block__copy"
          onClick={() => onCopy(code)}
          aria-label={copyLabel}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      {children}
    </div>
  );
}

export function MarkdownCodeBlock({
  code,
  copied,
  language,
  onCopy,
  copyLabel,
}: MarkdownCodeBlockProps) {
  const resolvedTheme = useAppStore((state) => state.resolvedTheme);
  const normalizedLanguage = normalizeCodeLanguage(language);
  const label = displayLanguageLabel(language);
  const body = normalizedLanguage === "text"
    ? <pre className="pt-code-block__fallback">{code}</pre>
    : (
      <SyntaxHighlighter
        style={resolvedTheme === "light" ? oneLight : oneDark}
        language={normalizedLanguage}
        PreTag="div"
        customStyle={CODE_BLOCK_STYLE}
      >
        {code}
      </SyntaxHighlighter>
    );

  return (
    <CodeBlockFrame
      copied={copied}
      code={code}
      copyLabel={copyLabel}
      label={label}
      onCopy={onCopy}
    >
      {body}
    </CodeBlockFrame>
  );
}
