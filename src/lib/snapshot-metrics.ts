/**
 * What the nightly snapshot stores, one entry per `metric` value in
 * `site_daily_metrics`.
 *
 * The stages are the Digital Dividend ladder. Every metric below Attention is
 * counted from an event in `src/lib/event-list.ts`; adding an event there
 * without adding a metric here fails a test, so the two cannot drift.
 */

export type MetricStage = "attention" | "intent" | "action" | "consent" | "revenue";

export interface SnapshotMetric {
  name: string;
  stage: MetricStage;
  /** What the breakdown column holds, or null for a metric with no breakdown. */
  dimension: string | null;
  /** The event it counts, for metrics that come from one. */
  event?: string;
  /** Carries money in `value_minor` and `currency` as well as a count. */
  money?: true;
  /** True when the number is only meaningful for a single day (see below). */
  dailyOnly?: true;
}

/**
 * Longest breakdown value stored. The column has the same limit as a check
 * constraint, because the value comes from a client's own site.
 */
export const MAX_DIMENSION_LENGTH = 200;

/** Used when a breakdown property is missing or empty on the event. */
export const NO_DIMENSION_VALUE = "(none)";

/**
 * Used when the event was sent at a taxonomy version older than the property,
 * so the site could not have sent it: "does not measure this yet", as distinct
 * from "(none)", "measured, and empty". Decided per event from its own
 * taxonomy_version, so a site that upgrades mid-week is right on both sides.
 */
export const NOT_RECORDED_DIMENSION_VALUE = "(not recorded)";

/** The dimension column's value for a metric with no breakdown. */
export const NO_DIMENSION = "";

export const SNAPSHOT_METRICS: readonly SnapshotMetric[] = [
  { name: "page_views", stage: "attention", dimension: null },
  // Cookieless PostHog gives each visitor a hash that changes every day, so one
  // day's number is a fair count of that day's visitors and adding seven of
  // them is NOT a weekly figure. Never sum this across days.
  { name: "daily_visitors", stage: "attention", dimension: null, dailyOnly: true },
  { name: "sessions", stage: "attention", dimension: null },
  { name: "page_views_by_page_type", stage: "attention", dimension: "page_type" },
  { name: "sessions_by_channel", stage: "attention", dimension: "channel" },
  { name: "landing_page_views", stage: "attention", dimension: "path" },

  { name: "cta_clicked", stage: "intent", dimension: "cta_id", event: "cta_clicked" },
  {
    name: "contact_link_clicked",
    stage: "intent",
    dimension: "channel",
    event: "contact_link_clicked",
  },
  { name: "file_downloaded", stage: "intent", dimension: "file_type", event: "file_downloaded" },
  {
    name: "outbound_link_clicked",
    stage: "intent",
    dimension: "link_domain",
    event: "outbound_link_clicked",
  },
  { name: "video_played", stage: "intent", dimension: "video_id", event: "video_played" },
  {
    name: "scroll_75_sessions",
    stage: "intent",
    dimension: null,
    event: "scroll_depth_reached",
    dailyOnly: true,
  },

  { name: "form_started", stage: "action", dimension: "form_id", event: "form_started" },
  { name: "form_submitted", stage: "action", dimension: "form_id", event: "form_submitted" },
  { name: "form_abandoned", stage: "action", dimension: "form_id", event: "form_abandoned" },
  { name: "form_error_shown", stage: "action", dimension: "form_id", event: "form_error_shown" },
  { name: "lead_submitted", stage: "action", dimension: "lead_type", event: "lead_submitted" },
  // Taxonomy v3. A lead sent at v1 or v2 is "(not recorded)".
  { name: "leads_by_channel", stage: "action", dimension: "channel", event: "lead_submitted" },
  {
    name: "leads_by_heard_about",
    stage: "action",
    dimension: "heard_about",
    event: "lead_submitted",
  },

  // Taxonomy v2, sites with a consent banner. Coverage is the share of page
  // views with ad_consent "granted"; a page view sent at v1 is "(not recorded)".
  { name: "consent_updated", stage: "consent", dimension: "advertising", event: "consent_updated" },
  {
    name: "page_views_by_ad_consent",
    stage: "consent",
    dimension: "ad_consent",
  },

  { name: "lead_qualified", stage: "revenue", dimension: "lead_type", event: "lead_qualified" },
  { name: "deal_won", stage: "revenue", dimension: "lead_type", event: "deal_won", money: true },
];

export type MetricName = (typeof SNAPSHOT_METRICS)[number]["name"];

const BY_NAME = new Map(SNAPSHOT_METRICS.map(metric => [metric.name, metric]));

export function snapshotMetric(name: string): SnapshotMetric | undefined {
  return BY_NAME.get(name);
}

export function isSnapshotMetric(name: string): boolean {
  return BY_NAME.has(name);
}

/**
 * Written for every day in the window even when nothing happened, so a missing
 * row means "not pulled" rather than "quiet day". Only metrics with no
 * breakdown qualify: a zero row has no breakdown value to write.
 */
export const HEADLINE_METRICS = ["page_views", "sessions", "daily_visitors"] as const;
