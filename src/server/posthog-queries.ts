import { z } from "zod";
import {
  MAX_DIMENSION_LENGTH,
  NO_DIMENSION,
  NO_DIMENSION_VALUE,
  snapshotMetric,
} from "@/lib/snapshot-metrics";

/**
 * The HogQL the nightly snapshot sends, and the parsing of what comes back.
 *
 * Six queries per site, each returning the same six columns, so one parser
 * handles all of them and a new metric is a line of SQL rather than a new code
 * path. Every query aggregates: no row here describes a single visitor.
 *
 * Values are interpolated, not bound. PostHog's query API does not document
 * placeholder binding, so `literal` is the only way a value reaches a query and
 * it accepts nothing but an ISO date or an IANA timezone name.
 */

export interface SnapshotQuery {
  /** Identifies the query in logs when it fails. Never a client's data. */
  group: string;
  query: string;
}

export interface MetricRow {
  day: string;
  metric: string;
  dimension: string;
  value: number;
  valueMinor: number | null;
  currency: "GBP" | "EUR" | "USD" | null;
}

export class UnreadableResponseError extends Error {
  override name = "UnreadableResponseError";
}

export class MixedCurrencyError extends Error {
  override name = "MixedCurrencyError";
}

/** Rows kept per metric per day. The tail of a long breakdown is dropped. */
export const MAX_DIMENSION_ROWS = 50;

const CURRENCIES = new Set(["GBP", "EUR", "USD"]);

/** Wider than any window, so ClickHouse can skip older partitions. */
const COARSE_BOUND = "now() - INTERVAL 45 DAY";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A SQL literal, or an error. Nothing else may be interpolated into a query:
 * everything here comes from our own records, and this is what keeps it that
 * way.
 */
export function literalDate(value: string): string {
  if (!ISO_DATE.test(value)) throw new TypeError("Day must be YYYY-MM-DD");
  return `'${value}'`;
}

export function literalTimezone(value: string): string {
  // Intl is the authority on what ClickHouse's toTimeZone will accept, and it
  // rejects anything with a quote in it long before we reach the query.
  if (!Intl.supportedValuesOf("timeZone").includes(value)) {
    throw new TypeError("Unknown timezone");
  }
  return `'${value}'`;
}

export interface SnapshotWindow {
  from: string;
  to: string;
  timezone: string;
}

export function buildSnapshotQueries(window: SnapshotWindow): SnapshotQuery[] {
  const tz = literalTimezone(window.timezone);
  const from = literalDate(window.from);
  const to = literalDate(window.to);

  const eventDay = `toDate(toTimeZone(timestamp, ${tz}))`;
  const sessionDay = `toDate(toTimeZone(\`$start_timestamp\`, ${tz}))`;
  const eventWindow = `${eventDay} >= ${from} AND ${eventDay} <= ${to} AND timestamp > ${COARSE_BOUND}`;
  const sessionWindow = `${sessionDay} >= ${from} AND ${sessionDay} <= ${to} AND \`$start_timestamp\` > ${COARSE_BOUND}`;

  const events = (metric: string, event: string, dimension?: string, aggregate?: string) =>
    branch({
      day: eventDay,
      metric,
      dimension: dimension ? property(dimension) : undefined,
      aggregate,
      from: "events",
      where: `${eventWindow} AND event = ${sqlString(event)}`,
    });

  return [
    {
      group: "traffic",
      query: wrap([
        events("page_views", "$pageview"),
        events("daily_visitors", "$pageview", undefined, "uniq(distinct_id)"),
      ]),
    },
    {
      group: "pages",
      query: wrap([events("page_views_by_page_type", "$pageview", "page_type")]),
    },
    {
      group: "sessions",
      query: wrap([
        branch({ day: sessionDay, metric: "sessions", from: "sessions", where: sessionWindow }),
        branch({
          day: sessionDay,
          metric: "sessions_by_channel",
          dimension: fallback("`$channel_type`"),
          from: "sessions",
          where: sessionWindow,
        }),
        branch({
          day: sessionDay,
          metric: "landing_page_views",
          dimension: fallback("`$entry_pathname`"),
          from: "sessions",
          where: sessionWindow,
        }),
      ]),
    },
    {
      group: "intent",
      query: wrap([
        events("cta_clicked", "cta_clicked", "cta_id"),
        events("contact_link_clicked", "contact_link_clicked", "channel"),
        events("file_downloaded", "file_downloaded", "file_type"),
        events("outbound_link_clicked", "outbound_link_clicked", "link_domain"),
        events("video_played", "video_played", "video_id"),
        branch({
          day: eventDay,
          metric: "scroll_75_sessions",
          aggregate: "uniq(properties.$session_id)",
          from: "events",
          where: `${eventWindow} AND event = 'scroll_depth_reached' AND toInt(properties.depth_percent) = 75`,
        }),
      ]),
    },
    {
      group: "action",
      query: wrap([
        events("form_started", "form_started", "form_id"),
        events("form_submitted", "form_submitted", "form_id"),
        events("form_abandoned", "form_abandoned", "form_id"),
        events("form_error_shown", "form_error_shown", "form_id"),
        events("lead_submitted", "lead_submitted", "lead_type"),
      ]),
    },
    {
      group: "revenue",
      query: wrap([
        events("lead_qualified", "lead_qualified", "lead_type"),
        branch({
          day: eventDay,
          metric: "deal_won",
          dimension: property("lead_type"),
          from: "events",
          where: `${eventWindow} AND event = 'deal_won'`,
          // Money arrives as a major-unit number on the event; minor units are
          // what this app stores (AGENTS.md), so it is rounded once, here.
          valueMinor: "toInt(round(sum(toFloat(properties.value)) * 100))",
          currency: fallback("properties.currency", ""),
        }),
      ]),
    },
  ];
}

interface BranchInput {
  day: string;
  metric: string;
  from: "events" | "sessions";
  where: string;
  dimension?: string;
  aggregate?: string;
  valueMinor?: string;
  currency?: string;
}

function branch(input: BranchInput): string {
  const dimension = input.dimension ?? "''";
  const currency = input.currency ?? "''";
  const groupBy = ["day", "dimension"];
  if (input.currency) groupBy.push("currency");

  return `SELECT
  ${input.day} AS day,
  ${sqlString(input.metric)} AS metric,
  ${dimension} AS dimension,
  ${input.aggregate ?? "count()"} AS value,
  ${input.valueMinor ?? "0"} AS value_minor,
  ${currency} AS currency
FROM ${input.from}
WHERE ${input.where}
GROUP BY ${groupBy.join(", ")}`;
}

/**
 * A trailing LIMIT would bind to the last branch of a UNION ALL only, so the
 * whole thing is wrapped. The limit is a guard against a runaway breakdown, not
 * the cap: that is applied per metric per day in `normaliseRows`.
 */
function wrap(branches: string[]): string {
  return `SELECT day, metric, dimension, value, value_minor, currency
FROM (
${branches.join("\nUNION ALL\n")}
)
ORDER BY metric, day, value DESC
LIMIT 20000`;
}

function property(name: string): string {
  return fallback(`properties.${name}`);
}

/** An absent or empty breakdown value reads as "(none)", not as a blank cell. */
function fallback(expression: string, absent: string = NO_DIMENSION_VALUE): string {
  return `ifNull(nullIf(toString(${expression}), ''), ${sqlString(absent)})`;
}

function sqlString(value: string): string {
  if (value.includes("'") || value.includes("\\")) {
    throw new TypeError("Refusing to build a query from an unexpected value");
  }
  return `'${value}'`;
}

const count = z
  .union([z.number(), z.string()])
  .transform(value => (typeof value === "number" ? value : Number(value)))
  .refine(value => Number.isFinite(value), "not a number")
  .transform(value => Math.max(0, Math.round(value)));

const responseSchema = z.object({
  results: z.array(
    z.tuple([
      // ClickHouse returns a Date as YYYY-MM-DD; anything else is a shape change.
      z.string().regex(ISO_DATE),
      z.string(),
      z.string(),
      count,
      count,
      z.string(),
    ]),
  ),
});

/**
 * Parses one query's response. A shape this does not recognise is an error, not
 * something to coerce: a wrong number stored silently is worse than a site that
 * fails loudly.
 */
export function parseQueryRows(body: unknown): MetricRow[] {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    throw new UnreadableResponseError("PostHog returned rows in an unexpected shape");
  }

  return parsed.data.results.map(([day, metric, dimension, value, valueMinor, currency]) => ({
    day,
    metric,
    dimension,
    value,
    // A site sending a currency this app does not store keeps its count and
    // loses its value, which is better than losing the day.
    valueMinor: valueMinor > 0 && CURRENCIES.has(currency) ? valueMinor : null,
    currency: CURRENCIES.has(currency) ? (currency as MetricRow["currency"]) : null,
  }));
}

/**
 * Makes rows safe to store: known metrics only, breakdown values truncated,
 * paths without their query strings, and at most `MAX_DIMENSION_ROWS` values per
 * metric per day. Truncation can make two values equal, so equal rows are added
 * together rather than colliding on the unique key.
 */
export function normaliseRows(rows: MetricRow[]): MetricRow[] {
  const merged = new Map<string, MetricRow>();

  for (const row of rows) {
    const metric = snapshotMetric(row.metric);
    if (!metric) continue; // Built by this file; anything else is not ours.

    const dimension =
      metric.dimension === null
        ? NO_DIMENSION
        : truncate(metric.name === "landing_page_views" ? pathOnly(row.dimension) : row.dimension);

    const key = keyOf(row.day, metric.name, dimension);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row, metric: metric.name, dimension });
      continue;
    }

    if (existing.currency !== null && row.currency !== null && existing.currency !== row.currency) {
      throw new MixedCurrencyError(
        `More than one currency for ${metric.name} on ${row.day}; a report cannot add them up`,
      );
    }
    existing.value += row.value;
    if (row.valueMinor !== null) {
      existing.valueMinor = (existing.valueMinor ?? 0) + row.valueMinor;
      existing.currency ??= row.currency;
    }
  }

  const byMetricDay = new Map<string, MetricRow[]>();
  for (const row of merged.values()) {
    const key = keyOf(row.metric, row.day);
    const group = byMetricDay.get(key);
    if (group) group.push(row);
    else byMetricDay.set(key, [row]);
  }

  return [...byMetricDay.values()].flatMap(group =>
    group.length <= MAX_DIMENSION_ROWS
      ? group
      : [...group].sort((a, b) => b.value - a.value).slice(0, MAX_DIMENSION_ROWS),
  );
}

/**
 * A page address reduced to its path. A query string can carry an email address
 * or a token, and nothing here needs one.
 */
function pathOnly(value: string): string {
  if (value === NO_DIMENSION_VALUE) return value;
  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).pathname || "/";
    } catch {
      return "/";
    }
  }
  const withoutFragment = value.split("#")[0] ?? "";
  const withoutQuery = withoutFragment.split("?")[0] ?? "";
  return withoutQuery === "" ? "/" : withoutQuery;
}

/** A composite map key that no breakdown value can forge. */
function keyOf(...parts: string[]): string {
  return JSON.stringify(parts);
}

function truncate(value: string): string {
  return value.length > MAX_DIMENSION_LENGTH ? value.slice(0, MAX_DIMENSION_LENGTH) : value;
}
