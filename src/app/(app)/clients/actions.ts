"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState, FormValues } from "@/lib/form-state";
import { createClient, findSiteId, updateClient } from "@/server/registry/clients";
import {
  removePostHogConnection,
  savePostHogConnection,
  testPostHogConnection,
} from "@/server/registry/connections";
import { addRecipient, removeRecipient } from "@/server/registry/recipients";
import type { Result } from "@/server/registry/result";
import {
  addSiteChange,
  createSite,
  deleteSiteChange,
  removeSite,
  saveCommercialContext,
  setExpectedEvents,
  updateSite,
  updateSiteChange,
} from "@/server/registry/sites";
import {
  checkBingSite,
  checkSearchConsoleProperty,
  saveBingSite,
  saveSearchConsoleProperty,
  type SearchCheckOutcome,
} from "@/server/registry/search";
import { UnauthorisedError } from "@/server/session-policy";

/**
 * Thin wrappers from form posts to the data access layer, which does the
 * session check and validation. The helpers below turn outcomes into form
 * state; redirects happen outside try/catch because redirect() works by
 * throwing.
 */

const SECRET_FIELDS = new Set(["apiKey"]);
const ARRAY_FIELDS = new Set(["events"]);

function inputFrom(formData: FormData): Record<string, string | string[]> {
  const input: Record<string, string | string[]> = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const all = formData.getAll(key).map(String);
    input[key] = ARRAY_FIELDS.has(key) ? all : (all[0] ?? "");
  }
  for (const key of ARRAY_FIELDS) input[key] ??= [];
  return input;
}

function withoutSecrets(input: Record<string, string | string[]>): FormValues {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !SECRET_FIELDS.has(key)));
}

type Outcome<T> =
  { kind: "result"; result: Result<T> } | { kind: "signed-out" } | { kind: "failed" };

async function attempt<T>(label: string, run: () => Promise<Result<T>>): Promise<Outcome<T>> {
  try {
    return { kind: "result", result: await run() };
  } catch (error) {
    if (error instanceof UnauthorisedError) return { kind: "signed-out" };
    // The error's name only: database errors can carry query parameters, which
    // may include email addresses or ciphertext.
    console.error(`registry: ${label} failed (${error instanceof Error ? error.name : "unknown"})`);
    return { kind: "failed" };
  }
}

const FAILED: FormState = {
  status: "error",
  fieldErrors: {},
  formError: "Something went wrong and nothing was saved. Try again.",
};

/** Runs a mutation from a form and returns the state the form should show. */
async function formMutation<T>(
  label: string,
  formData: FormData,
  run: (input: Record<string, string | string[]>) => Promise<Result<T>>,
  onSuccess: (value: T) => { redirectTo: string } | { message: string; keepValues?: boolean },
): Promise<FormState> {
  const input = inputFrom(formData);
  const outcome = await attempt(label, () => run(input));

  if (outcome.kind === "signed-out") redirect("/sign-in");
  if (outcome.kind === "failed") return { ...FAILED, values: withoutSecrets(input) };

  const { result } = outcome;
  if (!result.ok) {
    return {
      status: "error",
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      values: withoutSecrets(input),
    };
  }

  const next = onSuccess(result.value);
  if ("redirectTo" in next) redirect(next.redirectTo);
  refresh();
  return {
    status: "success",
    fieldErrors: {},
    message: next.message,
    values: next.keepValues ? withoutSecrets(input) : undefined,
  };
}

/** For button-only forms (remove, test): no form state, just do it and reload. */
async function buttonMutation(
  label: string,
  run: () => Promise<Result<unknown>>,
  redirectTo?: string,
) {
  const outcome = await attempt(label, run);
  if (outcome.kind === "signed-out") redirect("/sign-in");
  if (redirectTo && outcome.kind === "result" && outcome.result.ok) redirect(redirectTo);
  refresh();
}

async function requireSiteOf(slug: string, siteId: string): Promise<void> {
  try {
    if (!(await findSiteId(slug, siteId))) redirect(`/clients/${slug}`);
  } catch (error) {
    if (error instanceof UnauthorisedError) redirect("/sign-in");
    throw error;
  }
}

const clientPath = (slug: string) => `/clients/${slug}`;
const sitePath = (slug: string, siteId: string) => `/clients/${slug}#site-${siteId}`;

// ---- Clients ------------------------------------------------------------------

export async function createClientAction(_: FormState, formData: FormData): Promise<FormState> {
  return formMutation("create client", formData, createClient, value => ({
    redirectTo: clientPath(value.slug),
  }));
}

export async function updateClientAction(
  slug: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  return formMutation(
    "update client",
    formData,
    input => updateClient(slug, input),
    () => ({
      redirectTo: clientPath(slug),
    }),
  );
}

// ---- Recipients ---------------------------------------------------------------

export async function addRecipientAction(
  slug: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  return formMutation(
    "add recipient",
    formData,
    input => addRecipient(slug, input),
    () => ({
      message: "Recipient added.",
    }),
  );
}

export async function removeRecipientAction(slug: string, recipientId: string): Promise<void> {
  await buttonMutation("remove recipient", () => removeRecipient(slug, recipientId));
}

// ---- Sites --------------------------------------------------------------------

export async function createSiteAction(
  slug: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  return formMutation(
    "create site",
    formData,
    input => createSite(slug, input),
    value => ({
      redirectTo: sitePath(slug, value.siteId),
    }),
  );
}

export async function updateSiteAction(
  slug: string,
  siteId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSiteOf(slug, siteId);
  return formMutation(
    "update site",
    formData,
    input => updateSite(siteId, input),
    () => ({
      redirectTo: sitePath(slug, siteId),
    }),
  );
}

export async function removeSiteAction(
  slug: string,
  siteId: string,
  formData: FormData,
): Promise<void> {
  await requireSiteOf(slug, siteId);
  await buttonMutation(
    "remove site",
    () => removeSite(siteId, { confirm: formData.get("confirm") }),
    clientPath(slug),
  );
}

// ---- PostHog ------------------------------------------------------------------

export async function savePostHogAction(
  slug: string,
  siteId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSiteOf(slug, siteId);
  return formMutation(
    "save PostHog connection",
    formData,
    input => savePostHogConnection(siteId, input),
    () => ({ message: "Connected. PostHog accepted the key.", keepValues: true }),
  );
}

export async function testPostHogAction(slug: string, siteId: string): Promise<void> {
  await requireSiteOf(slug, siteId);
  await buttonMutation("test PostHog connection", () => testPostHogConnection(siteId));
}

export async function removePostHogAction(
  slug: string,
  siteId: string,
  formData: FormData,
): Promise<void> {
  await requireSiteOf(slug, siteId);
  await buttonMutation(
    "remove PostHog connection",
    () => removePostHogConnection(siteId, { confirm: formData.get("confirm") }),
    sitePath(slug, siteId),
  );
}

// ---- Search Console, expected events, commercial context ------------------------

const CHECK_TEXT: Record<SearchCheckOutcome, string> = {
  readable: "Readable. Data arrives after the next nightly run.",
  no_access: "Saved, but not shared with the Open Waters account yet. See the note beside it.",
  check_failed: "Saved. The check could not finish; press Check to try again.",
  not_configured: "Saved. This engine is not configured on the server yet, so it was not checked.",
};

export async function saveSearchConsoleAction(
  slug: string,
  siteId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSiteOf(slug, siteId);
  return formMutation(
    "save Search Console property",
    formData,
    input => saveSearchConsoleProperty(siteId, input),
    value => ({ message: CHECK_TEXT[value.check], keepValues: true }),
  );
}

export async function saveBingSiteAction(
  slug: string,
  siteId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSiteOf(slug, siteId);
  return formMutation(
    "save Bing site",
    formData,
    input => saveBingSite(siteId, input),
    value => ({ message: CHECK_TEXT[value.check], keepValues: true }),
  );
}

/** The Check buttons beside each property: the result shows on the page it returns to. */
export async function checkSearchConsoleAction(slug: string, siteId: string): Promise<void> {
  await requireSiteOf(slug, siteId);
  await buttonMutation("check Search Console property", () => checkSearchConsoleProperty(siteId));
}

export async function checkBingSiteAction(slug: string, siteId: string): Promise<void> {
  await requireSiteOf(slug, siteId);
  await buttonMutation("check Bing site", () => checkBingSite(siteId));
}

export async function setExpectedEventsAction(
  slug: string,
  siteId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSiteOf(slug, siteId);
  return formMutation(
    "save expected events",
    formData,
    input => setExpectedEvents(siteId, input),
    () => ({ message: "Expected events saved.", keepValues: true }),
  );
}

export async function saveCommercialAction(
  slug: string,
  siteId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSiteOf(slug, siteId);
  return formMutation(
    "save commercial context",
    formData,
    input => saveCommercialContext(siteId, input),
    () => ({ message: "Commercial context saved.", keepValues: true }),
  );
}

// ---- Learning log -------------------------------------------------------------

export async function addSiteChangeAction(
  slug: string,
  siteId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSiteOf(slug, siteId);
  return formMutation(
    "add log entry",
    formData,
    input => addSiteChange(siteId, input),
    () => ({
      message: "Entry added.",
    }),
  );
}

export async function updateSiteChangeAction(
  slug: string,
  siteId: string,
  changeId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSiteOf(slug, siteId);
  return formMutation(
    "update log entry",
    formData,
    input => updateSiteChange(siteId, changeId, input),
    () => ({ redirectTo: sitePath(slug, siteId) }),
  );
}

export async function deleteSiteChangeAction(
  slug: string,
  siteId: string,
  changeId: string,
): Promise<void> {
  await requireSiteOf(slug, siteId);
  await buttonMutation("delete log entry", () => deleteSiteChange(siteId, changeId));
}
