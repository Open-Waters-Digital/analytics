"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { signIn, type SignInFormState } from "./actions";

/**
 * A client component only for the pending state and for keeping the entered
 * address when the server returns an error. The form posts a server action, so
 * it also works before JavaScript loads.
 */
export function SignInForm({ returnTo }: { returnTo: string | null }) {
  const [state, action, pending] = useActionState<SignInFormState, FormData>(signIn, { email: "" });

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <Field
        label="Email address"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        defaultValue={state.email}
        error={state.fieldError}
        // Re-mount on each response so defaultValue reflects what was submitted.
        key={`${state.email}-${state.fieldError ?? ""}`}
      />
      {state.formError ? (
        <p role="alert" className="text-caption text-danger">
          {state.formError}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending link…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
