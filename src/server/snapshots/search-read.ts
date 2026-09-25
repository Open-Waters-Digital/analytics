import "server-only";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  bingWebmasterSites,
  searchConsoleProperties,
  siteDailyMetrics,
  siteIndexStatus,
  siteSearchDaily,
  sites,
} from "@/db/schema";
import { requireSession } from "@/server/session";
import { addDays } from "./window";
import { GOOGLE_TIMEZONE, searchWindow } from "./search-shape";

/**
 * What the client page reads about search (add-search-console, design D9, D10).
 * Session-checked like ./read.ts. Every figure is computed from stored rows:
 * click-through rate and position are never stored, and brand terms apply when
 * read, so a new term recalculates history.
 */

export const REPORT_DAYS = 28;
export const TOP_ROWS = 10;
const ORGANIC_SESSIONS = "Organic Search";
const ORGANIC_LEADS = "organic_search";

export interface Headline {
  clicks: number;
  impressions: number;
  /** Clicks over impressions, or null with no impressions. */
  ctr: number | null;
  /** Average position weighted by impressions, or null where none is reported. */
  position: number | null;
}

export interface EngineReport {
  current: Headline;
  previous: Headline;
  /** The first day this engine has data for, or null if none yet. */
  historyBegins: string | null;
}

export interface SearchReport {
  period: { from: string; to: string; previousFrom: string; previousTo: string };
  google: EngineReport | null;
  bing: EngineReport | null;
  combined: { current: Headline; previous: Headline };
  branded: { branded: number; nonBranded: number; coverage: number | null } | null;
  topQueries: { value: string; clicks: number; impressions: number }[];
  topPages: { value: string; clicks: number; impressions: number }[];
  searchToEnquiry: { organicClicks: number; organicSessions: number; organicLeads: number };
  /** For a replacement site, the launch day that splits "Previous site" from this one. */
  previousSiteUntil: string | null;
  indexing: {
    inspected: number;
    indexed: number;
    notIndexed: { address: string; coverageState: string | null }[];
  } | null;
}

function headline(rows: { clicks: number; impressions: number; positionSum: number }[]): Headline {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const positioned = rows.filter(row => row.positionSum > 0);
  const positionedImpressions = positioned.reduce((sum, row) => sum + row.impressions, 0);
  const positionSum = positioned.reduce((sum, row) => sum + row.positionSum, 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: positionedImpressions > 0 ? positionSum / positionedImpressions : null,
  };
}

export function isBranded(query: string, terms: readonly string[]): boolean {
  const lower = query.toLowerCase();
  return terms.some(term => term.length > 0 && lower.includes(term));
}

export async function getSearchReport(
  siteId: string,
  now: Date = new Date(),
): Promise<SearchReport> {
  await requireSession();
  const db = getDb();

  const to = searchWindow(now, GOOGLE_TIMEZONE).to;
  const from = addDays(to, -(REPORT_DAYS - 1));
  const previousTo = addDays(from, -1);
  const previousFrom = addDays(previousTo, -(REPORT_DAYS - 1));

  const [site] = await db
    .select({
      brandTerms: sites.brandTerms,
      replacesExistingSite: sites.replacesExistingSite,
      launchedOn: sites.launchedOn,
      timezone: sites.timezone,
      hasGoogle: searchConsoleProperties.id,
      hasBing: bingWebmasterSites.id,
    })
    .from(sites)
    .leftJoin(searchConsoleProperties, eq(searchConsoleProperties.siteId, sites.id))
    .leftJoin(bingWebmasterSites, eq(bingWebmasterSites.siteId, sites.id))
    .where(eq(sites.id, siteId));

  const [rows, firstDays, metrics, index] = await Promise.all([
    db
      .select({
        engine: siteSearchDaily.engine,
        day: siteSearchDaily.day,
        breakdown: siteSearchDaily.breakdown,
        value: siteSearchDaily.value,
        clicks: siteSearchDaily.clicks,
        impressions: siteSearchDaily.impressions,
        positionSum: siteSearchDaily.positionSum,
      })
      .from(siteSearchDaily)
      .where(
        and(
          eq(siteSearchDaily.siteId, siteId),
          gte(siteSearchDaily.day, previousFrom),
          lte(siteSearchDaily.day, to),
        ),
      ),
    db
      .select({ engine: siteSearchDaily.engine, day: sql<string>`min(${siteSearchDaily.day})` })
      .from(siteSearchDaily)
      .where(eq(siteSearchDaily.siteId, siteId))
      .groupBy(siteSearchDaily.engine),
    db
      .select({
        metric: siteDailyMetrics.metric,
        value: sql<number>`sum(${siteDailyMetrics.value})::int`,
      })
      .from(siteDailyMetrics)
      .where(
        and(
          eq(siteDailyMetrics.siteId, siteId),
          gte(siteDailyMetrics.day, from),
          lte(siteDailyMetrics.day, to),
          sql`((${siteDailyMetrics.metric} = 'sessions_by_channel' and ${siteDailyMetrics.dimension} = ${ORGANIC_SESSIONS})
            or (${siteDailyMetrics.metric} = 'leads_by_channel' and ${siteDailyMetrics.dimension} = ${ORGANIC_LEADS}))`,
        ),
      )
      .groupBy(siteDailyMetrics.metric),
    db
      .select({
        address: siteIndexStatus.address,
        verdict: siteIndexStatus.verdict,
        coverageState: siteIndexStatus.coverageState,
      })
      .from(siteIndexStatus)
      .where(eq(siteIndexStatus.siteId, siteId)),
  ]);

  const inPeriod = (day: string, start: string, end: string) => day >= start && day <= end;
  const totals = rows.filter(row => row.breakdown === "total");
  const engineReport = (engine: "google" | "bing", present: boolean): EngineReport | null => {
    if (!present) return null;
    const mine = totals.filter(row => row.engine === engine);
    return {
      current: headline(mine.filter(row => inPeriod(row.day, from, to))),
      previous: headline(mine.filter(row => inPeriod(row.day, previousFrom, previousTo))),
      historyBegins: firstDays.find(row => row.engine === engine)?.day ?? null,
    };
  };

  const current = rows.filter(row => inPeriod(row.day, from, to));
  const currentTotals = totals.filter(row => inPeriod(row.day, from, to));
  const queries = current.filter(row => row.breakdown === "query");
  const terms = site?.brandTerms ?? [];
  const totalClicks = currentTotals.reduce((sum, row) => sum + row.clicks, 0);
  const queryClicks = queries.reduce((sum, row) => sum + row.clicks, 0);
  const brandedClicks = queries
    .filter(row => isBranded(row.value, terms))
    .reduce((sum, row) => sum + row.clicks, 0);

  const top = (breakdown: "query" | "page") => {
    const byValue = new Map<string, { value: string; clicks: number; impressions: number }>();
    for (const row of current.filter(candidate => candidate.breakdown === breakdown)) {
      const entry = byValue.get(row.value) ?? { value: row.value, clicks: 0, impressions: 0 };
      entry.clicks += row.clicks;
      entry.impressions += row.impressions;
      byValue.set(row.value, entry);
    }
    return [...byValue.values()]
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
      .slice(0, TOP_ROWS);
  };

  const metric = (name: string) => metrics.find(row => row.metric === name)?.value ?? 0;
  const inspectedRows = index;

  return {
    period: { from, to, previousFrom, previousTo },
    google: engineReport("google", Boolean(site?.hasGoogle)),
    bing: engineReport("bing", Boolean(site?.hasBing)),
    combined: {
      current: headline(currentTotals),
      previous: headline(totals.filter(row => inPeriod(row.day, previousFrom, previousTo))),
    },
    branded:
      terms.length > 0
        ? {
            branded: brandedClicks,
            nonBranded: queryClicks - brandedClicks,
            coverage: totalClicks > 0 ? Math.min(queryClicks / totalClicks, 1) : null,
          }
        : null,
    topQueries: top("query"),
    topPages: top("page"),
    searchToEnquiry: {
      organicClicks: totalClicks,
      organicSessions: metric("sessions_by_channel"),
      organicLeads: metric("leads_by_channel"),
    },
    previousSiteUntil: site?.replacesExistingSite && site.launchedOn ? site.launchedOn : null,
    indexing:
      inspectedRows.length > 0
        ? {
            inspected: inspectedRows.length,
            indexed: inspectedRows.filter(row => row.verdict === "indexed").length,
            notIndexed: inspectedRows
              .filter(row => row.verdict === "not_indexed")
              .map(row => ({ address: row.address, coverageState: row.coverageState })),
          }
        : null,
  };
}

// Used by the client page to fetch several sites' reports at once.
export async function getSearchReports(
  siteIds: string[],
  now: Date = new Date(),
): Promise<Map<string, SearchReport>> {
  await requireSession();
  const entries = await Promise.all(
    siteIds.map(async id => [id, await getSearchReport(id, now)] as const),
  );
  return new Map(entries);
}
