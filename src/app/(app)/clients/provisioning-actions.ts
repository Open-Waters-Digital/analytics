"use server";

import { refresh } from "next/cache";
import type { FormState } from "@/lib/form-state";
import {
  describeValue,
  type DisplayDifference,
  type ProvisioningState,
} from "@/lib/provisioning-display";
import { applyProvisioning, checkProvisioning } from "@/server/provisioning";
import type { Difference } from "@/server/provisioning/diff";
import { confirmTier } from "@/server/provisioning/tier";
import { UnauthorisedError } from "@/server/session-policy";

/**
 * The PostHog project panel's actions. The key arrives with each request, goes
 * to the data access layer, and is neither returned nor logged here.
 */

const SIGNED_OUT = "Your session has ended. Sign in again to continue.";
const FAILED = "Something went wrong and nothing was changed. Try again.";

function display(difference: Difference): DisplayDifference {
  switch (difference.type) {
    case "setting":
      return {
        label: difference.label,
        now: describeValue(difference.current),
        required: describeValue(difference.required),
        held: difference.held,
      };
    case "filter":
      return {
        label: "Internal-traffic filter",
        now: `${difference.removed} condition${difference.removed === 1 ? "" : "s"} hiding the production site`,
        required: "No condition matching the production host",
        held: false,
      };
    case "dashboard":
      return { label: "Baseline dashboard", now: "Missing", required: "Present", held: false };
    case "insight":
      return {
        label: `Insight: ${difference.name}`,
        now:
          difference.change === "missing"
            ? "Missing"
            : difference.change === "changed"
              ? "Different query"
              : "Not on the dashboard",
        required: "As the contract defines it",
        held: false,
      };
  }
}

export async function provisioningAction(
  siteId: string,
  _previous: ProvisioningState,
  formData: FormData,
): Promise<ProvisioningState> {
  const intent = formData.get("intent") === "apply" ? "apply" : "check";
  const input = { apiKey: String(formData.get("apiKey") ?? "") };

  try {
    const result =
      intent === "apply"
        ? await applyProvisioning(siteId, input)
        : await checkProvisioning(siteId, input);
    if (!result.ok) return { status: "error", intent, formError: result.formError };
    if (intent === "apply") refresh();
    const { report } = result;
    return {
      status: "done",
      intent,
      outcome: report.outcome,
      differences: report.differences.map(display),
      applied: report.applied,
      message: report.message,
      proxy: report.organisation?.proxyDomains ?? null,
      discardsIpsByDefault: report.organisation?.discardsIpsByDefault ?? null,
    };
  } catch (error) {
    if (error instanceof UnauthorisedError) return { status: "error", formError: SIGNED_OUT };
    console.error(
      `provisioning: ${intent} failed (${error instanceof Error ? error.name : "unknown"})`,
    );
    return { status: "error", intent, formError: FAILED };
  }
}

export async function confirmTierAction(
  siteId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const input = {
    tier: String(formData.get("tier") ?? ""),
    bannerLive: String(formData.get("bannerLive") ?? ""),
    privacyPageNamesTools: String(formData.get("privacyPageNamesTools") ?? ""),
  };
  try {
    const result = await confirmTier(siteId, input);
    if (!result.ok) {
      return {
        status: "error",
        fieldErrors: result.fieldErrors,
        formError: result.formError,
        values: input,
      };
    }
    refresh();
    return {
      status: "success",
      fieldErrors: {},
      message: "Tier confirmed. Apply to switch recording on.",
    };
  } catch (error) {
    if (error instanceof UnauthorisedError) {
      return { status: "error", fieldErrors: {}, formError: SIGNED_OUT };
    }
    console.error(
      `provisioning: confirm tier failed (${error instanceof Error ? error.name : "unknown"})`,
    );
    return { status: "error", fieldErrors: {}, formError: FAILED };
  }
}
