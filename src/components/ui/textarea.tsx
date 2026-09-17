import { useId, type ComponentProps } from "react";
import { describedBy, FieldShell } from "./field-shell";
import { textareaClasses } from "./variants";

type TextareaProps = ComponentProps<"textarea"> & { label: string; hint?: string; error?: string };

export function Textarea({ label, hint, error, id, className, ...props }: TextareaProps) {
  const generated = useId();
  const inputId = id ?? generated;

  return (
    <FieldShell id={inputId} label={label} hint={hint} error={error}>
      <textarea
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, hint, error)}
        className={textareaClasses({ invalid: Boolean(error), className })}
        {...props}
      />
    </FieldShell>
  );
}
