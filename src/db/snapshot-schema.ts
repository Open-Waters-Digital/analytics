import { sql } from "drizzle-orm";
import {
  check,
  date,
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
    outcome: snapshotOutcome().notNull(),
    /** A fixed message from the app, never PostHog's own error text. */
    reason: text(),
    daysWritten: integer().notNull().default(0),
    durationMs: integer().notNull().default(0),
    ...timestamps,
  },
  table => [
    unique("site_snapshot_results_run_site_unique").on(table.runId, table.siteId),
    index("site_snapshot_results_run_id_idx").on(table.runId),
    index("site_snapshot_results_site_created_idx").on(table.siteId, table.createdAt.desc()),
    check(
      "site_snapshot_results_reason_required",
      sql`${table.outcome} = 'ok' or ${table.reason} is not null`,
    ),
  ],
);
