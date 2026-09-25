import { sql } from "drizzle-orm";
import {
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./columns";
import { currency, sites } from "./registry-schema";

/**
 * The nightly snapshot (openspec change add-nightly-snapshot): one row per site,
 * day, metric and breakdown value.
 *
 * Aggregate counts only. Nothing here identifies a visitor, and nothing may:
 * `dimension` holds a CTA id, a channel, a page type, a form id or a page path,
 * never a distinct id, a session id or anything typed into a form.
 */

export const snapshotOutcome = pgEnum("snapshot_outcome", ["ok", "failed", "skipped"]);

/** Which source a per-site result is for (add-search-console, design D6). */
export const snapshotSource = pgEnum("snapshot_source", [
  "posthog",
  "google_search",
  "bing_search",
]);
export const searchEngine = pgEnum("search_engine", ["google", "bing"]);
export const searchBreakdown = pgEnum("search_breakdown", ["total", "device", "query", "page"]);
export const indexVerdict = pgEnum("index_verdict", ["indexed", "not_indexed", "unknown"]);

/**
 * Search performance per site, engine, day and breakdown (add-search-console,
 * design D4). Aggregates only: a query is the engine's own anonymised
 * aggregate, and the engines withhold rare ones. Days are the engine's own:
 * Google's are Pacific Time.
 */
export const siteSearchDaily = pgTable(
  "site_search_daily",
  {
    id: uuid().primaryKey().defaultRandom(),
    siteId: uuid()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    engine: searchEngine().notNull(),
    day: date({ mode: "string" }).notNull(),
    breakdown: searchBreakdown().notNull(),
    /** '' for totals, else the device, query or page, at most 200 characters. */
    value: text().notNull().default(""),
    clicks: integer().notNull(),
    impressions: integer().notNull(),
    /** Position × impressions, so averages weight correctly across rows. */
    positionSum: doublePrecision().notNull(),
    ...timestamps,
  },
  table => [
    unique("site_search_daily_site_engine_day_breakdown_value_unique").on(
      table.siteId,
      table.engine,
      table.day,
      table.breakdown,
      table.value,
    ),
    index("site_search_daily_site_day_idx").on(table.siteId, table.day.desc()),
    check(
      "site_search_daily_non_negative",
      sql`${table.clicks} >= 0 and ${table.impressions} >= 0 and ${table.positionSum} >= 0`,
    ),
    check("site_search_daily_value_length", sql`length(${table.value}) <= 200`),
  ],
);

/** The weekly indexing pass's latest verdict per page (design D5b). */
export const siteIndexStatus = pgTable(
  "site_index_status",
  {
    id: uuid().primaryKey().defaultRandom(),
    siteId: uuid()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** A public page address with no query string. */
    address: text().notNull(),
    verdict: indexVerdict().notNull(),
    /** Google's own label for the page, such as "Page with redirect". */
    coverageState: text(),
    lastCrawlAt: timestamp({ withTimezone: true }),
    inspectedAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps,
  },
  table => [
    unique("site_index_status_site_address_unique").on(table.siteId, table.address),
    index("site_index_status_site_inspected_idx").on(table.siteId, table.inspectedAt),
    check("site_index_status_address_length", sql`length(${table.address}) <= 500`),
  ],
);

export const siteDailyMetrics = pgTable(
  "site_daily_metrics",
  {
    id: uuid().primaryKey().defaultRandom(),
    siteId: uuid()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** The day in the site's own timezone, not UTC. */
    day: date({ mode: "string" }).notNull(),
    /** A name from src/lib/snapshot-metrics.ts. */
    metric: text().notNull(),
    /** The breakdown value, or '' for a metric with no breakdown. */
    dimension: text().notNull().default(""),
    value: integer().notNull(),
    /** Money, in minor units, for the revenue metrics only. */
    valueMinor: integer(),
    currency: currency(),
    ...timestamps,
  },
  table => [
    unique("site_daily_metrics_site_day_metric_dimension_unique").on(
      table.siteId,
      table.day,
      table.metric,
      table.dimension,
    ),
    index("site_daily_metrics_site_day_idx").on(table.siteId, table.day.desc()),
    check("site_daily_metrics_value_non_negative", sql`${table.value} >= 0`),
    check(
      "site_daily_metrics_currency_required",
      sql`${table.valueMinor} is null or ${table.currency} is not null`,
    ),
    check("site_daily_metrics_dimension_length", sql`length(${table.dimension}) <= 200`),
  ],
);

export const snapshotRuns = pgTable(
  "snapshot_runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    /** Null while the run is in progress, or if the process died mid-run. */
    finishedAt: timestamp({ withTimezone: true }),
    sitesOk: integer().notNull().default(0),
    sitesFailed: integer().notNull().default(0),
    sitesSkipped: integer().notNull().default(0),
    ...timestamps,
  },
  table => [index("snapshot_runs_started_at_idx").on(table.startedAt.desc())],
);

export const siteSnapshotResults = pgTable(
  "site_snapshot_results",
  {
    id: uuid().primaryKey().defaultRandom(),
    runId: uuid()
      .notNull()
      .references(() => snapshotRuns.id, { onDelete: "cascade" }),
    siteId: uuid()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** PostHog, or one of the search engines; every row before search is PostHog's. */
    source: snapshotSource().notNull().default("posthog"),
    outcome: snapshotOutcome().notNull(),
    /** A fixed message from the app, never PostHog's own error text. */
    reason: text(),
    daysWritten: integer().notNull().default(0),
    durationMs: integer().notNull().default(0),
    ...timestamps,
  },
  table => [
    unique("site_snapshot_results_run_site_source_unique").on(
      table.runId,
      table.siteId,
      table.source,
    ),
    index("site_snapshot_results_run_id_idx").on(table.runId),
    index("site_snapshot_results_site_created_idx").on(table.siteId, table.createdAt.desc()),
    check(
      "site_snapshot_results_reason_required",
      sql`${table.outcome} = 'ok' or ${table.reason} is not null`,
    ),
  ],
);
