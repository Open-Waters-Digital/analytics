import { describe, expect, it } from "vitest";
import { EVENT_LISTS } from "./event-list";
import {
  HEADLINE_METRICS,
  isSnapshotMetric,
  snapshotMetric,
  SNAPSHOT_METRICS,
} from "./snapshot-metrics";

describe("the metric list", () => {
  it("counts every event in every published event list", () => {
    const counted = new Set(
      SNAPSHOT_METRICS.map(metric => metric.event).filter(name => name !== undefined),
    );
    const missing = Object.values(EVENT_LISTS)
      .flatMap(events => events.map(event => event.name))
      .filter(name => !counted.has(name));

    // An event added to the list with no metric here would be tracked on the
    // client's site and invisible in every report.
    expect(missing).toEqual([]);
  });

  it("counts no event that is not on a published list", () => {
    const listed = new Set(
      Object.values(EVENT_LISTS).flatMap(events => events.map(event => event.name)),
    );
    const unknown = SNAPSHOT_METRICS.map(metric => metric.event)
      .filter(name => name !== undefined)
      .filter(name => !listed.has(name));

    expect(unknown).toEqual([]);
  });

  it("has unique names", () => {
    const names = SNAPSHOT_METRICS.map(metric => metric.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("marks the metrics that cannot be summed across days", () => {
    expect(snapshotMetric("daily_visitors")?.dailyOnly).toBe(true);
    expect(snapshotMetric("scroll_75_sessions")?.dailyOnly).toBe(true);
    expect(snapshotMetric("page_views")?.dailyOnly).toBeUndefined();
  });

  it("carries money only where money is expected", () => {
    const money = SNAPSHOT_METRICS.filter(metric => metric.money).map(metric => metric.name);
    expect(money).toEqual(["deal_won"]);
  });

  it("knows its own names and nothing else", () => {
    expect(isSnapshotMetric("page_views")).toBe(true);
    expect(isSnapshotMetric("pageviews")).toBe(false);
  });

  it("only makes headline metrics of breakdown-free metrics", () => {
    for (const name of HEADLINE_METRICS) {
      const metric = snapshotMetric(name);
      expect(metric, name).toBeDefined();
      // A headline metric gets a zero row per day, which has no breakdown value
      // to write, so one with a dimension would be stored under a wrong key.
      expect(metric?.dimension, name).toBeNull();
    }
  });
});
