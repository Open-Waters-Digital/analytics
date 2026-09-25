import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { siteDailyMetrics, siteSnapshotResults, snapshotRuns } from "@/db/schema";
import { requireSession } from "@/server/session";

/**
 * What the app reads about the nightly snapshot. Every function checks the
 * session first: the job's own path (./collect.ts) is the only code here that
 * does not, because it has no session to check.
 */

/** Days shown on the client page, matching the window the job re-pulls. */
export const RECENT_DAYS = 7;

/** After this long with no finished run, the app says so rather than going quiet. */
export const STALE_AFTER_HOURS = 48;

export interface SnapshotRun {
  startedAt: Date;
  finishedAt: Date | null;
  sitesOk: number;
  sitesFailed: number;
  sitesSkipped: number;
}

export interface SiteDay {
  day: string;
  pageViews: number;
  sessions: number;
  leads: number;
}

/** Breakdowns summed over the recent days, shown under the daily table. */
export const BREAKDOWN_METRICS = [
  "leads_by_channel",
  "leads_by_heard_about",
  "page_views_by_ad_consent",
] as const;
export type BreakdownMetric = (typeof BREAKDOWN_METRICS)[number];

export interface Breakdown {
  metric: BreakdownMetric;
  /** Largest first. Only values with something counted. */
  values: { dimension: string; value: number }[];
}

export interface SiteSnapshot {
  lastResult: {
    outcome: "ok" | "failed" | "skipped";
    reason: string | null;
    at: Date;
    daysWritten: number;
  } | null;
  days: SiteDay[];
  /** Only breakdowns with data, in BREAKDOWN_METRICS order. */
  breakdowns: Breakdown[];
}

/** The most recent run, finished or not. Null when the job has never run. */
export async function getLastSnapshotRun(): Promise<SnapshotRun | null> {
  await requireSession();
  const [run] = await getDb()
    .select({
      startedAt: snapshotRuns.startedAt,
      finishedAt: snapshotRuns.finishedAt,
      sitesOk: snapshotRuns.sitesOk,
      sitesFailed: snapshotRuns.sitesFailed,
      sitesSkipped: snapshotRuns.sitesSkipped,
    })
    .from(snapshotRuns)
    .orderBy(desc(snapshotRuns.startedAt))
    .limit(1);
  return run ?? null;
}

export function isStale(run: SnapshotRun | null, now: Date): boolean {
  if (!run?.finishedAt) return true;
  return now.getTime() - run.finishedAt.getTime() > STALE_AFTER_HOURS * 60 * 60 * 1000;
}

/**
 * The last pull and the recent days for each of a client's sites, in two
 * queries however many sites it has.
 */
export async function getSiteSnapshots(siteIds: string[]): Promise<Map<string, SiteSnapshot>> {
  await requireSession();
  const snapshots = new Map<string, SiteSnapshot>(
    siteIds.map(siteId => [siteId, { lastResult: null, days: [], breakdowns: [] }]),
  );
  if (siteIds.length === 0) return snapshots;

  const db = getDb();
  const [results, days, breakdownRows] = await Promise.all([
    // One row per site: the latest result, whichever run it came from.
    db
      .select({
        siteId: siteSnapshotResults.siteId,
        outcome: siteSnapshotResults.outcome,
        reason: siteSnapshotResults.reason,
        at: siteSnapshotResults.createdAt,
        daysWritten: siteSnapshotResults.daysWritten,
      })
      .from(siteSnapshotResults)
      // PostHog's results only: search results share the table (add-search-console).
      .where(
        and(
          inArray(siteSnapshotResults.siteId, siteIds),
          eq(siteSnapshotResults.source, "posthog"),
        ),
      )
      .orderBy(siteSnapshotResults.siteId, desc(siteSnapshotResults.createdAt)),
    db
      .select({
        siteId: siteDailyMetrics.siteId,
        day: siteDailyMetrics.day,
        metric: siteDailyMetrics.metric,
        value: sql<number>`sum(${siteDailyMetrics.value})::int`,
      })
      .from(siteDailyMetrics)
      .where(
        and(
          inArray(siteDailyMetrics.siteId, siteIds),
          inArray(siteDailyMetrics.metric, ["page_views", "sessions", "lead_submitted"]),
          gte(siteDailyMetrics.day, sql`current_date - cast(${RECENT_DAYS} as int)`),
        ),
      )
      .groupBy(siteDailyMetrics.siteId, siteDailyMetrics.day, siteDailyMetrics.metric),
    db
      .select({
        siteId: siteDailyMetrics.siteId,
        metric: siteDailyMetrics.metric,
        dimension: siteDailyMetrics.dimension,
        value: sql<number>`sum(${siteDailyMetrics.value})::int`,
      })
      .from(siteDailyMetrics)
      .where(
        and(
          inArray(siteDailyMetrics.siteId, siteIds),
          inArray(siteDailyMetrics.metric, [...BREAKDOWN_METRICS]),
          gte(siteDailyMetrics.day, sql`current_date - cast(${RECENT_DAYS} as int)`),
        ),
      )
      .groupBy(siteDailyMetrics.siteId, siteDailyMetrics.metric, siteDailyMetrics.dimension)
      .orderBy(desc(sql`sum(${siteDailyMetrics.value})`), siteDailyMetrics.dimension),
  ]);

  for (const siteId of siteIds) {
    const snapshot = snapshots.get(siteId);
    if (!snapshot) continue;
    for (const metric of BREAKDOWN_METRICS) {
      const values = breakdownRows
        .filter(row => row.siteId === siteId && row.metric === metric && row.value > 0)
        .map(row => ({ dimension: row.dimension, value: row.value }));
      if (values.length > 0) snapshot.breakdowns.push({ metric, values });
    }
  }

  for (const result of results) {
    const snapshot = snapshots.get(result.siteId);
    // Ordered newest first, so the first row for a site is its latest result.
    if (snapshot && !snapshot.lastResult) {
      snapshot.lastResult = {
        outcome: result.outcome,
        reason: result.reason,
        at: result.at,
        daysWritten: result.daysWritten,
      };
    }
  }

  const bySite = new Map<string, Map<string, SiteDay>>();
  for (const row of days) {
    const forSite = bySite.get(row.siteId) ?? new Map<string, SiteDay>();
    const entry = forSite.get(row.day) ?? { day: row.day, pageViews: 0, sessions: 0, leads: 0 };
    if (row.metric === "page_views") entry.pageViews = row.value;
    if (row.metric === "sessions") entry.sessions = row.value;
    if (row.metric === "lead_submitted") entry.leads = row.value;
    forSite.set(row.day, entry);
    bySite.set(row.siteId, forSite);
  }

  for (const [siteId, forSite] of bySite) {
    const snapshot = snapshots.get(siteId);
    if (snapshot) snapshot.days = [...forSite.values()];
  }
  for (const snapshot of snapshots.values()) {
    // Newest first: the day someone wants is yesterday, not last Thursday. The
    // query asks for a day more than is shown, because "seven days ago" in
    // Postgres is UTC and a site's own week may start an hour either side.
    snapshot.days.sort((a, b) => b.day.localeCompare(a.day));
    snapshot.days.splice(RECENT_DAYS);
  }

  return snapshots;
}
