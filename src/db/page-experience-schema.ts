import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth-schema";
import { timestamps } from "./columns";
import { sites } from "./registry-schema";

/**
 * Page experience (openspec change add-page-experience): how fast and stable a
 * client site is, for real Chrome visitors (field) and in a Lighthouse run
 * (lab). Aggregates only: the Chrome UX Report is Google's own anonymised
 * aggregate, and a lab run loads a public page as a robot.
 */

export const peSource = pgEnum("pe_source", ["field", "field_history", "lab"]);
export const peScope = pgEnum("pe_scope", ["origin", "page"]);
export const peFormFactor = pgEnum("pe_form_factor", ["phone", "desktop"]);
export const peStatus = pgEnum("pe_status", ["ok", "not_enough_data", "failed"]);
export const peLabRunStatus = pgEnum("pe_lab_run_status", ["running", "done", "failed"]);

/** One measurement: a site's origin or a tracked page, on a form factor, on a day (design D2). */
export const sitePageExperience = pgTable(
  "site_page_experience",
  {
    id: uuid().primaryKey().defaultRandom(),
    siteId: uuid()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** The day of the pull, UTC; for history, the collection period's last day. */
    day: date({ mode: "string" }).notNull(),
    source: peSource().notNull(),
    scope: peScope().notNull(),
    /** '' for the origin, else the tracked path. */
    path: text().notNull().default(""),
    formFactor: peFormFactor().notNull(),
    status: peStatus().notNull(),
    lcpMs: integer(),
    inpMs: integer(),
    fcpMs: integer(),
    ttfbMs: integer(),
    tbtMs: integer(),
    speedIndexMs: integer(),
    cls: numeric({ precision: 6, scale: 4 }),
    labScore: smallint(),
    /**
     * Field only: for each metric, the shares of visits rated good, needs
     * improvement and poor, as `{ lcp: [0.8, 0.15, 0.05], ... }`.
     */
    distribution: jsonb().$type<Record<string, [number, number, number]>>(),
    /** A fixed message when status is failed. */
    reason: text(),
    ...timestamps,
  },
  table => [
    unique("site_page_experience_site_day_source_scope_path_form_unique").on(
      table.siteId,
      table.day,
      table.source,
      table.scope,
      table.path,
      table.formFactor,
    ),
    index("site_page_experience_site_day_idx").on(table.siteId, table.day.desc()),
    check(
      "site_page_experience_lab_score_range",
      sql`${table.labScore} is null or (${table.labScore} >= 0 and ${table.labScore} <= 100)`,
    ),
    check(
      "site_page_experience_reason_when_failed",
      sql`${table.status} <> 'failed' or ${table.reason} is not null`,
    ),
  ],
);

/** Up to ten paths per site, `/` always among them (design D7). */
export const siteTrackedPages = pgTable(
  "site_tracked_pages",
  {
    id: uuid().primaryKey().defaultRandom(),
    siteId: uuid()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    path: text().notNull(),
    ...timestamps,
  },
  table => [
    unique("site_tracked_pages_site_path_unique").on(table.siteId, table.path),
    check("site_tracked_pages_path_shape", sql`${table.path} ~ '^/[^?#]*$'`),
    check("site_tracked_pages_path_length", sql`length(${table.path}) <= 200`),
  ],
);

/** Optional targets per site; a missing one falls back to Google's "good" threshold. */
export const sitePerformanceBudgets = pgTable(
  "site_performance_budgets",
  {
    id: uuid().primaryKey().defaultRandom(),
    siteId: uuid()
      .notNull()
      .unique()
      .references(() => sites.id, { onDelete: "cascade" }),
    lcpMs: integer(),
    inpMs: integer(),
    cls: numeric({ precision: 5, scale: 3 }),
    labScore: smallint(),
    ...timestamps,
  },
  table => [
    check(
      "site_performance_budgets_non_negative",
      sql`coalesce(${table.lcpMs}, 0) >= 0 and coalesce(${table.inpMs}, 0) >= 0 and coalesce(${table.cls}, 0) >= 0`,
    ),
    check(
      "site_performance_budgets_lab_score_range",
      sql`${table.labScore} is null or (${table.labScore} >= 0 and ${table.labScore} <= 100)`,
    ),
  ],
);

/** A lab run in progress or finished, so only one runs per site at a time (design D4). */
export const peLabRuns = pgTable(
  "pe_lab_runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    siteId: uuid()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    runBy: uuid().references(() => users.id, { onDelete: "set null" }),
    status: peLabRunStatus().notNull().default("running"),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    finishedAt: timestamp({ withTimezone: true }),
    pagesDone: integer().notNull().default(0),
    ...timestamps,
  },
  table => [
    index("pe_lab_runs_site_started_idx").on(table.siteId, table.startedAt.desc()),
    index("pe_lab_runs_run_by_idx").on(table.runBy),
  ],
);
