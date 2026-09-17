import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  clients,
  searchConsoleProperties,
  siteChanges,
  siteCommercialContext,
  siteExpectedEvents,
  sites,
} from "@/db/schema";
import { eventsFor, type ListedEvent } from "@/lib/event-list";
import { requireSession } from "@/server/session";
import { fieldError, formError, fromZodError, isUniqueViolation, ok, type Result } from "./result";
import {
  commercialContextSchema,
  expectedEventsSchema,
  removeSchema,
  searchConsoleSchema,
  siteChangeSchema,
  siteSchema,
} from "./schemas";

const URL_TAKEN = "Another site already uses this URL.";

export async function createSite(
  clientSlug: string,
  input: unknown,
  deps: { eventsFor: (version: number) => readonly ListedEvent[] | undefined } = { eventsFor },
): Promise<Result<{ siteId: string }>> {
  await requireSession();
  const parsed = siteSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const [client] = await getDb()
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.slug, clientSlug));
  if (!client) return formError("That client no longer exists.");

  try {
    // One transaction: a site never exists without its default expected events.
    const siteId = await getDb().transaction(async tx => {
      const [site] = await tx
        .insert(sites)
        .values({ ...parsed.data, clientId: client.id })
        .returning({ id: sites.id });
      const events = deps.eventsFor(parsed.data.taxonomyVersion) ?? [];
      if (events.length > 0) {
        await tx
          .insert(siteExpectedEvents)
          .values(events.map(event => ({ siteId: site!.id, event: event.name })));
      }
      return site!.id;
    });
    return ok({ siteId });
  } catch (error) {
    if (isUniqueViolation(error, "sites_productionUrl_unique")) {
      return fieldError("productionUrl", URL_TAKEN);
    }
    throw error;
  }
}

/**
 * Changing the event list version does not change expected events: adopting a
 * new version is a deliberate step on the expected events form, so old sites do
 * not suddenly "expect" events they were never built to send.
 */
export async function updateSite(siteId: string, input: unknown): Promise<Result> {
  await requireSession();
  const parsed = siteSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  try {
    const updated = await getDb()
      .update(sites)
      .set(parsed.data)
      .where(eq(sites.id, siteId))
      .returning({ id: sites.id });
    return updated.length === 1 ? ok() : formError("That site no longer exists.");
  } catch (error) {
    if (isUniqueViolation(error, "sites_productionUrl_unique")) {
      return fieldError("productionUrl", URL_TAKEN);
    }
    throw error;
  }
}

/** Removes the site and, by cascade, everything recorded against it. */
export async function removeSite(siteId: string, input: unknown): Promise<Result> {
  await requireSession();
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return formError("Confirm before removing the site.");

  await getDb().delete(sites).where(eq(sites.id, siteId));
  return ok();
}

export async function saveSearchConsoleProperty(siteId: string, input: unknown): Promise<Result> {
  await requireSession();
  const parsed = searchConsoleSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  await getDb()
    .insert(searchConsoleProperties)
    .values({ siteId, property: parsed.data.property })
    .onConflictDoUpdate({
      target: searchConsoleProperties.siteId,
      set: { property: parsed.data.property, updatedAt: new Date() },
    });
  return ok();
}

export async function removeSearchConsoleProperty(siteId: string): Promise<Result> {
  await requireSession();
  await getDb().delete(searchConsoleProperties).where(eq(searchConsoleProperties.siteId, siteId));
  return ok();
}

/** Replaces the expected set with exactly the events given. */
export async function setExpectedEvents(siteId: string, input: unknown): Promise<Result> {
  await requireSession();

  const [site] = await getDb()
    .select({ taxonomyVersion: sites.taxonomyVersion })
    .from(sites)
    .where(eq(sites.id, siteId));
  if (!site) return formError("That site no longer exists.");

  const parsed = expectedEventsSchema(site.taxonomyVersion).safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  await getDb().transaction(async tx => {
    await tx.delete(siteExpectedEvents).where(eq(siteExpectedEvents.siteId, siteId));
    if (parsed.data.events.length > 0) {
      await tx
        .insert(siteExpectedEvents)
        .values(parsed.data.events.map(event => ({ siteId, event })));
    }
  });
  return ok();
}

export async function saveCommercialContext(siteId: string, input: unknown): Promise<Result> {
  await requireSession();
  const parsed = commercialContextSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const values = {
    leadValueMinor: parsed.data.leadValue,
    currency: parsed.data.leadValue === null ? null : parsed.data.currency,
    leadToCustomerRate: parsed.data.leadToCustomerRate,
    source: parsed.data.source,
  };
  await getDb()
    .insert(siteCommercialContext)
    .values({ siteId, ...values })
    .onConflictDoUpdate({
      target: siteCommercialContext.siteId,
      set: { ...values, updatedAt: new Date() },
    });
  return ok();
}

export async function addSiteChange(siteId: string, input: unknown): Promise<Result> {
  await requireSession();
  const parsed = siteChangeSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  await getDb()
    .insert(siteChanges)
    .values({ siteId, ...parsed.data });
  return ok();
}

export async function updateSiteChange(
  siteId: string,
  changeId: string,
  input: unknown,
): Promise<Result> {
  await requireSession();
  const parsed = siteChangeSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const updated = await getDb()
    .update(siteChanges)
    .set(parsed.data)
    .where(and(eq(siteChanges.id, changeId), eq(siteChanges.siteId, siteId)))
    .returning({ id: siteChanges.id });
  return updated.length === 1 ? ok() : formError("That entry no longer exists.");
}

export async function deleteSiteChange(siteId: string, changeId: string): Promise<Result> {
  await requireSession();
  await getDb()
    .delete(siteChanges)
    .where(and(eq(siteChanges.id, changeId), eq(siteChanges.siteId, siteId)));
  return ok();
}
