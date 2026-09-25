import { addDays, dayIn } from "./window";

/**
 * Turning what Google and Bing return into site_search_daily rows
 * (add-search-console, design D4, D5, D5a). Pure, so every rule is unit tested
 * without either engine.
 */

/** Google reports every day in Pacific Time; it cannot be converted. */
export const GOOGLE_TIMEZONE = "America/Los_Angeles";
/** Days re-pulled every night, because both engines revise recent figures. */
export const SEARCH_WINDOW_DAYS = 10;
/** How far back a replacement site's first pull reaches: Google keeps 16 months. */
export const BACKFILL_DAYS = 486;
/** Longest span asked for in one call, so no single call runs long. */
export const CHUNK_DAYS = 90;
/** Queries and pages kept per day, by impressions. */
export const TOP_PER_DAY = 1_000;
export const VALUE_LIMIT = 200;

export type Breakdown = "total" | "device" | "query" | "page";

export interface SearchDailyRow {
  day: string;
  breakdown: Breakdown;
  value: string;
  clicks: number;
  impressions: number;
  positionSum: number;
}

export interface DayRange {
  from: string;
  to: string;
}

/** The window every run pulls: the ten days up to yesterday, in the engine's day. */
export function searchWindow(now: Date, timezone: string = GOOGLE_TIMEZONE): DayRange {
  const to = addDays(dayIn(timezone, now), -1);
  return { from: addDays(to, -(SEARCH_WINDOW_DAYS - 1)), to };
}

/** A backfill's range: from 16 months before the window to the day before it. */
export function backfillRange(window: DayRange): DayRange {
  return { from: addDays(window.to, -BACKFILL_DAYS), to: addDays(window.from, -1) };
}

/** A range cut into chunks of at most `CHUNK_DAYS`, oldest first. */
export function chunks(range: DayRange, size: number = CHUNK_DAYS): DayRange[] {
  const out: DayRange[] = [];
  for (let from = range.from; from <= range.to; from = addDays(from, size)) {
    const to = addDays(from, size - 1);
    out.push({ from, to: to < range.to ? to : range.to });
  }
  return out;
}

export function daysIn(range: DayRange): string[] {
  const out: string[] = [];
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) out.push(day);
  return out;
}

/**
 * A page address as stored: no query string or fragment, which could carry a
 * visitor's details, cut to the column's limit.
 */
export function cleanPage(address: string): string {
  let cleaned = address;
  try {
    const url = new URL(address);
    url.search = "";
    url.hash = "";
    cleaned = url.toString();
  } catch {
    cleaned = address.split(/[?#]/)[0] ?? "";
  }
  return cleaned.slice(0, VALUE_LIMIT);
}

export interface EngineRow {
  day: string;
  value: string;
  clicks: number;
  impressions: number;
  /** The engine's average position for the row, or null where it gives none. */
  position: number | null;
}

/**
 * Sums rows sharing a day and value (a page with and without a query string
 * becomes one), keeping position weighted by impressions.
 */
function merge(breakdown: Breakdown, rows: EngineRow[]): SearchDailyRow[] {
  const byKey = new Map<string, SearchDailyRow>();
  for (const row of rows) {
    const value = breakdown === "page" ? cleanPage(row.value) : row.value.slice(0, VALUE_LIMIT);
    const key = `${row.day}\u0000${value}`;
    const positionSum = row.position === null ? 0 : row.position * row.impressions;
    const existing = byKey.get(key);
    if (existing) {
      existing.clicks += row.clicks;
      existing.impressions += row.impressions;
      existing.positionSum += positionSum;
    } else {
      byKey.set(key, {
        day: row.day,
        breakdown,
        value,
        clicks: row.clicks,
        impressions: row.impressions,
        positionSum,
      });
    }
  }
  return [...byKey.values()];
}

/** Each day's top rows by impressions, then clicks. */
export function topPerDay(rows: SearchDailyRow[], limit: number = TOP_PER_DAY): SearchDailyRow[] {
  const byDay = new Map<string, SearchDailyRow[]>();
  for (const row of rows) byDay.set(row.day, [...(byDay.get(row.day) ?? []), row]);
  const out: SearchDailyRow[] = [];
  for (const dayRows of byDay.values()) {
    dayRows.sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks);
    out.push(...dayRows.slice(0, limit));
  }
  return out;
}

/**
 * Totals for each day of the range. A day with no data is a zero only from the
 * first day the engine has any data for (`coverageStart`), so an engine the old
 * site never used does not show a cliff of clicks that never happened.
 */
export function totalsWithZeros(
  rows: EngineRow[],
  range: DayRange,
  coverageStart: string | null,
): SearchDailyRow[] {
  const merged = merge(
    "total",
    rows.map(row => ({ ...row, value: "" })),
  );
  const byDay = new Map(merged.map(row => [row.day, row]));
  const firstReturned = merged.map(row => row.day).sort()[0] ?? null;
  const start = [coverageStart, firstReturned]
    .filter((day): day is string => day !== null)
    .sort()[0];
  if (!start) return [];
  return daysIn(range)
    .filter(day => day >= start)
    .map(
      day =>
        byDay.get(day) ?? {
          day,
          breakdown: "total",
          value: "",
          clicks: 0,
          impressions: 0,
          positionSum: 0,
        },
    );
}

/** Everything for one engine's pull over a range, ready to write. */
export function shapeSearchRows(input: {
  range: DayRange;
  coverageStart: string | null;
  totals: EngineRow[];
  devices: EngineRow[];
  queries: EngineRow[];
  pages: EngineRow[];
}): SearchDailyRow[] {
  const inRange = (row: EngineRow) => row.day >= input.range.from && row.day <= input.range.to;
  return [
    ...totalsWithZeros(input.totals.filter(inRange), input.range, input.coverageStart),
    ...merge("device", input.devices.filter(inRange)),
    ...topPerDay(merge("query", input.queries.filter(inRange))),
    ...topPerDay(merge("page", input.pages.filter(inRange))),
  ];
}
