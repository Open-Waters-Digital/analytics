import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  clients,
  bingWebmasterSites,
  posthogConnections,
  reportRecipients,
  searchConsoleProperties,
  siteChanges,
  siteCommercialContext,
  siteExpectedEvents,
  sites,
  users,
} from "@/db/schema";
import { requireSession } from "@/server/session";
import { fieldError, formError, fromZodError, isUniqueViolation, ok, type Result } from "./result";
import { createClientSchema, updateClientSchema } from "./schemas";

export type ClientStatus = (typeof clients.$inferSelect)["status"];
export type AnalyticsOwnership = (typeof clients.$inferSelect)["analyticsOwnership"];

export interface ClientSummary {
  id: string;
  slug: string;
  name: string;
  status: ClientStatus;
  analyticsOwnership: AnalyticsOwnership;
  regulated: boolean;
  siteCount: number;
  connectedSiteCount: number;
}

/** A PostHog connection as the UI may see it: never the key or its ciphertext. */
export interface PublicPostHogConnection {
  region: "eu" | "us";
  projectId: number;
  keyLast4: string;
  lastCheckAt: Date | null;
  lastCheckStatus: "ok" | "unauthorised" | "project_not_found" | "error" | null;
  lastCheckMessage: string | null;
}

export interface SearchPropertyDetail {
  /** The Search Console property, or the Bing site URL. */
  value: string;
  status: "readable" | "no_access" | "check_failed" | null;
  message: string | null;
  checkedAt: Date | null;
}

export interface SiteDetail {
  id: string;
  productionUrl: string;
  framework: "astro" | "next" | "other";
  repository: string | null;
  launchedOn: string | null;
  taxonomyVersion: number;
  hasConsentBanner: boolean;
  measurementTier: "essentials" | "insights" | "growth";
  usesHeatmaps: boolean;
  /** The guard on the higher tiers: which tier was confirmed, when and by whom. */
  tierConfirmation: {
    tier: "essentials" | "insights" | "growth";
    at: Date;
    byEmail: string | null;
  } | null;
  timezone: string;
  posthog: PublicPostHogConnection | null;
  searchConsoleProperty: string | null;
  /** The recorded search properties and their last checks (add-search-console). */
  searchConsole: SearchPropertyDetail | null;
  bing: SearchPropertyDetail | null;
  replacesExistingSite: boolean;
  brandTerms: string[];
  expectedEvents: string[];
  commercial: {
    leadValueMinor: number | null;
    currency: "GBP" | "EUR" | "USD" | null;
    leadToCustomerRate: string | null;
    source: "client_confirmed" | "open_waters_estimate" | null;
  } | null;
  changes: {
    id: string;
    occurredOn: string;
    kind: (typeof siteChanges.$inferSelect)["kind"];
    title: string;
    detail: string | null;
    expectedEffect: string | null;
  }[];
}

export interface ClientDetail extends ClientSummary {
  recipients: { id: string; name: string; email: string }[];
  sites: SiteDetail[];
}

export async function createClient(input: unknown): Promise<Result<{ slug: string }>> {
  await requireSession();
  const parsed = createClientSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  try {
    const [row] = await getDb()
      .insert(clients)
      .values({ ...parsed.data, status: "onboarding" })
      .returning({ slug: clients.slug });
    return ok({ slug: row!.slug });
  } catch (error) {
    if (isUniqueViolation(error, "clients_slug_unique")) {
      return fieldError("slug", "That slug is already in use by another client.");
    }
    throw error;
  }
}

export async function updateClient(slug: string, input: unknown): Promise<Result> {
  await requireSession();
  const parsed = updateClientSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  // Only the parsed fields are written, so a slug in the input is ignored.
  const updated = await getDb()
    .update(clients)
    .set(parsed.data)
    .where(eq(clients.slug, slug))
    .returning({ id: clients.id });
  return updated.length === 1 ? ok() : formError("That client no longer exists.");
}

export async function listClients(
  options: { includeOffboarded?: boolean } = {},
): Promise<ClientSummary[]> {
  await requireSession();

  return getDb()
    .select({
      id: clients.id,
      slug: clients.slug,
      name: clients.name,
      status: clients.status,
      analyticsOwnership: clients.analyticsOwnership,
      regulated: clients.regulated,
      siteCount: sql<number>`count(${sites.id})::int`,
      connectedSiteCount: sql<number>`count(${posthogConnections.id}) filter (where ${posthogConnections.lastCheckStatus} = 'ok')::int`,
    })
    .from(clients)
    .leftJoin(sites, eq(sites.clientId, clients.id))
    .leftJoin(posthogConnections, eq(posthogConnections.siteId, sites.id))
    .where(options.includeOffboarded ? undefined : ne(clients.status, "offboarded"))
    .groupBy(clients.id)
    .orderBy(sql`lower(${clients.name})`, asc(clients.slug));
}

/**
 * Everything the client page shows, in a fixed number of queries however many
 * sites the client has.
 */
export async function getClientDetail(slug: string): Promise<ClientDetail | null> {
  await requireSession();
  const db = getDb();

  const [summary] = await db
    .select({
      id: clients.id,
      slug: clients.slug,
      name: clients.name,
      status: clients.status,
      analyticsOwnership: clients.analyticsOwnership,
      regulated: clients.regulated,
    })
    .from(clients)
    .where(eq(clients.slug, slug));
  if (!summary) return null;

  const [recipients, siteRows] = await Promise.all([
    db
      .select({
        id: reportRecipients.id,
        name: reportRecipients.name,
        email: reportRecipients.email,
      })
      .from(reportRecipients)
      .where(eq(reportRecipients.clientId, summary.id))
      .orderBy(asc(reportRecipients.name)),
    db.select().from(sites).where(eq(sites.clientId, summary.id)).orderBy(asc(sites.productionUrl)),
  ]);

  const siteIds = siteRows.map(site => site.id);
  const [connections, properties, expected, commercial, changes, bingSites] =
    siteIds.length === 0
      ? [[], [], [], [], [], []]
      : await Promise.all([
          db
            .select({
              siteId: posthogConnections.siteId,
              region: posthogConnections.region,
              projectId: posthogConnections.projectId,
              keyLast4: posthogConnections.keyLast4,
              lastCheckAt: posthogConnections.lastCheckAt,
              lastCheckStatus: posthogConnections.lastCheckStatus,
              lastCheckMessage: posthogConnections.lastCheckMessage,
            })
            .from(posthogConnections)
            .where(inArray(posthogConnections.siteId, siteIds)),
          db
            .select({
              siteId: searchConsoleProperties.siteId,
              property: searchConsoleProperties.property,
              status: searchConsoleProperties.lastCheckStatus,
              message: searchConsoleProperties.lastCheckMessage,
              checkedAt: searchConsoleProperties.lastCheckAt,
            })
            .from(searchConsoleProperties)
            .where(inArray(searchConsoleProperties.siteId, siteIds)),
          db
            .select({ siteId: siteExpectedEvents.siteId, event: siteExpectedEvents.event })
            .from(siteExpectedEvents)
            .where(inArray(siteExpectedEvents.siteId, siteIds)),
          db
            .select()
            .from(siteCommercialContext)
            .where(inArray(siteCommercialContext.siteId, siteIds)),
          db
            .select()
            .from(siteChanges)
            .where(inArray(siteChanges.siteId, siteIds))
            .orderBy(desc(siteChanges.occurredOn), desc(siteChanges.createdAt)),
          db
            .select({
              siteId: bingWebmasterSites.siteId,
              siteUrl: bingWebmasterSites.siteUrl,
              status: bingWebmasterSites.lastCheckStatus,
              message: bingWebmasterSites.lastCheckMessage,
              checkedAt: bingWebmasterSites.lastCheckAt,
            })
            .from(bingWebmasterSites)
            .where(inArray(bingWebmasterSites.siteId, siteIds)),
        ]);

  const confirmerIds = siteRows
    .map(site => site.tierConfirmedBy)
    .filter((id): id is string => id !== null);
  const confirmers =
    confirmerIds.length === 0
      ? []
      : await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.id, confirmerIds));

  const siteDetails: SiteDetail[] = siteRows.map(site => {
    const connection = connections.find(row => row.siteId === site.id);
    const context = commercial.find(row => row.siteId === site.id);
    return {
      id: site.id,
      productionUrl: site.productionUrl,
      framework: site.framework,
      repository: site.repository,
      launchedOn: site.launchedOn,
      taxonomyVersion: site.taxonomyVersion,
      hasConsentBanner: site.hasConsentBanner,
      measurementTier: site.measurementTier,
      usesHeatmaps: site.usesHeatmaps,
      tierConfirmation:
        site.tierConfirmedFor && site.tierConfirmedAt
          ? {
              tier: site.tierConfirmedFor,
              at: site.tierConfirmedAt,
              byEmail: confirmers.find(user => user.id === site.tierConfirmedBy)?.email ?? null,
            }
          : null,
      timezone: site.timezone,
      posthog: connection
        ? {
            region: connection.region,
            projectId: connection.projectId,
            keyLast4: connection.keyLast4,
            lastCheckAt: connection.lastCheckAt,
            lastCheckStatus: connection.lastCheckStatus,
            lastCheckMessage: connection.lastCheckMessage,
          }
        : null,
      searchConsoleProperty: properties.find(row => row.siteId === site.id)?.property ?? null,
      searchConsole: (() => {
        const row = properties.find(candidate => candidate.siteId === site.id);
        return row
          ? {
              value: row.property,
              status: row.status,
              message: row.message,
              checkedAt: row.checkedAt,
            }
          : null;
      })(),
      bing: (() => {
        const row = bingSites.find(candidate => candidate.siteId === site.id);
        return row
          ? {
              value: row.siteUrl,
              status: row.status,
              message: row.message,
              checkedAt: row.checkedAt,
            }
          : null;
      })(),
      replacesExistingSite: site.replacesExistingSite,
      brandTerms: site.brandTerms,
      expectedEvents: expected.filter(row => row.siteId === site.id).map(row => row.event),
      commercial: context
        ? {
            leadValueMinor: context.leadValueMinor,
            currency: context.currency,
            leadToCustomerRate: context.leadToCustomerRate,
            source: context.source,
          }
        : null,
      changes: changes
        .filter(row => row.siteId === site.id)
        .map(row => ({
          id: row.id,
          occurredOn: row.occurredOn,
          kind: row.kind,
          title: row.title,
          detail: row.detail,
          expectedEffect: row.expectedEffect,
        })),
    };
  });

  return {
    ...summary,
    siteCount: siteDetails.length,
    connectedSiteCount: siteDetails.filter(site => site.posthog?.lastCheckStatus === "ok").length,
    recipients,
    sites: siteDetails,
  };
}

/** Resolves a site and the client it belongs to, for pages that edit one site. */
export async function getSiteWithClient(
  clientSlug: string,
  siteId: string,
): Promise<{ client: { id: string; slug: string; name: string }; site: SiteDetail } | null> {
  const detail = await getClientDetail(clientSlug);
  const site = detail?.sites.find(candidate => candidate.id === siteId);
  if (!detail || !site) return null;
  return { client: { id: detail.id, slug: detail.slug, name: detail.name }, site };
}

/** A site id that belongs to the given client, or undefined. Guards URLs like /clients/a/sites/<b's site>. */
export async function findSiteId(clientSlug: string, siteId: string): Promise<string | undefined> {
  await requireSession();
  const [row] = await getDb()
    .select({ id: sites.id })
    .from(sites)
    .innerJoin(clients, eq(clients.id, sites.clientId))
    .where(and(eq(clients.slug, clientSlug), eq(sites.id, siteId)));
  return row?.id;
}
