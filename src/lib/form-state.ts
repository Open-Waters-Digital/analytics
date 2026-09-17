/**
 * What a registry server action hands back to its form. Plain data only, so it
 * can cross from server to client.
 */
export type FormValues = Record<string, string | string[]>;

export interface FormState {
  status: "idle" | "error" | "success";
  fieldErrors: Record<string, string>;
  formError?: string;
  message?: string;
  /** What was submitted, so a failed save keeps the user's input. Never secrets. */
  values?: FormValues;
}

export const idleForm: FormState = { status: "idle", fieldErrors: {} };

export type FieldSpec =
  | {
      kind: "text" | "email" | "url" | "date" | "number" | "password";
      name: string;
      label: string;
      hint?: string;
      defaultValue?: string;
      placeholder?: string;
      required?: boolean;
      autoComplete?: string;
    }
  | { kind: "textarea"; name: string; label: string; hint?: string; defaultValue?: string }
  | {
      kind: "select";
      name: string;
      label: string;
      hint?: string;
      defaultValue?: string;
      placeholder?: string;
      options: readonly { value: string; label: string }[];
    }
  | { kind: "checkbox"; name: string; label: string; hint?: string; defaultChecked?: boolean }
  | {
      kind: "checkboxes";
      name: string;
      legend: string;
      options: readonly { value: string; label: string; hint?: string }[];
      defaultValues: readonly string[];
    }
  | { kind: "hidden"; name: string; value: string };
