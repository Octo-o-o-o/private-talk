import { ChevronDown } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";

export const inputClass = "pt-input";
export const compactInputClass = "pt-input pt-input--compact";

export const buttonStyles = {
  primary: "pt-btn pt-btn--primary",
  secondary: "pt-btn pt-btn--secondary",
  danger: "pt-btn pt-btn--danger",
  dangerGhost: "pt-btn pt-btn--ghost-danger",
  chip: "pt-chip-button",
  compactChip: "pt-chip-button pt-chip-button--compact",
} as const;

type FieldProps = {
  label: string;
  children: ReactNode;
};

export function Field({ label, children }: FieldProps) {
  return (
    <label className="pt-field-group">
      <span className="pt-field-group__label">{label}</span>
      {children}
    </label>
  );
}

type TextFieldProps = {
  label: string;
} & InputHTMLAttributes<HTMLInputElement>;

export function TextField({ label, className, ...rest }: TextFieldProps) {
  return (
    <Field label={label}>
      <input className={className ?? inputClass} {...rest} />
    </Field>
  );
}

type FormErrorProps = {
  message?: string | null;
};

export function FormError({ message }: FormErrorProps) {
  if (!message) {
    return null;
  }

  return (
    <p className="pt-form-error" role="alert">
      {message}
    </p>
  );
}

type SelectSettingOption<T extends string> = {
  value: T;
  label: string;
};

type SelectSettingRowProps<T extends string> = {
  title: string;
  detail?: string;
  label: string;
  value: T;
  valueLabel: string;
  options: SelectSettingOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
};

export function SelectSettingRow<T extends string>({
  title,
  detail,
  label,
  value,
  valueLabel,
  options,
  onChange,
  disabled = false,
}: SelectSettingRowProps<T>) {
  return (
    <label
      className={`pt-settings-row pt-settings-row--select${disabled ? " is-disabled" : ""}`}
    >
      <div className="pt-settings-row__copy">
        <p className="pt-settings-row__title">{title}</p>
        {detail ? <p className="pt-settings-row__detail">{detail}</p> : null}
      </div>

      <div className="pt-settings-row__actions" aria-hidden="true">
        <span className="pt-settings-row__value pt-settings-row__value--select">
          {valueLabel}
        </span>
        <ChevronDown size={16} className="pt-settings-row__select-chevron" />
      </div>

      <select
        aria-label={label}
        className="pt-settings-row__native-select"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        disabled={disabled}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
