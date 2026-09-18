import { describe, expect, it } from "vitest";
import { MAX_DIMENSION_LENGTH, SNAPSHOT_METRICS } from "@/lib/snapshot-metrics";
import {
  buildSnapshotQueries,
  literalDate,
  literalTimezone,
  MAX_DIMENSION_ROWS,
  MixedCurrencyError,
  normaliseRows,
  parseQueryRows,
  UnreadableResponseError,
  type MetricRow,
} from "./posthog-queries";

const window = { from: "2026-09-11", to: "2026-09-17", timezone: "Europe/London" };

function row(overrides: Partial<MetricRow> = {}): MetricRow {
  return {
    day: "2026-09-17",
    metric: "cta_clicked",
    dimension: "book-a-call",
    value: 3,
    valueMinor: null,
    currency: null,
    ...overrides,
  };
}

describe("literals", () => {
  it("accepts an ISO date and nothing else", () => {
    expect(literalDate("2026-09-17")).toBe("'2026-09-17'");
    expect(() => literalDate("2026-9-17")).toThrow(TypeError);
    expect(() => literalDate("2026-09-17' OR 1=1 --")).toThrow(TypeError);
    expect(() => literalDate("")).toThrow(TypeError);
  });

  it("accepts an IANA timezone and nothing else", () => {
    expect(literalTimezone("Europe/London")).toBe("'Europe/London'");
    expect(literalTimezone("Australia/Sydney")).toBe("'Australia/Sydney'");
    expect(() => literalTimezone("BST")).toThrow(TypeError);
    expect(() => literalTimezone("Europe/London'; DROP TABLE events; --")).toThrow(TypeError);
  });
});

describe("buildSnapshotQueries", () => {
  const queries = buildSnapshotQueries(window);

  it("builds one query per group, each bounded by the window", () => {
    expect(queries.map(query => query.group)).toEqual([
      "traffic",
      "pages",
      "sessions",
      "intent",
      "action",
      "revenue",
    ]);
    for (const { group, query } of queries) {
      expect(query, group).toContain("'2026-09-11'");
      expect(query, group).toContain("'2026-09-17'");
      expect(query, group).toContain("'Europe/London'");
      // A coarse bound as well, so ClickHouse can skip old partitions.
      expect(query, group).toContain("INTERVAL 45 DAY");
      expect(query, group).toContain("LIMIT 20000");
    }
  });

  it("covers every metric on the list", () => {
    const sql = queries.map(query => query.query).join("\n");
    for (const metric of SNAPSHOT_METRICS) {
      expect(sql, metric.name).toContain(`'${metric.name}' AS metric`);
    }
  });

  it("selects the same six columns in every branch", () => {
    for (const { group, query } of queries) {
      const branches = query.split("UNION ALL");
      for (const branch of branches) {
        expect(branch, group).toContain("AS day");
        expect(branch, group).toContain("AS metric");
        expect(branch, group).toContain("AS dimension");
        expect(branch, group).toContain("AS value");
        expect(branch, group).toContain("AS value_minor");
        expect(branch, group).toContain("AS currency");
      }
    }
  });

  it("reads sessions from the sessions table, by the day the session started", () => {
    const sessions = queries.find(query => query.group === "sessions")!.query;
    expect(sessions).toContain("FROM sessions");
    expect(sessions).toContain("`$start_timestamp`");
    expect(sessions).toContain("`$channel_type`");
    expect(sessions).toContain("`$entry_pathname`");
  });

  it("asks for aggregates only: nothing about a visitor is selected or grouped", () => {
    for (const { group, query } of queries) {
      // uniq(distinct_id) is a count; selecting the column itself, or grouping
      // by it, would bring visitor-level rows back instead.
      const dimensions = query
        .split("\n")
        .filter(line => line.trim().endsWith("AS dimension,"))
        .join("\n");
      for (const forbidden of ["distinct_id", "$session_id", "$ip", "person.", "$current_url"]) {
        expect(dimensions, `${group} dimension: ${forbidden}`).not.toContain(forbidden);
      }
      expect(query, group).not.toContain("person.");
      expect(query, group).not.toContain("$ip");
    }
  });

  it("refuses a timezone it cannot verify", () => {
    expect(() => buildSnapshotQueries({ ...window, timezone: "Mars/Olympus" })).toThrow(TypeError);
  });
});

describe("parseQueryRows", () => {
  const body = (results: unknown[]) => ({ results, columns: [], types: [] });

  it("reads the six columns in order", () => {
    const rows = parseQueryRows(body([["2026-09-17", "page_views", "", 42, 0, ""]]));
    expect(rows).toEqual([
      {
        day: "2026-09-17",
        metric: "page_views",
        dimension: "",
        value: 42,
        valueMinor: null,
        currency: null,
      },
    ]);
  });

  it("accepts a count that arrives as a string", () => {
    const rows = parseQueryRows(body([["2026-09-17", "sessions", "", "17", "0", ""]]));
    expect(rows[0]?.value).toBe(17);
  });

  it("keeps money only with a currency this app stores", () => {
    const [gbp, chf] = parseQueryRows(
      body([
        ["2026-09-17", "deal_won", "partner", 1, 250000, "GBP"],
        ["2026-09-17", "deal_won", "partner", 1, 250000, "CHF"],
      ]),
    );
    expect(gbp).toMatchObject({ valueMinor: 250000, currency: "GBP" });
    // The count survives; the value does not, because it cannot be stored.
    expect(chf).toMatchObject({ value: 1, valueMinor: null, currency: null });
  });

  it.each([
    ["not an object", "nope"],
    ["no results", { columns: [] }],
    ["a row of the wrong width", { results: [["2026-09-17", "page_views", "", 1]] }],
    ["a day that is not a date", { results: [["yesterday", "page_views", "", 1, 0, ""]] }],
    [
      "a value that is not a number",
      { results: [["2026-09-17", "page_views", "", "lots", 0, ""]] },
    ],
    ["an object row", { results: [{ day: "2026-09-17" }] }],
  ])("refuses %s rather than coercing it", (_label, input) => {
    expect(() => parseQueryRows(input)).toThrow(UnreadableResponseError);
  });
});

describe("normaliseRows", () => {
  it("drops a metric it does not know", () => {
    expect(normaliseRows([row({ metric: "surprise_metric" })])).toEqual([]);
  });

  it("blanks the breakdown of a metric that has none", () => {
    const [normalised] = normaliseRows([row({ metric: "page_views", dimension: "anything" })]);
    expect(normalised?.dimension).toBe("");
  });

  it("stores a landing page as a path, without the query string", () => {
    const [normalised] = normaliseRows([
      row({ metric: "landing_page_views", dimension: "/pricing?email=someone@example.com#top" }),
    ]);
    expect(normalised?.dimension).toBe("/pricing");
  });

  it("stores a landing page given as a whole address as a path", () => {
    const [normalised] = normaliseRows([
      row({ metric: "landing_page_views", dimension: "https://example.com/work/radara?utm=x" }),
    ]);
    expect(normalised?.dimension).toBe("/work/radara");
  });

  it("truncates a long breakdown value and adds up what then collides", () => {
    const long = "/blog/".concat("a".repeat(MAX_DIMENSION_LENGTH));
    const rows = normaliseRows([
      row({ metric: "landing_page_views", dimension: `${long}-one`, value: 2 }),
      row({ metric: "landing_page_views", dimension: `${long}-two`, value: 3 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dimension.length).toBe(MAX_DIMENSION_LENGTH);
    // Adding them up loses the split but keeps the day's total honest.
    expect(rows[0]?.value).toBe(5);
  });

  it("keeps the largest values only when a breakdown is too wide", () => {
    const rows = normaliseRows(
      Array.from({ length: MAX_DIMENSION_ROWS + 10 }, (_unused, index) =>
        row({ dimension: `cta-${index}`, value: index }),
      ),
    );
    expect(rows).toHaveLength(MAX_DIMENSION_ROWS);
    expect(rows.map(kept => kept.value).sort((a, b) => a - b)[0]).toBe(10);
  });

  it("applies the cap per metric per day, not across the window", () => {
    const rows = normaliseRows([
      ...Array.from({ length: MAX_DIMENSION_ROWS }, (_unused, index) =>
        row({ day: "2026-09-16", dimension: `cta-${index}`, value: index + 1 }),
      ),
      ...Array.from({ length: MAX_DIMENSION_ROWS }, (_unused, index) =>
        row({ day: "2026-09-17", dimension: `cta-${index}`, value: index + 1 }),
      ),
    ]);
    expect(rows).toHaveLength(MAX_DIMENSION_ROWS * 2);
  });

  it("refuses to add up two currencies for one day", () => {
    expect(() =>
      normaliseRows([
        row({ metric: "deal_won", dimension: "partner", valueMinor: 1000, currency: "GBP" }),
        row({ metric: "deal_won", dimension: "partner", valueMinor: 1000, currency: "EUR" }),
      ]),
    ).toThrow(MixedCurrencyError);
  });

  it("adds up money in one currency", () => {
    const [normalised] = normaliseRows([
      row({
        metric: "deal_won",
        dimension: "partner",
        value: 1,
        valueMinor: 1000,
        currency: "GBP",
      }),
      row({
        metric: "deal_won",
        dimension: "partner",
        value: 2,
        valueMinor: 2500,
        currency: "GBP",
      }),
    ]);
    expect(normalised).toMatchObject({ value: 3, valueMinor: 3500, currency: "GBP" });
  });
});
