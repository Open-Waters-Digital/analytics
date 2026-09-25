import { describe, expect, it } from "vitest";
import {
  baselineInsights,
  desiredInsights,
  desiredProject,
  insightQuery,
  type ProvisioningSite,
} from "./desired";

const site: ProvisioningSite = {
  productionUrl: "https://www.example.co.uk/some/path",
  timezone: "Europe/London",
  taxonomyVersion: 3,
  usesHeatmaps: false,
  measurementTier: "essentials",
  tierConfirmedFor: null,
};

const valueOf = (settings: ReturnType<typeof desiredProject>, field: string) =>
  settings.find(setting => setting.field === field);

describe("desiredProject", () => {
  it("sets the contract's baseline for an Essentials site", () => {
    const settings = desiredProject(site);
    expect(valueOf(settings, "cookieless_server_hash_mode")?.value).toBe(2);
    expect(valueOf(settings, "anonymize_ips")?.value).toBe(true);
    expect(valueOf(settings, "timezone")?.value).toBe("Europe/London");
    expect(valueOf(settings, "app_urls")?.value).toEqual(["https://www.example.co.uk"]);
    expect(valueOf(settings, "session_recording_opt_in")?.value).toBe(false);
    expect(valueOf(settings, "session_recording_masking_config")).toBeUndefined();
    expect(settings.every(setting => !setting.held)).toBe(true);
  });

  it("requires heatmaps on only for a site marked as using them", () => {
    expect(valueOf(desiredProject(site), "heatmaps_opt_in")?.value).toBe(false);
    expect(valueOf(desiredProject({ ...site, usesHeatmaps: true }), "heatmaps_opt_in")?.value).toBe(
      true,
    );
  });

  it.each(["insights", "growth"] as const)(
    "holds recording at %s until the tier is confirmed",
    tier => {
      const settings = desiredProject({ ...site, measurementTier: tier });
      expect(valueOf(settings, "session_recording_opt_in")).toMatchObject({
        value: true,
        held: true,
      });
      expect(valueOf(settings, "session_recording_masking_config")).toMatchObject({
        value: { maskAllInputs: true },
        held: true,
      });
      expect(valueOf(settings, "anonymize_ips")?.held).toBe(false);
    },
  );

  it("releases recording once the current tier is confirmed", () => {
    const settings = desiredProject({
      ...site,
      measurementTier: "insights",
      tierConfirmedFor: "insights",
    });
    expect(valueOf(settings, "session_recording_opt_in")).toMatchObject({
      value: true,
      held: false,
    });
  });

  it("keeps recording held when the confirmation was for a different tier", () => {
    const settings = desiredProject({
      ...site,
      measurementTier: "growth",
      tierConfirmedFor: "insights",
    });
    expect(valueOf(settings, "session_recording_opt_in")?.held).toBe(true);
  });
});

describe("desiredInsights", () => {
  it("builds one insight per contract insight, keyed by the contract key", () => {
    for (const version of [2, 3]) {
      const contract = baselineInsights(version);
      const desired = desiredInsights(version);
      expect(desired.map(insight => insight.key)).toEqual(contract.map(insight => insight.key));
    }
  });

  it("adds the v3 insights only at v3", () => {
    const v2 = new Set(desiredInsights(2).map(insight => insight.key));
    const v3only = desiredInsights(3).filter(insight => !v2.has(insight.key));
    expect(v3only.length).toBeGreaterThan(0);
  });

  it("names insights without the contract's code marks", () => {
    expect(desiredInsights(3).every(insight => !insight.name.includes("`"))).toBe(true);
  });

  it("refuses a version the contract does not publish", () => {
    expect(() => desiredInsights(99)).toThrow("No baseline dashboard");
  });
});

describe("insightQuery", () => {
  it("maps unique visitors to PostHog's dau, with a session breakdown", () => {
    const query = insightQuery({
      key: "k",
      stage: "attention",
      title: "t",
      kind: "trend",
      interval: "week",
      series: [{ event: "$pageview", math: "unique_visitors" }],
      breakdown: { property: "$channel_type", scope: "session" },
    });
    expect(query).toMatchObject({
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        interval: "week",
        series: [{ kind: "EventsNode", event: "$pageview", math: "dau" }],
        breakdownFilter: { breakdown: "$channel_type", breakdown_type: "session" },
      },
    });
  });

  it("sums a property and filters a series by its where clause", () => {
    const query = insightQuery({
      key: "k",
      stage: "revenue",
      title: "t",
      kind: "trend",
      interval: "month",
      series: [
        { event: "deal_won", math: "sum", property: "value" },
        { event: "scroll_depth_reached", math: "total", where: { depth_percent: 75 } },
      ],
    }) as { source: { series: Record<string, unknown>[]; dateRange: unknown } };
    expect(query.source.series[0]).toMatchObject({ math: "sum", math_property: "value" });
    expect(query.source.series[1]?.["properties"]).toEqual([
      { key: "depth_percent", value: 75, operator: "exact", type: "event" },
    ]);
    expect(query.source.dateRange).toEqual({ date_from: "-12m" });
  });

  it("turns a ratio into a formula and a funnel into ordered steps", () => {
    const ratio = insightQuery({
      key: "k",
      stage: "intent",
      title: "t",
      kind: "ratio",
      series: [
        { event: "a", math: "total" },
        { event: "b", math: "total" },
      ],
    });
    expect(ratio).toMatchObject({ source: { trendsFilter: { formula: "A / B * 100" } } });

    const funnel = insightQuery({
      key: "k",
      stage: "action",
      title: "t",
      kind: "funnel",
      series: [
        { event: "a", math: "total" },
        { event: "b", math: "total" },
      ],
    }) as { source: { kind: string; series: Record<string, unknown>[] } };
    expect(funnel.source.kind).toBe("FunnelsQuery");
    expect(funnel.source.series.every(step => !("math" in step))).toBe(true);
  });
});
