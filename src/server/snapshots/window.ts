/**
 * Which days a run pulls, in the site's own timezone.
 *
 * Dates are handled as `YYYY-MM-DD` strings and stepped in whole UTC days, so
 * no arithmetic here can land on a clock change. The only timezone-aware step is
 * asking what today's date is where the site's visitors are, which Intl answers.
 */

/** Days re-pulled every night, so late events and a short outage self-correct. */
export const WINDOW_DAYS = 7;
/** Days pulled for a site that has never been pulled. */
export const FIRST_PULL_DAYS = 30;

export interface DayWindow {
  from: string;
  to: string;
  days: string[];
}

export function dayIn(timezone: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(candidate => candidate.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(day: string, amount: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, date! + amount));
  return shifted.toISOString().slice(0, 10);
}

/**
 * The window ends yesterday: today is still happening where the site is, and a
 * partial day stored as a whole one would read as a collapse in traffic.
 */
export function snapshotWindow(now: Date, timezone: string, dayCount: number): DayWindow {
  const to = addDays(dayIn(timezone, now), -1);
  const from = addDays(to, -(dayCount - 1));
  const days: string[] = [];
  for (let offset = 0; offset < dayCount; offset += 1) days.push(addDays(from, offset));
  return { from, to, days };
}
