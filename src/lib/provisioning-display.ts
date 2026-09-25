/**
 * What the provisioning panel shows, as plain data that can cross from a server
 * action to the client component. No values that are secrets: settings are
 * PostHog's own configuration, never the key.
 */

export interface DisplayDifference {
  label: string;
  now: string;
  required: string;
  /** Waiting for the tier to be confirmed; apply leaves it alone. */
  held: boolean;
}

export interface ProvisioningState {
  status: "idle" | "error" | "done";
  formError?: string;
  intent?: "check" | "apply";
  outcome?: "matched" | "differs" | "applied" | "partial" | "failed";
  differences?: DisplayDifference[];
  applied?: string[];
  message?: string | null;
  proxy?: { domain: string; live: boolean }[] | null;
  discardsIpsByDefault?: boolean | null;
}

export const idleProvisioning: ProvisioningState = { status: "idle" };

export const OUTCOME_TEXT: Record<NonNullable<ProvisioningState["outcome"]>, string> = {
  matched: "The project matches. Nothing to change.",
  differs: "The project differs. Apply to bring it into line.",
  applied: "Applied. The project now matches, apart from anything held.",
  partial: "Applied in part, then stopped. Check again to see what remains.",
  failed: "Nothing was changed.",
};

/** A setting's value in words, for the difference list. */
export function describeValue(value: unknown): string {
  if (value === null || value === undefined) return "Not set";
  if (value === true) return "On";
  if (value === false) return "Off";
  if (Array.isArray(value)) return value.length === 0 ? "None" : value.map(String).join(", ");
  if (typeof value === "object") {
    return (value as Record<string, unknown>)["maskAllInputs"] === true
      ? "Every input masked"
      : "Custom";
  }
  return String(value);
}
