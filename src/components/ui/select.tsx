import { useId, type ComponentProps } from "react";
import { describedBy, FieldShell } from "./field-shell";
import { selectClasses } from "./variants";

export interface SelectOption {
  value: string;
  label: string;
}

type SelectProps = Omit<ComponentProps<"select">, "children"> & {
  label: string;
  options: readonly SelectOption[];
  /** Adds an empty first option, for optional choices. */
  placeholder?: string;
  hint?: string;
  error?: string;
};

/** A native select: full keyboard and screen reader support without JavaScript. */
export function Select({
  label,
  options,
  placeholder,
  hint,
  error,
  id,
  className,
  ...props
}: SelectProps) {
  const generated = useId();
  const inputId = id ?? generated;

  return (
    <FieldShell id={inputId} label={label} hint={hint} error={error}>
      <select
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, hint, error)}
        className={selectClasses({ invalid: Boolean(error), className })}
        {...props}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
