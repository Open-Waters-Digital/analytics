import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { bingWebmasterSites, searchConsoleProperties } from "@/db/schema";
import { BING_MESSAGES, checkSite, type BingDeps, type BingFailure } from "@/server/bing-webmaster";
import { bingWebmasterApiKey, googleServiceAccount } from "@/server/env";
import {
  checkProperty,
  SEARCH_MESSAGES,
  serviceAccountEmail,
  type GoogleDeps,
  type GoogleFailure,
} from "@/server/search-console";
import { requireSession } from "@/server/session";
import { formError, fromZodError, ok, type Result } from "./result";
import { bingSiteSchema, searchConsoleSchema } from "./schemas";

/**
 * Recording and checking a site's search properties (add-search-console,
 * design D7). Saving a property checks it straight away, so a partner learns at
 * once whether the client has shared it. A property is kept whatever the check
 * says: a client may share it tomorrow.
 */

export type SearchCheckOutcome = "readable" | "no_access" | "check_failed" | "not_configured";

export interface SearchDeps {
  google?: GoogleDeps;
  bing?: BingDeps;
  now?: () => Date;
  googleConfigured?: () => boolean;
  bingConfigured?: () => boolean;
}

function isConfigured(read: () => unknown): boolean {
  try {
    return read() !== null;
  } catch {
    return true;
  }
}

function googleMessage(failure: GoogleFailure): string {
  switch (failure) {
    case "no_access":
      return SEARCH_MESSAGES.noAccess(serviceAccountEmail() ?? "the Open Waters service account");
    case "configuration":
      return SEARCH_MESSAGES.configuration;
    case "unreachable":
      return SEARCH_MESSAGES.unreachable;
    case "unexpected":
      return SEARCH_MESSAGES.unexpected;
  }
}

function bingMessage(failure: BingFailure): string {
  switch (failure) {
    case "no_access":
      return BING_MESSAGES.noAccess;
    case "configuration":
      return BING_MESSAGES.configuration;
    case "unreachable":
      return BING_MESSAGES.unreachable;
    case "unexpected":
      return BING_MESSAGES.unexpected;
  }
}

async function runGoogleCheck(siteId: string, deps: SearchDeps): Promise<SearchCheckOutcome> {
  const configured = deps.googleConfigured ?? (() => isConfigured(googleServiceAccount));
  const [row] = await getDb()
    .select({ property: searchConsoleProperties.property })
    .from(searchConsoleProperties)
    .where(eq(searchConsoleProperties.siteId, siteId));
  if (!row) return "check_failed";
  if (!configured()) return "not_configured";

  const result = await checkProperty(row.property, deps.google ?? {});
  const status = result.ok
    ? "readable"
    : result.failure === "no_access"
      ? "no_access"
      : "check_failed";
  await getDb()
    .update(searchConsoleProperties)
    .set({
      lastCheckAt: (deps.now ?? (() => new Date()))(),
      lastCheckStatus: status,
      lastCheckMessage: result.ok ? null : googleMessage(result.failure),
    })
    .where(eq(searchConsoleProperties.siteId, siteId));
  return status;
}

async function runBingCheck(siteId: string, deps: SearchDeps): Promise<SearchCheckOutcome> {
  const configured = deps.bingConfigured ?? (() => isConfigured(bingWebmasterApiKey));
  const [row] = await getDb()
    .select({ siteUrl: bingWebmasterSites.siteUrl })
    .from(bingWebmasterSites)
    .where(eq(bingWebmasterSites.siteId, siteId));
  if (!row) return "check_failed";
  if (!configured()) return "not_configured";

  const result = await checkSite(row.siteUrl, deps.bing ?? {});
  const status = result.ok
    ? "readable"
    : result.failure === "no_access"
      ? "no_access"
      : "check_failed";
  await getDb()
    .update(bingWebmasterSites)
    .set({
      lastCheckAt: (deps.now ?? (() => new Date()))(),
      lastCheckStatus: status,
      lastCheckMessage: result.ok ? null : bingMessage(result.failure),
    })
    .where(eq(bingWebmasterSites.siteId, siteId));
  return status;
}

/**
 * Stores the property, then checks it. A changed property starts again: its
 * old check and its backfill belonged to the property it replaced.
 */
export async function saveSearchConsoleProperty(
  siteId: string,
  input: unknown,
  deps: SearchDeps = {},
): Promise<Result<{ check: SearchCheckOutcome }>> {
  await requireSession();
  const parsed = searchConsoleSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const reset = {
    property: parsed.data.property,
    lastCheckAt: null,
    lastCheckStatus: null,
    lastCheckMessage: null,
    backfilledAt: null,
    updatedAt: new Date(),
  };
  const [existing] = await getDb()
    .select({ property: searchConsoleProperties.property })
    .from(searchConsoleProperties)
    .where(eq(searchConsoleProperties.siteId, siteId));
  if (!existing) {
    await getDb()
      .insert(searchConsoleProperties)
      .values({ siteId, property: parsed.data.property });
  } else if (existing.property !== parsed.data.property) {
    await getDb()
      .update(searchConsoleProperties)
      .set(reset)
      .where(eq(searchConsoleProperties.siteId, siteId));
  }
  return ok({ check: await runGoogleCheck(siteId, deps) });
}

export async function checkSearchConsoleProperty(
  siteId: string,
  deps: SearchDeps = {},
): Promise<Result<{ check: SearchCheckOutcome }>> {
  await requireSession();
  const check = await runGoogleCheck(siteId, deps);
  return ok({ check });
}

export async function saveBingSite(
  siteId: string,
  input: unknown,
  deps: SearchDeps = {},
): Promise<Result<{ check: SearchCheckOutcome }>> {
  await requireSession();
  const parsed = bingSiteSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const [existing] = await getDb()
    .select({ siteUrl: bingWebmasterSites.siteUrl })
    .from(bingWebmasterSites)
    .where(eq(bingWebmasterSites.siteId, siteId));
  if (!existing) {
    await getDb().insert(bingWebmasterSites).values({ siteId, siteUrl: parsed.data.siteUrl });
  } else if (existing.siteUrl !== parsed.data.siteUrl) {
    await getDb()
      .update(bingWebmasterSites)
      .set({
        siteUrl: parsed.data.siteUrl,
        lastCheckAt: null,
        lastCheckStatus: null,
        lastCheckMessage: null,
        backfilledAt: null,
        updatedAt: new Date(),
      })
      .where(eq(bingWebmasterSites.siteId, siteId));
  }
  return ok({ check: await runBingCheck(siteId, deps) });
}

export async function checkBingSite(
  siteId: string,
  deps: SearchDeps = {},
): Promise<Result<{ check: SearchCheckOutcome }>> {
  await requireSession();
  const [row] = await getDb()
    .select({ id: bingWebmasterSites.id })
    .from(bingWebmasterSites)
    .where(eq(bingWebmasterSites.siteId, siteId));
  if (!row) return formError("Record the Bing site first.");
  return ok({ check: await runBingCheck(siteId, deps) });
}
