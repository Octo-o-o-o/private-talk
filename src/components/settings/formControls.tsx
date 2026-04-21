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
