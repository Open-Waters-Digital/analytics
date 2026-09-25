import { and, asc, eq, min, ne, notInArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  bingWebmasterSites,
  clients,
  searchConsoleProperties,
  siteIndexStatus,
  siteSearchDaily,
  siteSnapshotResults,
  sites,
} from "@/db/schema";
import {
  pageStats,
  queryStats,
  siteTraffic,
  BING_MESSAGES,
  type BingDeps,
  type BingFailure,
} from "@/server/bing-webmaster";
import { bingWebmasterApiKey, googleServiceAccount } from "@/server/env";
import {
  inspectUrl,
  listSitemaps,
  querySearchAnalytics,
  ROW_LIMIT,
  SEARCH_MESSAGES,
  serviceAccountEmail,
  type GoogleDeps,
  type GoogleDimension,
  type GoogleFailure,
} from "@/server/search-console";
import {
  backfillRange,
  chunks,
  searchWindow,
  shapeSearchRows,
  type DayRange,
  type EngineRow,
  type SearchDailyRow,
} from "./search-shape";
import { mapWithConcurrency } from "./concurrency";

/**
 * The nightly search pass (add-search-console, design D5, D5a, D5b, D6). Runs
 * after the PostHog snapshot, in the same job and the same run, with no session:
 * like ./collect.ts, it is the system's own work, and nothing in src/app may
 * import it.
 */

export const SEARCH_SKIP = {
  noProperty: "No Search Console property recorded.",
  noBingSite: "No Bing site recorded.",
  googleNotConfigured: SEARCH_MESSAGES.notConfigured,
  bingNotConfigured: BING_MESSAGES.notConfigured,
} as const;

/** Pages of query or page rows asked for per chunk: far beyond any current client. */
export const MAX_PAGES = 10;
/** Pages inspected per site per weekly pass, inside Google's 2,000 a day. */
export const INSPECTIONS_PER_WEEK = 500;
export const INSPECTION_GAP_MS = 200;
const SITEMAP_TIMEOUT_MS = 10_000;
const SITEMAP_MAX_BYTES = 5 * 1024 * 1024;

export interface SearchDeps {
  now: () => Date;
  google: GoogleDeps;
  bing: BingDeps;
  /** For the client's sitemap files, which are fetched from their own site. */
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  concurrency: number;
  googleConfigured: () => boolean;
  bingConfigured: () => boolean;
}

export interface SearchResult {
  siteId: string;
  clientSlug: string;
  source: "google_search" | "bing_search";
  outcome: "ok" | "failed" | "skipped";
  reason: string | null;
  daysWritten: number;
  durationMs: number;
}

export interface IndexingSummary {
  siteId: string;
  inspected: number;
  failed: string | null;
}

function configured(read: () => unknown): boolean {
  try {
    return read() !== null;
  } catch {
    // Set but unreadable: configured, so each pull fails and says why.
    return true;
  }
}

export const defaultSearchDeps: SearchDeps = {
  now: () => new Date(),
  google: {},
  bing: {},
  fetchImpl: fetch,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  concurrency: 3,
  googleConfigured: () => configured(googleServiceAccount),
  bingConfigured: () => configured(bingWebmasterApiKey),
};

interface SearchCandidate {
  siteId: string;
  clientSlug: string;
  replacesExistingSite: boolean;
  google: {
    id: string;
    property: string;
    status: "readable" | "no_access" | "check_failed" | null;
    backfilledAt: Date | null;
  } | null;
  bing: {
    id: string;
    siteUrl: string;
    status: "readable" | "no_access" | "check_failed" | null;
    backfilledAt: Date | null;
  } | null;
}

async function selectCandidates(): Promise<SearchCandidate[]> {
  const rows = await getDb()
    .select({
      siteId: sites.id,
      clientSlug: clients.slug,
      replacesExistingSite: sites.replacesExistingSite,
      googleId: searchConsoleProperties.id,
      property: searchConsoleProperties.property,
      googleStatus: searchConsoleProperties.lastCheckStatus,
      googleBackfilledAt: searchConsoleProperties.backfilledAt,
      bingId: bingWebmasterSites.id,
      bingSiteUrl: bingWebmasterSites.siteUrl,
      bingStatus: bingWebmasterSites.lastCheckStatus,
      bingBackfilledAt: bingWebmasterSites.backfilledAt,
    })
    .from(sites)
    .innerJoin(clients, eq(clients.id, sites.clientId))
    .leftJoin(searchConsoleProperties, eq(searchConsoleProperties.siteId, sites.id))
    .leftJoin(bingWebmasterSites, eq(bingWebmasterSites.siteId, sites.id))
    .where(ne(clients.status, "offboarded"))
    .orderBy(clients.slug, sites.productionUrl);

  return rows.map(row => ({
    siteId: row.siteId,
    clientSlug: row.clientSlug,
    replacesExistingSite: row.replacesExistingSite,
    google:
      row.googleId && row.property
        ? {
            id: row.googleId,
            property: row.property,
            status: row.googleStatus,
            backfilledAt: row.googleBackfilledAt,
          }
        : null,
    bing:
      row.bingId && row.bingSiteUrl
        ? {
            id: row.bingId,
            siteUrl: row.bingSiteUrl,
            status: row.bingStatus,
            backfilledAt: row.bingBackfilledAt,
          }
        : null,
  }));
}

export async function runSearchPass(
  runId: string,
  overrides: Partial<SearchDeps> = {},
): Promise<{ results: SearchResult[]; indexing: IndexingSummary[] }> {
  const deps = { ...defaultSearchDeps, ...overrides };
  const candidates = await selectCandidates();
  const perSite = await mapWithConcurrency(candidates, deps.concurrency, async candidate => {
    const google = await pullGoogle(candidate, deps);
    const bing = await pullBing(candidate, deps);
    for (const result of [google, bing]) {
      await getDb().insert(siteSnapshotResults).values({
        runId,
        siteId: result.siteId,
        source: result.source,
        outcome: result.outcome,
        reason: result.reason,
        daysWritten: result.daysWritten,
        durationMs: result.durationMs,
      });
    }
    return [google, bing];
  });

  const indexing: IndexingSummary[] = [];
  if (deps.now().getUTCDay() === 1 && deps.googleConfigured()) {
    for (const candidate of candidates) {
      if (candidate.google && candidate.google.status !== "no_access") {
        indexing.push(await indexingPass(candidate.siteId, candidate.google.property, deps));
      }
    }
  }
  return { results: perSite.flat(), indexing };
}

// -------------------------------------------------------------------- Google

async function pullGoogle(candidate: SearchCandidate, deps: SearchDeps): Promise<SearchResult> {
  const started = Date.now();
  const done = (outcome: SearchResult["outcome"], reason: string | null, daysWritten = 0) => ({
    siteId: candidate.siteId,
    clientSlug: candidate.clientSlug,
    source: "google_search" as const,
    outcome,
    reason,
    daysWritten,
    durationMs: Date.now() - started,
  });
  const property = candidate.google;
  if (!property) return done("skipped", SEARCH_SKIP.noProperty);
  if (!deps.googleConfigured()) return done("skipped", SEARCH_SKIP.googleNotConfigured);
  const account = serviceAccountEmail() ?? "the Open Waters service account";
  if (property.status === "no_access") return done("skipped", SEARCH_MESSAGES.noAccess(account));

  const window = searchWindow(deps.now());
  const backfill = candidate.replacesExistingSite && !property.backfilledAt;
  const ranges = backfill ? [...chunks(backfillRange(window)), window] : [window];

  const rows: SearchDailyRow[] = [];
  let coverageStart = await earliestDay(candidate.siteId, "google");
  for (const range of ranges) {
    const fetched = await fetchGoogleRange(property.property, range, deps, candidate.clientSlug);
    if (!fetched.ok) {
      if (fetched.failure === "no_access") {
        await setStatus(
          "google",
          property.id,
          "no_access",
          SEARCH_MESSAGES.noAccess(account),
          deps,
        );
      }
      return done("failed", googleReason(fetched.failure, account));
    }
    const shaped = shapeSearchRows({ range, coverageStart, ...fetched.value });
    rows.push(...shaped);
    const firstTotal = shaped.find(row => row.breakdown === "total")?.day ?? null;
    coverageStart =
      [coverageStart, firstTotal].filter((day): day is string => day !== null).sort()[0] ?? null;
  }

  const from = ranges[0]!.from;
  await writeRows(candidate.siteId, "google", { from, to: window.to }, rows);
  await setStatus("google", property.id, "readable", null, deps, backfill);
  return done("ok", null, rows.filter(row => row.breakdown === "total").length);
}

function googleReason(failure: GoogleFailure, account: string): string {
  switch (failure) {
    case "no_access":
      return SEARCH_MESSAGES.noAccess(account);
    case "configuration":
      return SEARCH_MESSAGES.configuration;
    case "unreachable":
      return SEARCH_MESSAGES.unreachable;
    case "unexpected":
      return SEARCH_MESSAGES.unexpected;
  }
}

type GoogleRange = {
  totals: EngineRow[];
  devices: EngineRow[];
  queries: EngineRow[];
  pages: EngineRow[];
};

async function fetchGoogleRange(
  property: string,
  range: DayRange,
  deps: SearchDeps,
  slug: string,
): Promise<{ ok: true; value: GoogleRange } | { ok: false; failure: GoogleFailure }> {
  const dimension = async (second: GoogleDimension | null) => {
    const collected: EngineRow[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await querySearchAnalytics(
        property,
        {
          startDate: range.from,
          endDate: range.to,
          dimensions: second ? ["date", second] : ["date"],
          startRow: page * ROW_LIMIT,
        },
        deps.google,
      );
      if (!result.ok) return result;
      for (const row of result.value) {
        const [day, value = ""] = row.keys;
        if (day) {
          collected.push({
            day,
            value,
            clicks: row.clicks,
            impressions: row.impressions,
            position: row.position,
          });
        }
      }
      if (result.value.length < ROW_LIMIT) return { ok: true as const, value: collected };
      if (!second) break;
    }
    console.warn(`search: ${slug} reached the ${MAX_PAGES}-page cap for ${second ?? "totals"}`);
    return { ok: true as const, value: collected };
  };

  const totals = await dimension(null);
  if (!totals.ok) return totals;
  const devices = await dimension("device");
  if (!devices.ok) return devices;
  const queries = await dimension("query");
  if (!queries.ok) return queries;
  const pages = await dimension("page");
  if (!pages.ok) return pages;
  return {
    ok: true,
    value: {
      totals: totals.value,
      devices: devices.value,
      queries: queries.value,
      pages: pages.value,
    },
  };
}

// ---------------------------------------------------------------------- Bing

async function pullBing(candidate: SearchCandidate, deps: SearchDeps): Promise<SearchResult> {
  const started = Date.now();
  const done = (outcome: SearchResult["outcome"], reason: string | null, daysWritten = 0) => ({
    siteId: candidate.siteId,
    clientSlug: candidate.clientSlug,
    source: "bing_search" as const,
    outcome,
    reason,
    daysWritten,
    durationMs: Date.now() - started,
  });
  const site = candidate.bing;
  if (!site) return done("skipped", SEARCH_SKIP.noBingSite);
  if (!deps.bingConfigured()) return done("skipped", SEARCH_SKIP.bingNotConfigured);
  if (site.status === "no_access") return done("skipped", BING_MESSAGES.noAccess);

  // Bing's statistics come back whole; the window decides which days are kept.
  const window = searchWindow(deps.now(), "UTC");
  const backfill = candidate.replacesExistingSite && !site.backfilledAt;
  const range: DayRange = backfill ? { from: backfillRange(window).from, to: window.to } : window;

  const fail = async (failure: BingFailure) => {
    if (failure === "no_access") {
      await setStatus("bing", site.id, "no_access", BING_MESSAGES.noAccess, deps);
    }
    return done("failed", bingReason(failure));
  };
  const totals = await siteTraffic(site.siteUrl, deps.bing);
  if (!totals.ok) return fail(totals.failure);
  const queries = await queryStats(site.siteUrl, deps.bing);
  if (!queries.ok) return fail(queries.failure);
  const pages = await pageStats(site.siteUrl, deps.bing);
  if (!pages.ok) return fail(pages.failure);

  const rows = shapeSearchRows({
    range,
    coverageStart: await earliestDay(candidate.siteId, "bing"),
    totals: totals.value,
    devices: [],
    queries: queries.value,
    pages: pages.value,
  });
  await writeRows(candidate.siteId, "bing", range, rows);
  await setStatus("bing", site.id, "readable", null, deps, backfill);
  return done("ok", null, rows.filter(row => row.breakdown === "total").length);
}

function bingReason(failure: BingFailure): string {
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

// ------------------------------------------------------------------- writing

async function earliestDay(siteId: string, engine: "google" | "bing"): Promise<string | null> {
  const [row] = await getDb()
    .select({ day: min(siteSearchDaily.day) })
    .from(siteSearchDaily)
    .where(and(eq(siteSearchDaily.siteId, siteId), eq(siteSearchDaily.engine, engine)));
  return row?.day ?? null;
}

/** Replaces one engine's rows for the range in one transaction (design D5). */
async function writeRows(
  siteId: string,
  engine: "google" | "bing",
  range: DayRange,
  rows: SearchDailyRow[],
): Promise<void> {
  await getDb().transaction(async tx => {
    await tx
      .delete(siteSearchDaily)
      .where(
        and(
          eq(siteSearchDaily.siteId, siteId),
          eq(siteSearchDaily.engine, engine),
          sql`${siteSearchDaily.day} >= ${range.from}`,
          sql`${siteSearchDaily.day} <= ${range.to}`,
        ),
      );
    const values = rows.map(row => ({ siteId, engine, ...row }));
    for (let index = 0; index < values.length; index += 1_000) {
      await tx.insert(siteSearchDaily).values(values.slice(index, index + 1_000));
    }
  });
}

/**
 * A pull is also a check. An outage is not written, as with PostHog: it says
 * nothing about access, and storing it would change tomorrow's run.
 */
async function setStatus(
  engine: "google" | "bing",
  id: string,
  status: "readable" | "no_access",
  message: string | null,
  deps: SearchDeps,
  backfilled = false,
): Promise<void> {
  const values = {
    lastCheckAt: deps.now(),
    lastCheckStatus: status,
    lastCheckMessage: message,
    ...(backfilled ? { backfilledAt: deps.now() } : {}),
  };
  if (engine === "google") {
    await getDb()
      .update(searchConsoleProperties)
      .set(values)
      .where(eq(searchConsoleProperties.id, id));
  } else {
    await getDb().update(bingWebmasterSites).set(values).where(eq(bingWebmasterSites.id, id));
  }
}

// ------------------------------------------------------------- the indexing pass

/** Whether an address belongs to the property: its domain, or under its prefix. */
export function onProperty(address: string, property: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (property.startsWith("sc-domain:")) {
    const domain = property.slice("sc-domain:".length).toLowerCase();
    const host = url.hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  }
  return url.href.startsWith(property);
}

/** `<loc>` entries, and whether the file is a sitemap index. */
export function parseSitemap(xml: string): { index: boolean; locations: string[] } {
  const locations = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(match =>
    (match[1] ?? "").replaceAll("&amp;", "&"),
  );
  return { index: /<sitemapindex[\s>]/i.test(xml), locations };
}

async function fetchSitemap(url: string, deps: SearchDeps): Promise<string | null> {
  try {
    const response = await deps.fetchImpl(url, {
      signal: AbortSignal.timeout(SITEMAP_TIMEOUT_MS),
      redirect: "follow",
      cache: "no-store",
    });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > SITEMAP_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
    return Buffer.concat(parts).toString("utf8");
  } catch {
    return null;
  }
}

/** Every page address the property's submitted sitemaps list, one index level deep. */
async function sitemapAddresses(
  property: string,
  deps: SearchDeps,
): Promise<{ ok: true; value: string[] } | { ok: false; reason: string }> {
  const submitted = await listSitemaps(property, deps.google);
  if (!submitted.ok) return { ok: false, reason: googleReason(submitted.failure, "") };
  if (submitted.value.length === 0)
    return { ok: false, reason: "No sitemap is submitted in Search Console." };

  const addresses = new Set<string>();
  for (const sitemap of submitted.value) {
    const xml = await fetchSitemap(sitemap, deps);
    if (xml === null) return { ok: false, reason: "The site's sitemap could not be fetched." };
    const parsed = parseSitemap(xml);
    const files = parsed.index ? parsed.locations : [];
    const pages = parsed.index ? [] : parsed.locations;
    for (const child of files) {
      const childXml = await fetchSitemap(child, deps);
      if (childXml === null)
        return { ok: false, reason: "The site's sitemap could not be fetched." };
      pages.push(...parseSitemap(childXml).locations);
    }
    for (const page of pages) {
      try {
        const url = new URL(page);
        url.search = "";
        url.hash = "";
        if (onProperty(url.href, property)) addresses.add(url.href.slice(0, 500));
      } catch {
        // Not an address: ignored.
      }
    }
  }
  return { ok: true, value: [...addresses] };
}

/** One site's weekly indexing pass (design D5b). A failure keeps earlier results. */
export async function indexingPass(
  siteId: string,
  property: string,
  overrides: Partial<SearchDeps> = {},
): Promise<IndexingSummary> {
  const deps = { ...defaultSearchDeps, ...overrides };
  const listed = await sitemapAddresses(property, deps);
  if (!listed.ok) return { siteId, inspected: 0, failed: listed.reason };

  const db = getDb();
  const known = await db
    .select({ address: siteIndexStatus.address, inspectedAt: siteIndexStatus.inspectedAt })
    .from(siteIndexStatus)
    .where(eq(siteIndexStatus.siteId, siteId))
    .orderBy(asc(siteIndexStatus.inspectedAt));
  const seen = new Set(known.map(row => row.address));
  const listedSet = new Set(listed.value);
  const order = [
    ...listed.value.filter(address => !seen.has(address)),
    ...known.map(row => row.address).filter(address => listedSet.has(address)),
  ].slice(0, INSPECTIONS_PER_WEEK);

  let inspected = 0;
  for (const address of order) {
    const result = await inspectUrl(property, address, deps.google);
    if (!result.ok) {
      return { siteId, inspected, failed: googleReason(result.failure, "") };
    }
    const now = deps.now();
    await db
      .insert(siteIndexStatus)
      .values({ siteId, address, ...result.value, inspectedAt: now })
      .onConflictDoUpdate({
        target: [siteIndexStatus.siteId, siteIndexStatus.address],
        set: { ...result.value, inspectedAt: now, updatedAt: now },
      });
    inspected += 1;
    await deps.sleep(INSPECTION_GAP_MS);
  }

  // Pages no longer in any sitemap are no longer the site's concern.
  if (listed.value.length > 0) {
    await db
      .delete(siteIndexStatus)
      .where(
        and(eq(siteIndexStatus.siteId, siteId), notInArray(siteIndexStatus.address, listed.value)),
      );
  } else {
    await db.delete(siteIndexStatus).where(eq(siteIndexStatus.siteId, siteId));
  }
  return { siteId, inspected, failed: null };
}
