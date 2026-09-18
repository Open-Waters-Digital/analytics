import { describe, expect, it } from "vitest";
import { addDays, dayIn, snapshotWindow } from "./window";

describe("dayIn", () => {
  it("answers in the site's timezone, not the server's", () => {
    // 23:30 UTC is already the next day in Sydney and still the same day in London.
    const instant = new Date("2026-09-17T23:30:00Z");
    expect(dayIn("Europe/London", instant)).toBe("2026-09-18");
    expect(dayIn("Australia/Sydney", instant)).toBe("2026-09-18");
    expect(dayIn("America/New_York", instant)).toBe("2026-09-17");
  });

  it("uses the offset in force on the day, not a fixed one", () => {
    // British Summer Time: 00:30 UTC is already the 17th in London.
    expect(dayIn("Europe/London", new Date("2026-07-17T00:30:00Z"))).toBe("2026-07-17");
    // Winter: the same instant is the 17th in London too, because the offset is 0.
    expect(dayIn("Europe/London", new Date("2026-01-17T00:30:00Z"))).toBe("2026-01-17");
    // But in summer, 23:30 UTC on the 16th is already the 17th.
    expect(dayIn("Europe/London", new Date("2026-07-16T23:30:00Z"))).toBe("2026-07-17");
  });
});

describe("addDays", () => {
  it("steps over a month and a year end", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("steps over a clock change without losing or repeating a day", () => {
    // The last Sunday in March is when British Summer Time starts.
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    // And the last Sunday in October is when it ends.
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });
});

describe("snapshotWindow", () => {
  it("ends yesterday, because today is still happening", () => {
    const window = snapshotWindow(new Date("2026-09-18T03:20:00Z"), "Europe/London", 7);
    expect(window.to).toBe("2026-09-17");
    expect(window.from).toBe("2026-09-11");
    expect(window.days).toHaveLength(7);
    expect(window.days.at(0)).toBe("2026-09-11");
    expect(window.days.at(-1)).toBe("2026-09-17");
  });

  it("ends yesterday where the site is", () => {
    // 03:20 UTC on the 18th is already 13:20 on the 18th in Sydney, so
    // yesterday there is still the 17th.
    const london = snapshotWindow(new Date("2026-09-18T03:20:00Z"), "Europe/London", 7);
    const sydney = snapshotWindow(new Date("2026-09-18T03:20:00Z"), "Australia/Sydney", 7);
    expect(london.to).toBe("2026-09-17");
    expect(sydney.to).toBe("2026-09-17");

    // At 23:00 UTC they disagree, and each is right for its own site.
    const late = new Date("2026-09-17T23:00:00Z");
    expect(snapshotWindow(late, "Europe/London", 7).to).toBe("2026-09-17");
    expect(snapshotWindow(late, "Australia/Sydney", 7).to).toBe("2026-09-17");
    expect(snapshotWindow(late, "America/Los_Angeles", 7).to).toBe("2026-09-16");
  });

  it("covers thirty days for a first pull", () => {
    const window = snapshotWindow(new Date("2026-09-18T03:20:00Z"), "Europe/London", 30);
    expect(window.days).toHaveLength(30);
    expect(window.from).toBe("2026-08-19");
    expect(window.to).toBe("2026-09-17");
  });

  it("lists every day in the window exactly once, in order", () => {
    const window = snapshotWindow(new Date("2026-04-01T02:00:00Z"), "Europe/London", 7);
    expect(new Set(window.days).size).toBe(window.days.length);
    expect([...window.days].sort()).toEqual(window.days);
  });
});
