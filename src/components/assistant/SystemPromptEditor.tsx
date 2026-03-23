import { useI18n } from "@/lib/i18n";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

export function SystemPromptEditor({ value, onChange, readOnly }: Props) {
  const { t } = useI18n();

  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel>{t("系统提示词", "System Prompt")}</FieldLabel>
        <span className="text-xs tabular-nums text-muted-foreground">
          {t(`${value.length} 字`, `${value.length} chars`)}
        </span>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        placeholder={t("填写系统提示词...", "Write the system prompt...")}
        className="min-h-[200px] resize-none font-mono leading-relaxed"
      />
    </Field>
  );
}
