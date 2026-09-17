"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ButtonVariant } from "@/components/ui/variants";
import { idleForm, type FieldSpec, type FormState } from "@/lib/form-state";

/**
 * Every registry form. A client component only for useActionState: the pending
 * state, and keeping what was typed when the server returns field errors. The
 * form posts a server action, so it also works before JavaScript loads.
 */
export function RegistryForm({
  action,
  fields,
  submitLabel,
  submitVariant = "primary",
  columns = 1,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  fields: readonly FieldSpec[];
  submitLabel: string;
  submitVariant?: ButtonVariant;
  columns?: 1 | 2;
}) {
  const [state, formAction, pending] = useActionState(action, idleForm);
  const values = state.values ?? {};
  // Re-mount fields after each response so defaults reflect the latest values.
  const version = `${state.status}-${JSON.stringify(state.fieldErrors)}-${state.message ?? ""}`;

  const text = (name: string, fallback?: string) => {
    const value = values[name];
    return typeof value === "string" ? value : (fallback ?? "");
  };

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.formError ? <Alert tone="danger">{state.formError}</Alert> : null}
      {state.status === "success" && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      <div
        key={version}
        className={columns === 2 ? "grid gap-4 md:grid-cols-2" : "flex flex-col gap-4"}
      >
        {fields.map(field => {
          const error = "name" in field ? state.fieldErrors[field.name] : undefined;
          switch (field.kind) {
            case "hidden":
              return <input key={field.name} type="hidden" name={field.name} value={field.value} />;
            case "textarea":
              return (
                <Textarea
                  key={field.name}
                  name={field.name}
                  label={field.label}
                  hint={field.hint}
                  error={error}
                  defaultValue={text(field.name, field.defaultValue)}
                />
              );
            case "select":
              return (
                <Select
                  key={field.name}
                  name={field.name}
                  label={field.label}
                  hint={field.hint}
                  error={error}
                  placeholder={field.placeholder}
                  options={field.options}
                  defaultValue={text(field.name, field.defaultValue)}
                />
              );
            case "checkbox":
              return (
                <Checkbox
                  key={field.name}
                  name={field.name}
                  label={field.label}
                  hint={field.hint}
                  defaultChecked={
                    state.values ? values[field.name] === "on" : Boolean(field.defaultChecked)
                  }
                />
              );
            case "checkboxes": {
              const submitted = values[field.name];
              const checked = new Set(
                state.values
                  ? Array.isArray(submitted)
                    ? submitted
                    : submitted
                      ? [submitted]
                      : []
                  : field.defaultValues,
              );
              return (
                <fieldset key={field.name} className="flex flex-col gap-3">
                  <legend className="mb-2 text-data font-medium">{field.legend}</legend>
                  {error ? <p className="text-caption text-danger">{error}</p> : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {field.options.map(option => (
                      <Checkbox
                        key={option.value}
                        name={field.name}
                        value={option.value}
                        label={option.label}
                        hint={option.hint}
                        defaultChecked={checked.has(option.value)}
                      />
                    ))}
                  </div>
                </fieldset>
              );
            }
            default:
              return (
                <Field
                  key={field.name}
                  name={field.name}
                  type={field.kind}
                  label={field.label}
                  hint={field.hint}
                  error={error}
                  placeholder={field.placeholder}
                  required={field.required}
                  autoComplete={
                    field.autoComplete ?? (field.kind === "password" ? "off" : undefined)
                  }
                  // A password field never gets a value back from the server.
                  defaultValue={
                    field.kind === "password" ? undefined : text(field.name, field.defaultValue)
                  }
                />
              );
          }
        })}
      </div>

      <div>
        <Button type="submit" variant={submitVariant} disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
