import {
  BASELINE_DASHBOARDS,
  type DashboardInsight,
  type InsightSeries,
} from "@open-waters-digital/analytics/contract";
import { COOKIELESS_HASH_MODE_ON, MASK_ALL_INPUTS } from "./posthog-fields";

/**
 * What a site's PostHog project should look like, from the registry and the
 * contract (add-provisioning, design D2 and D5a). Pure: no I/O, so every rule is
 * unit tested without PostHog.
 */

export type MeasurementTier = "essentials" | "insights" | "growth";

export interface ProvisioningSite {
  productionUrl: string;
  timezone: string;
  taxonomyVersion: number;
  usesHeatmaps: boolean;
  measurementTier: MeasurementTier;
  tierConfirmedFor: MeasurementTier | null;
}

/** A project setting and the value it must have. */
export interface DesiredSetting {
  field: string;
  label: string;
  value: unknown;
  /**
   * True while the site's tier is above Essentials and not yet confirmed:
   * reported by a check, skipped by apply (design D5a).
   */
  held: boolean;
}

export function origin(productionUrl: string): string {
  return new URL(productionUrl).origin;
}

export function tierIsConfirmed(site: ProvisioningSite): boolean {
  return site.measurementTier === "essentials" || site.tierConfirmedFor === site.measurementTier;
}

export function desiredProject(site: ProvisioningSite): DesiredSetting[] {
  const recordingAllowed = site.measurementTier !== "essentials";
  const held = recordingAllowed && !tierIsConfirmed(site);

  const settings: DesiredSetting[] = [
    {
      field: "cookieless_server_hash_mode",
      label: "Cookieless server hash mode",
      value: COOKIELESS_HASH_MODE_ON,
      held: false,
    },
    { field: "anonymize_ips", label: "Discard client IP data", value: true, held: false },
    { field: "timezone", label: "Timezone", value: site.timezone, held: false },
    {
      field: "app_urls",
      label: "Authorised URLs",
      value: [origin(site.productionUrl)],
      held: false,
    },
    { field: "heatmaps_opt_in", label: "Heatmaps", value: site.usesHeatmaps, held: false },
    {
      field: "session_recording_opt_in",
      label: "Session recording",
      value: recordingAllowed,
      held,
    },
  ];

  if (recordingAllowed) {
    settings.push({
      field: "session_recording_masking_config",
      label: "Recording masks every input",
      value: MASK_ALL_INPUTS,
      held,
    });
  }
  return settings;
}

/** A PostHog insight body, as the insights endpoint takes it. */
export interface DesiredInsight {
  key: string;
  name: string;
  query: Record<string, unknown>;
}

export const DASHBOARD_KEY = "baseline";
export const DASHBOARD_NAME = "Digital Dividend baseline";

export function baselineInsights(taxonomyVersion: number): readonly DashboardInsight[] {
  const dashboards = BASELINE_DASHBOARDS as Readonly<Record<string, readonly DashboardInsight[]>>;
  const insights = dashboards[String(taxonomyVersion)];
  if (!insights) throw new Error(`No baseline dashboard for taxonomy version ${taxonomyVersion}`);
  return insights;
}

export function desiredInsights(taxonomyVersion: number): DesiredInsight[] {
  return baselineInsights(taxonomyVersion).map(insight => ({
    key: insight.key,
    name: insight.title.replaceAll("`", ""),
    query: insightQuery(insight),
  }));
}

const MATH: Record<InsightSeries["math"], string> = {
  total: "total",
  unique_visitors: "dau",
  sum: "sum",
};

function seriesNode(series: InsightSeries, withMath: boolean): Record<string, unknown> {
  const node: Record<string, unknown> = {
    kind: "EventsNode",
    event: series.event,
    name: series.event,
  };
  if (withMath) {
    node["math"] = MATH[series.math];
    if (series.math === "sum" && series.property) node["math_property"] = series.property;
  }
  if (series.where) {
    node["properties"] = Object.entries(series.where).map(([key, value]) => ({
      key,
      value,
      operator: "exact",
      type: "event",
    }));
  }
  return node;
}

function dateRange(insight: DashboardInsight): Record<string, unknown> {
  return { date_from: insight.interval === "month" ? "-12m" : "-90d" };
}

function breakdownFilter(insight: DashboardInsight): Record<string, unknown> | undefined {
  if (!insight.breakdown) return undefined;
  return { breakdown: insight.breakdown.property, breakdown_type: insight.breakdown.scope };
}

export function insightQuery(insight: DashboardInsight): Record<string, unknown> {
  const breakdown = breakdownFilter(insight);
  let source: Record<string, unknown>;

  if (insight.kind === "funnel") {
    source = {
      kind: "FunnelsQuery",
      series: insight.series.map(series => seriesNode(series, false)),
      dateRange: dateRange(insight),
      funnelsFilter: { funnelVizType: "steps", funnelOrderType: "ordered" },
      filterTestAccounts: true,
    };
  } else {
    source = {
      kind: "TrendsQuery",
      series: insight.series.map(series => seriesNode(series, true)),
      interval: insight.interval ?? "week",
      dateRange: dateRange(insight),
      filterTestAccounts: true,
      ...(insight.kind === "ratio"
        ? { trendsFilter: { formula: "A / B * 100", aggregationAxisPostfix: "%" } }
        : {}),
    };
  }

  if (breakdown) source["breakdownFilter"] = breakdown;
  return { kind: "InsightVizNode", source };
}
