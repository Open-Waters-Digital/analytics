import { describe, expect, it } from "vitest";
import { desiredInsights, desiredProject, type ProvisioningSite } from "./desired";
import {
  filterDifference,
  insightDifferences,
  isSubset,
  matchObject,
  settingDifferences,
  toApply,
} from "./diff";

const site: ProvisioningSite = {
  productionUrl: "https://www.example.co.uk",
  timezone: "Europe/London",
  taxonomyVersion: 3,
  usesHeatmaps: false,
  measurementTier: "essentials",
  tierConfirmedFor: null,
};

// PostHog's defaults for a new project, as read from Open Waters' on 25 September 2026.
const freshProject = {
  cookieless_server_hash_mode: 0,
  anonymize_ips: false,
  timezone: "UTC",
  app_urls: [],
  heatmaps_opt_in: false,
  session_recording_opt_in: true,
  session_recording_masking_config: null,
};

const matchedProject = {
  cookieless_server_hash_mode: 2,
  anonymize_ips: true,
  timezone: "Europe/London",
  app_urls: ["https://www.example.co.uk"],
  heatmaps_opt_in: false,
  session_recording_opt_in: false,
  session_recording_masking_config: null,
};

describe("settingDifferences", () => {
  it("lists every contract setting on a fresh project", () => {
    const fields = settingDifferences(freshProject, desiredProject(site)).map(d => d.field);
    expect(fields).toEqual([
      "cookieless_server_hash_mode",
      "anonymize_ips",
      "timezone",
      "app_urls",
      "session_recording_opt_in",
    ]);
  });

  it("finds nothing on a project that already matches", () => {
    expect(settingDifferences(matchedProject, desiredProject(site))).toEqual([]);
  });

  it("does not count authorised URLs in another order or with a path", () => {
    const project = {
      ...matchedProject,
      app_urls: ["https://www.example.co.uk/"],
    };
    expect(settingDifferences(project, desiredProject(site))).toEqual([]);
  });

  it("reports held recording but leaves it out of what apply sends", () => {
    const differences = settingDifferences(
      matchedProject,
      desiredProject({ ...site, measurementTier: "insights" }),
    );
    expect(differences.map(d => [d.field, d.held])).toEqual([
      ["session_recording_opt_in", true],
      ["session_recording_masking_config", true],
    ]);
    expect(toApply(differences)).toEqual([]);
  });

  it("accepts a masking config carrying more than the contract asks for", () => {
    const project = {
      ...matchedProject,
      session_recording_opt_in: true,
      session_recording_masking_config: { maskAllInputs: true, maskTextSelector: "*" },
    };
    const confirmed = desiredProject({
      ...site,
      measurementTier: "insights",
      tierConfirmedFor: "insights",
    });
    expect(settingDifferences(project, confirmed)).toEqual([]);
  });
});

describe("filterDifference", () => {
  it("flags a filter that excludes the production host, and keeps the rest", () => {
    const localhost = {
      key: "$host",
      type: "event",
      operator: "is_not",
      value: ["localhost:3000"],
    };
    const production = {
      key: "$host",
      type: "event",
      operator: "is_not",
      value: ["www.example.co.uk"],
    };
    const difference = filterDifference([localhost, production], site.productionUrl);
    expect(difference).toEqual({ type: "filter", remaining: [localhost], removed: 1 });
  });

  it("flags a filter that keeps only another host", () => {
    const onlyLocal = { key: "$host", type: "event", operator: "exact", value: ["localhost"] };
    expect(filterDifference([onlyLocal], site.productionUrl)?.removed).toBe(1);
  });

  it("never flags PostHog's default cohort filter", () => {
    const cohort = { key: "id", type: "cohort", value: 243848, operator: "not_in" };
    expect(filterDifference([cohort], site.productionUrl)).toBeNull();
  });

  it("leaves conditions on other properties and unknown operators alone", () => {
    const other = { key: "$browser", type: "event", operator: "exact", value: ["Chrome"] };
    const unknown = { key: "$host", type: "event", operator: "gt", value: ["x"] };
    expect(filterDifference([other, unknown], site.productionUrl)).toBeNull();
  });
});

describe("matchObject", () => {
  const objects = [
    { id: 10, description: "ow:attention.a" },
    { id: 11, description: "Something a partner wrote\now:attention.b" },
    { id: 12, description: "ow:attention.c", deleted: true },
  ];

  it("prefers the recorded id", () => {
    expect(
      matchObject("attention.a", [{ contractKey: "attention.a", posthogId: 11 }], objects),
    ).toEqual({
      object: objects[1],
      adopted: false,
    });
  });

  it("adopts an object by its description marker when there is no record", () => {
    expect(matchObject("attention.b", [], objects)).toEqual({ object: objects[1], adopted: true });
  });

  it("falls back to the marker when the recorded object is gone", () => {
    const result = matchObject(
      "attention.a",
      [{ contractKey: "attention.a", posthogId: 99 }],
      objects,
    );
    expect(result).toEqual({ object: objects[0], adopted: true });
  });

  it("never matches a deleted object", () => {
    expect(
      matchObject("attention.c", [{ contractKey: "attention.c", posthogId: 12 }], objects),
    ).toEqual({
      object: null,
      adopted: false,
    });
  });
});

describe("insightDifferences", () => {
  const desired = desiredInsights(3);
  const first = desired[0];
  if (!first) throw new Error("the v3 dashboard has no insights");

  it("lists every insight as missing on a fresh project", () => {
    const differences = insightDifferences(desired, [], [], null);
    expect(differences).toHaveLength(desired.length);
    expect(differences.every(d => d.change === "missing")).toBe(true);
  });

  it("ignores PostHog's added defaults, and a partner's own insight", () => {
    const withDefaults = {
      ...first.query,
      source: {
        ...(first.query["source"] as Record<string, unknown>),
        version: 4,
        properties: [],
      },
    };
    const insights = [
      { id: 1, description: `ow:${first.key}`, dashboards: [7], query: withDefaults },
      { id: 2, description: "mine", dashboards: [7], query: { kind: "InsightVizNode" } },
    ];
    const differences = insightDifferences([first], [], insights, 7);
    expect(differences).toEqual([]);
  });

  it("reports an insight whose query drifted as changed", () => {
    const drifted = { ...first.query, source: { kind: "TrendsQuery", series: [] } };
    const insights = [{ id: 1, description: `ow:${first.key}`, dashboards: [7], query: drifted }];
    expect(insightDifferences([first], [], insights, 7)).toEqual([
      { type: "insight", key: first.key, name: first.name, change: "changed", posthogId: 1 },
    ]);
  });

  it("reports an insight missing from the dashboard", () => {
    const insights = [
      { id: 1, description: `ow:${first.key}`, dashboards: [], query: first.query },
    ];
    expect(insightDifferences([first], [], insights, 7)[0]?.change).toBe("not_on_dashboard");
  });

  it("reports a recorded insight deleted in PostHog as missing", () => {
    const insights = [{ id: 1, description: "", deleted: true, query: first.query }];
    const recorded = [{ contractKey: first.key, posthogId: 1 }];
    expect(insightDifferences([first], recorded, insights, 7)[0]?.change).toBe("missing");
  });
});

describe("isSubset", () => {
  it.each([
    [1, 1, true],
    [{ a: 1 }, { a: 1, b: 2 }, true],
    [{ a: 1, b: 2 }, { a: 1 }, false],
    [[1, 2], [1, 2], true],
    [[1], [1, 2], false],
    [{ a: [{ b: 1 }] }, { a: [{ b: 1, c: 3 }] }, true],
    [null, null, true],
    [{ a: 1 }, null, false],
  ])("isSubset(%j, %j) is %s", (required, actual, expected) => {
    expect(isSubset(required, actual)).toBe(expected);
  });
});
