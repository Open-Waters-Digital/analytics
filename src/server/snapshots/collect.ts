import { and, eq, lt, ne, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  clients,
  posthogConnections,
  siteDailyMetrics,
  siteSnapshotResults,
  sites,
  snapshotRuns,
} from "@/db/schema";
import { HEADLINE_METRICS, NO_DIMENSION } from "@/lib/snapshot-metrics";
import { decryptApiKey } from "@/server/crypto";
import { credentialsKey } from "@/server/env";
import {
  buildSnapshotQueries,
  MixedCurrencyError,
  normaliseRows,
  parseQueryRows,
  UnreadableResponseError,
  type MetricRow,
} from "@/server/posthog-queries";
import { CHECK_MESSAGES, runHogQlQueryWithRetry, type QueryOptions } from "@/server/posthog";
import { FIRST_PULL_DAYS, snapshotWindow, WINDOW_DAYS, type DayWindow } from "./window";

/**
 * The nightly pull, as run by scripts/jobs/nightly-snapshot.ts.
 *
 * **This module runs as the system, with no session and no user**, which is why
 * it is the one place under src/server that does not call `requireSession()`.
 * Nothing in src/app may import it (an ESLint rule says so); everything the app
 * reads goes through ./read.ts, which checks the session as usual.
 *
 * It also does not import `server-only`: that marker throws outside a React
 * Server Components build, and this runs in a plain Node process.
 */

/** Reasons a site is skipped or a pull failed. Fixed strings, never PostHog's. */
export const SNAPSHOT_MESSAGES = {
  noConnection: "No PostHog connection for this site.",
  clientOwned: "The client runs PostHog themselves and has not shared a key.",
  connectionFailed: "The last connection check failed. Check the key on the client page.",
  unreadableKey: "Stored key cannot be read. Enter the key again.",
  unreadableResponse: "PostHog returned rows this app could not read.",
  mixedCurrency: "More than one currency in a day; the figures cannot be added up.",
} as const;

/** Runs older than this are deleted at the end of each run. */
export const RUN_HISTORY_DAYS = 90;
export const DEFAULT_CONCURRENCY = 3;

export type SiteOutcome = "ok" | "failed" | "skipped";

export interface SiteResult {
  siteId: string;
  clientSlug: string;
  outcome: SiteOutcome;
  reason: string | null;
  daysWritten: number;
  durationMs: number;
}

export interface RunSummary {
  runId: string;
  startedAt: Date;
  finishedAt: Date;
  results: SiteResult[];
}

export interface SnapshotDeps {
  now: () => Date;
  fetchImpl: typeof fetch;
  masterKey: () => Buffer;
  sleep: (ms: number) => Promise<void>;
  concurrency: number;
}

const defaultDeps: SnapshotDeps = {
  now: () => new Date(),
  fetchImpl: fetch,
  masterKey: credentialsKey,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  concurrency: DEFAULT_CONCURRENCY,
};

interface Candidate {
  siteId: string;
  clientSlug: string;
  timezone: string;
  clientOwned: boolean;
  connection: {
    id: string;
    region: "eu" | "us";
    projectId: number;
    apiKeyCiphertext: string;
    lastCheckStatus: "ok" | "unauthorised" | "project_not_found" | "error" | null;
  } | null;
}

export async function runNightlySnapshot(
  overrides: Partial<SnapshotDeps> = {},
): Promise<RunSummary> {
  const deps = { ...defaultDeps, ...overrides };
  // Read once, before anything else: with no key nothing can be decrypted, and
  // a run that quietly failed every site would look like broken tracking.
  const masterKey = deps.masterKey();
  const db = getDb();

  const startedAt = deps.now();
  const [run] = await db
    .insert(snapshotRuns)
    .values({ startedAt })
    .returning({ id: snapshotRuns.id });
  const runId = run!.id;

  const candidates = await selectCandidates();
  const results = await mapWithConcurrency(candidates, deps.concurrency, async candidate => {
    const result = await pullSite(candidate, deps, masterKey);
    await recordSiteResult(runId, result);
    return result;
  });

  const finishedAt = deps.now();
  await db
    .update(snapshotRuns)
    .set({
      finishedAt,
      sitesOk: results.filter(result => result.outcome === "ok").length,
      sitesFailed: results.filter(result => result.outcome === "failed").length,
      sitesSkipped: results.filter(result => result.outcome === "skipped").length,
    })
    .where(eq(snapshotRuns.id, runId));

  await pruneOldRuns(finishedAt);

  return { runId, startedAt, finishedAt, results };
}

/**
 * Every site that is still Open Waters' to measure. Offboarded clients are not
 * selected at all: they are not skipped work, they are no longer work.
 */
async function selectCandidates(): Promise<Candidate[]> {
  const rows = await getDb()
    .select({
      siteId: sites.id,
      clientSlug: clients.slug,
      timezone: sites.timezone,
      analyticsOwnership: clients.analyticsOwnership,
      connectionId: posthogConnections.id,
      region: posthogConnections.region,
      projectId: posthogConnections.projectId,
      apiKeyCiphertext: posthogConnections.apiKeyCiphertext,
      lastCheckStatus: posthogConnections.lastCheckStatus,
    })
    .from(sites)
    .innerJoin(clients, eq(clients.id, sites.clientId))
    .leftJoin(posthogConnections, eq(posthogConnections.siteId, sites.id))
    .where(ne(clients.status, "offboarded"))
    .orderBy(clients.slug, sites.productionUrl);

  return rows.map(row => ({
    siteId: row.siteId,
    clientSlug: row.clientSlug,
    timezone: row.timezone,
    clientOwned: row.analyticsOwnership === "client_owned",
    connection:
      row.connectionId && row.region && row.projectId !== null && row.apiKeyCiphertext
        ? {
            id: row.connectionId,
            region: row.region,
            projectId: row.projectId,
            apiKeyCiphertext: row.apiKeyCiphertext,
            lastCheckStatus: row.lastCheckStatus,
          }
        : null,
  }));
}

async function pullSite(
  candidate: Candidate,
  deps: SnapshotDeps,
  masterKey: Buffer,
): Promise<SiteResult> {
  const started = Date.now();
  const base = {
    siteId: candidate.siteId,
    clientSlug: candidate.clientSlug,
    daysWritten: 0,
    durationMs: 0,
  };
  const done = (outcome: SiteOutcome, reason: string | null, daysWritten = 0): SiteResult => ({
    ...base,
    outcome,
    reason,
    daysWritten,
    durationMs: Date.now() - started,
  });

  const skip = skipReason(candidate);
  if (skip) return done("skipped", skip);

  const connection = candidate.connection!;
  const key = decryptApiKey(connection.apiKeyCiphertext, connection.id, masterKey);
  if (!key.ok) return done("failed", SNAPSHOT_MESSAGES.unreadableKey);

  const window = snapshotWindow(
    deps.now(),
    candidate.timezone,
    (await hasMetrics(candidate.siteId)) ? WINDOW_DAYS : FIRST_PULL_DAYS,
  );

  const queryOptions: QueryOptions & { sleep: (ms: number) => Promise<void> } = {
    fetchImpl: deps.fetchImpl,
    sleep: deps.sleep,
  };
  const target = {
    region: connection.region,
    projectId: connection.projectId,
    apiKey: key.apiKey,
  };

  const rows: MetricRow[] = [];
  for (const { group, query } of buildSnapshotQueries({
    ...window,
    timezone: candidate.timezone,
  })) {
    const outcome = await runHogQlQueryWithRetry(target, query, {
      ...queryOptions,
      name: `openwaters_snapshot_${group}`,
    });
    if (!outcome.ok) {
      await recordConnectionCheck(connection.id, outcome.failure, deps.now());
      return done("failed", outcome.failure.message ?? CHECK_MESSAGES.unexpected);
    }

    try {
      rows.push(...parseQueryRows(outcome.body));
    } catch (error) {
      if (error instanceof UnreadableResponseError) {
        return done("failed", SNAPSHOT_MESSAGES.unreadableResponse);
      }
      throw error;
    }
  }

  let normalised: MetricRow[];
  try {
    normalised = normaliseRows(rows);
  } catch (error) {
    if (error instanceof MixedCurrencyError) return done("failed", SNAPSHOT_MESSAGES.mixedCurrency);
    throw error;
  }

  await writeWindow(candidate.siteId, window, normalised);
  await recordConnectionCheck(connection.id, { status: "ok", message: null }, deps.now());
  return done("ok", null, window.days.length);
}

function skipReason(candidate: Candidate): string | null {
  if (!candidate.connection) {
    return candidate.clientOwned ? SNAPSHOT_MESSAGES.clientOwned : SNAPSHOT_MESSAGES.noConnection;
  }
  // A key PostHog has already rejected will be rejected again: asking wastes a
  // request and buries the real reason under a second failure. An outage is
  // different, and must not stop tomorrow's pull, so it is not a skip.
  const status = candidate.connection.lastCheckStatus;
  return status === "unauthorised" || status === "project_not_found"
    ? SNAPSHOT_MESSAGES.connectionFailed
    : null;
}

async function hasMetrics(siteId: string): Promise<boolean> {
  const [existing] = await getDb()
    .select({ one: sql<number>`1` })
    .from(siteDailyMetrics)
    .where(eq(siteDailyMetrics.siteId, siteId))
    .limit(1);
  return existing !== undefined;
}

/**
 * Replaces the window in one transaction: the old rows go and the new ones
 * arrive together, so a re-run never doubles a count and a failure never leaves
 * a half-written day.
 *
 * Every day in the window gets a zero row for each headline metric first, so a
 * missing row always means "not pulled" rather than "nothing happened".
 */
async function writeWindow(siteId: string, window: DayWindow, rows: MetricRow[]): Promise<void> {
  const values = new Map<string, typeof siteDailyMetrics.$inferInsert>();

  for (const day of window.days) {
    for (const metric of HEADLINE_METRICS) {
      values.set(keyOf(day, metric, NO_DIMENSION), {
        siteId,
        day,
        metric,
        dimension: NO_DIMENSION,
        value: 0,
        valueMinor: null,
        currency: null,
      });
    }
  }

  for (const row of rows) {
    // PostHog can only return days inside the window, but a stray one would
    // land outside the range the delete below clears.
    if (row.day < window.from || row.day > window.to) continue;
    values.set(keyOf(row.day, row.metric, row.dimension), {
      siteId,
      day: row.day,
      metric: row.metric,
      dimension: row.dimension,
      value: row.value,
      valueMinor: row.valueMinor,
      currency: row.currency,
    });
  }

  const inserts = [...values.values()];
  await getDb().transaction(async tx => {
    await tx
      .delete(siteDailyMetrics)
      .where(
        and(
          eq(siteDailyMetrics.siteId, siteId),
          sql`${siteDailyMetrics.day} >= ${window.from}`,
          sql`${siteDailyMetrics.day} <= ${window.to}`,
        ),
      );
    for (let index = 0; index < inserts.length; index += 500) {
      await tx.insert(siteDailyMetrics).values(inserts.slice(index, index + 500));
    }
  });
}

/**
 * A pull is also a connection check, so the registry screen shows a rejected
 * key without anyone pressing "Test connection".
 *
 * An outage is deliberately not written: it says nothing about the key, and
 * storing it would make tomorrow's run skip a site that is perfectly fine.
 */
async function recordConnectionCheck(
  connectionId: string,
  result: { status: "ok" | "unauthorised" | "project_not_found" | "error"; message: string | null },
  now: Date,
): Promise<void> {
  if (result.status === "error") return;
  await getDb()
    .update(posthogConnections)
    .set({
      lastCheckAt: now,
      lastCheckStatus: result.status,
      lastCheckMessage: result.message,
    })
    .where(eq(posthogConnections.id, connectionId));
}

async function recordSiteResult(runId: string, result: SiteResult): Promise<void> {
  await getDb().insert(siteSnapshotResults).values({
    runId,
    siteId: result.siteId,
    outcome: result.outcome,
    reason: result.reason,
    daysWritten: result.daysWritten,
    durationMs: result.durationMs,
  });
}

async function pruneOldRuns(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - RUN_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  await getDb().delete(snapshotRuns).where(lt(snapshotRuns.startedAt, cutoff));
}

/** A composite map key that no breakdown value can forge. */
function keyOf(...parts: string[]): string {
  return JSON.stringify(parts);
}

/**
 * Keeps a few sites in flight at once, so one slow project does not hold up the
 * rest and the work does not grow with the number of clients.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!);
    }
  });

  await Promise.all(runners);
  return results;
}

export type { Candidate };
