import { useId, type ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { checkboxClasses } from "./variants";

type CheckboxProps = Omit<ComponentProps<"input">, "type"> & {
  label: string;
  hint?: string;
};

/** The label is part of the click target, so the whole row toggles. */
export function Checkbox({ label, hint, id, className, ...props }: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = hint ? `${inputId}-hint` : undefined;

  return (
    <div className={cn("flex items-start gap-3", props.disabled && "text-ink-subtle")}>
      <input
        id={inputId}
        type="checkbox"
        aria-describedby={hintId}
        className={checkboxClasses(cn("mt-0.5", className))}
        {...props}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={inputId} className="text-data font-medium">
          {label}
        </label>
        {hint ? (
          <p id={hintId} className="text-caption text-ink-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
