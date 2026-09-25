import { describe, expect, it } from "vitest";
import {
  backfillRange,
  chunks,
  cleanPage,
  searchWindow,
  shapeSearchRows,
  topPerDay,
  totalsWithZeros,
  type SearchDailyRow,
} from "./search-shape";

const range = { from: "2026-09-10", to: "2026-09-12" };
const row = (
  day: string,
  value = "",
  clicks = 1,
  impressions = 10,
  position: number | null = 5,
) => ({
  day,
  value,
  clicks,
  impressions,
  position,
});

describe("windows", () => {
  it("pulls the ten days up to yesterday in Pacific Time", () => {
    // 09:00 UTC on the 25th is 02:00 on the 25th in Los Angeles.
    expect(searchWindow(new Date("2026-09-25T09:00:00Z"))).toEqual({
      from: "2026-09-15",
      to: "2026-09-24",
    });
    // 03:20 UTC on the 25th is still the 24th in Los Angeles.
    expect(searchWindow(new Date("2026-09-25T03:20:00Z"))).toEqual({
      from: "2026-09-14",
      to: "2026-09-23",
    });
  });

  it("backfills 16 months before the window, in chunks of at most 90 days", () => {
    const window = { from: "2026-09-15", to: "2026-09-24" };
    const backfill = backfillRange(window);
    expect(backfill.to).toBe("2026-09-14");
    expect(backfill.from).toBe("2025-05-26");
    const parts = chunks(backfill);
    expect(parts[0]?.from).toBe(backfill.from);
    expect(parts.at(-1)?.to).toBe(backfill.to);
    expect(parts.every(part => part.from <= part.to)).toBe(true);
    expect(parts.length).toBe(6);
  });
});

describe("cleanPage", () => {
  it("drops the query string and fragment, which could carry a visitor's details", () => {
    expect(cleanPage("https://example.com/a?email=jane@example.com#top")).toBe(
      "https://example.com/a",
    );
  });

  it("cuts to 200 characters", () => {
    expect(cleanPage(`https://example.com/${"x".repeat(300)}`)).toHaveLength(200);
  });
});

describe("totalsWithZeros", () => {
  it("fills empty days with zeros from the first day with data", () => {
    const totals = totalsWithZeros([row("2026-09-11")], range, null);
    expect(totals.map(total => [total.day, total.clicks])).toEqual([
      ["2026-09-11", 1],
      ["2026-09-12", 0],
    ]);
  });

  it("fills the whole range once coverage began before it", () => {
    expect(totalsWithZeros([], range, "2026-01-01").map(total => total.day)).toEqual([
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
    ]);
  });

  it("writes nothing for an engine that has never had data", () => {
    expect(totalsWithZeros([], range, null)).toEqual([]);
  });

  it("stores position weighted by impressions, so averages come out right", () => {
    const rows = [row("2026-09-10", "", 0, 100, 2), row("2026-09-11", "", 0, 300, 6)];
    const totals = totalsWithZeros(rows, range, null);
    const impressions = totals.reduce((sum, total) => sum + total.impressions, 0);
    const positionSum = totals.reduce((sum, total) => sum + total.positionSum, 0);
    expect(positionSum / impressions).toBe(5);
  });
});

describe("topPerDay", () => {
  it("keeps each day's top rows by impressions, then clicks", () => {
    const rows: SearchDailyRow[] = [
      { day: "d1", breakdown: "query", value: "a", clicks: 1, impressions: 5, positionSum: 0 },
      { day: "d1", breakdown: "query", value: "b", clicks: 9, impressions: 50, positionSum: 0 },
      { day: "d1", breakdown: "query", value: "c", clicks: 3, impressions: 50, positionSum: 0 },
      { day: "d2", breakdown: "query", value: "a", clicks: 0, impressions: 1, positionSum: 0 },
    ];
    expect(topPerDay(rows, 2).map(kept => `${kept.day}:${kept.value}`)).toEqual([
      "d1:b",
      "d1:c",
      "d2:a",
    ]);
  });
});

describe("shapeSearchRows", () => {
  it("merges a page seen with and without a query string, and drops rows outside the range", () => {
    const rows = shapeSearchRows({
      range,
      coverageStart: null,
      totals: [row("2026-09-10")],
      devices: [row("2026-09-10", "MOBILE")],
      queries: [row("2026-09-10", "garden design kent"), row("2026-08-01", "old")],
      pages: [
        row("2026-09-10", "https://example.com/a?utm_source=x", 1, 10, 2),
        row("2026-09-10", "https://example.com/a", 2, 30, 4),
      ],
    });
    const pages = rows.filter(shaped => shaped.breakdown === "page");
    expect(pages).toEqual([
      {
        day: "2026-09-10",
        breakdown: "page",
        value: "https://example.com/a",
        clicks: 3,
        impressions: 40,
        positionSum: 2 * 10 + 4 * 30,
      },
    ]);
    expect(rows.some(shaped => shaped.value === "old")).toBe(false);
    expect(rows.filter(shaped => shaped.breakdown === "device")).toHaveLength(1);
  });

  it("stores a row with no position as a zero position sum", () => {
    const rows = shapeSearchRows({
      range,
      coverageStart: null,
      totals: [row("2026-09-10", "", 4, 90, null)],
      devices: [],
      queries: [],
      pages: [],
    });
    expect(rows[0]).toMatchObject({ clicks: 4, impressions: 90, positionSum: 0 });
  });
});
