"use client";

import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { idleProvisioning, OUTCOME_TEXT, type ProvisioningState } from "@/lib/provisioning-display";

/**
 * Check and Apply for one site's PostHog project. A client component because
 * the key must stay in the browser between a check and an apply without the
 * server ever holding it (add-provisioning, design D1): React clears an
 * uncontrolled field after a form action, so the field is controlled here.
 */
export function ProvisioningPanel({
  action,
  scopes,
}: {
  action: (previous: ProvisioningState, formData: FormData) => Promise<ProvisioningState>;
  scopes: readonly string[];
}) {
  const [state, formAction, pending] = useActionState(action, idleProvisioning);
  const [key, setKey] = useState("");
  const [intent, setIntent] = useState<"check" | "apply">("check");

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-3" noValidate>
        <Field
          name="apiKey"
          type="password"
          label="Personal API key"
          hint={`Used for this request only, never stored. Needs ${scopes.join(", ")} on this project. Delete it in PostHog afterwards.`}
          autoComplete="off"
          value={key}
          onChange={event => setKey(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            name="intent"
            value="check"
            variant="secondary"
            size="sm"
            disabled={pending}
            // Only the pending label reads this; the submitted intent comes from
            // the button's own name and value.
            onClick={() => setIntent("check")}
          >
            {pending && intent === "check" ? "Checking…" : "Check"}
          </Button>
          <Button
            type="submit"
            name="intent"
            value="apply"
            size="sm"
            disabled={pending}
            onClick={() => setIntent("apply")}
          >
            {pending && intent === "apply" ? "Applying…" : "Apply"}
          </Button>
        </div>
      </form>

      {state.formError ? <Alert tone="danger">{state.formError}</Alert> : null}

      {state.status === "done" && state.outcome ? (
        <div className="flex flex-col gap-3">
          <Alert
            tone={
              state.outcome === "matched" || state.outcome === "applied"
                ? "success"
                : state.outcome === "differs"
                  ? "info"
                  : "warning"
            }
          >
            {OUTCOME_TEXT[state.outcome]}
            {state.message ? ` ${state.message}` : ""}
          </Alert>

          {state.applied && state.applied.length > 0 ? (
            <p className="text-caption text-ink-muted">Applied: {state.applied.join(", ")}.</p>
          ) : null}

          {state.differences && state.differences.length > 0 ? (
            <ul className="flex flex-col divide-y divide-hairline rounded-md border border-hairline">
              {state.differences.map(difference => (
                <li
                  key={difference.label}
                  className="grid gap-1 p-3 text-data md:grid-cols-3 md:items-center md:gap-4"
                >
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {difference.label}
                    {difference.held ? (
                      <Badge tone="warning">Held until the tier is confirmed</Badge>
                    ) : null}
                  </span>
                  <span className="text-ink-muted">
                    <span className="md:hidden">Now: </span>
                    {difference.now}
                  </span>
                  <span>
                    <span className="md:hidden">Needs: </span>
                    {difference.required}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {state.proxy !== undefined ? (
            <p className="text-caption text-ink-muted">
              Reverse proxy:{" "}
              {state.proxy === null
                ? "could not be read."
                : state.proxy.length === 0
                  ? "none set up. Add it once the client's DNS is ready."
                  : state.proxy
                      .map(record => `${record.domain} (${record.live ? "live" : "not live yet"})`)
                      .join(", ")}
              {state.discardsIpsByDefault === false
                ? " The organisation does not discard IP data by default."
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
