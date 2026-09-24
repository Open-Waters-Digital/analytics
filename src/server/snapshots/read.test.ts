import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import { clients, siteDailyMetrics, siteSnapshotResults, sites, snapshotRuns } from "@/db/schema";
import { testSession } from "@/test/mock-session";
import { UnauthorisedError } from "@/server/session-policy";
import { getLastSnapshotRun, getSiteSnapshots, isStale, RECENT_DAYS } from "./read";

vi.mock("@/server/session", () => import("@/test/mock-session"));

afterEach(() => {
  testSession.signedIn = true;
});

function isoDay(offset: number): string {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}

async function newSite(): Promise<string> {
  const db = getDb();
  const slug = `read-${randomBytes(4).toString("hex")}`;
  const [client] = await db
    .insert(clients)
    .values({ slug, name: `Read ${slug}`, analyticsOwnership: "open_waters" })
    .returning({ id: clients.id });
  const [site] = await db
    .insert(sites)
    .values({
      clientId: client!.id,
      productionUrl: `https://${slug}.example.com`,
      framework: "next",
      taxonomyVersion: 1,
      timezone: "Europe/London",
    })
    .returning({ id: sites.id });
  return site!.id;
}

describe("the session gate", () => {
  it("refuses every read without a session", async () => {
    testSession.signedIn = false;
    await expect(getLastSnapshotRun()).rejects.toThrow(UnauthorisedError);
    await expect(getSiteSnapshots([randomUUID()])).rejects.toThrow(UnauthorisedError);
  });
});

describe("getLastSnapshotRun", () => {
  it("returns the most recent run", async () => {
    const db = getDb();
    await db.insert(snapshotRuns).values([
      { startedAt: new Date("2026-09-17T03:20:00Z"), finishedAt: new Date("2026-09-17T03:21:00Z") },
      { startedAt: new Date("2026-09-18T03:20:00Z"), finishedAt: new Date("2026-09-18T03:22:00Z") },
    ]);

    const run = await getLastSnapshotRun();
    expect(run?.startedAt).toEqual(new Date("2026-09-18T03:20:00Z"));
  });
});

describe("isStale", () => {
  const now = new Date("2026-09-18T09:00:00Z");

  it("is stale when the job has never run", () => {
    expect(isStale(null, now)).toBe(true);
  });

  it("is stale when the last run never finished", () => {
    const run = {
      startedAt: new Date("2026-09-18T03:20:00Z"),
      finishedAt: null,
      sitesOk: 0,
      sitesFailed: 0,
      sitesSkipped: 0,
    };
    expect(isStale(run, now)).toBe(true);
  });

  it("is fresh within forty-eight hours and stale after", () => {
    const run = (finishedAt: string) => ({
      startedAt: new Date(finishedAt),
      finishedAt: new Date(finishedAt),
      sitesOk: 1,
      sitesFailed: 0,
      sitesSkipped: 0,
    });
    // Last night's run, and the night before: two quiet nights is not a fault.
    expect(isStale(run("2026-09-18T03:20:00Z"), now)).toBe(false);
    expect(isStale(run("2026-09-17T03:20:00Z"), now)).toBe(false);
    expect(isStale(run("2026-09-16T10:00:00Z"), now)).toBe(false);
    // Two nights missed entirely.
    expect(isStale(run("2026-09-16T03:20:00Z"), now)).toBe(true);
    expect(isStale(run("2026-09-15T03:20:00Z"), now)).toBe(true);
  });
});

describe("getSiteSnapshots", () => {
  it("says nothing was pulled for a site that never was", async () => {
    const siteId = await newSite();
    const snapshots = await getSiteSnapshots([siteId]);
    expect(snapshots.get(siteId)).toEqual({ lastResult: null, days: [], breakdowns: [] });
  });

  it("returns an entry for every site asked for, and nothing else", async () => {
    const [first, second] = [await newSite(), await newSite()];
    const snapshots = await getSiteSnapshots([first, second]);
    expect([...snapshots.keys()].sort()).toEqual([first, second].sort());
  });

  it("returns an empty map for no sites, without querying", async () => {
    expect(await getSiteSnapshots([])).toEqual(new Map());
  });

  it("sums each breakdown over the recent days, largest first, leaving out empty ones", async () => {
    const siteId = await newSite();
    const old = isoDay(-(RECENT_DAYS + 3));
    await getDb()
      .insert(siteDailyMetrics)
      .values([
        { siteId, day: isoDay(-1), metric: "leads_by_channel", dimension: "paid_social", value: 2 },
        { siteId, day: isoDay(-2), metric: "leads_by_channel", dimension: "paid_social", value: 1 },
        { siteId, day: isoDay(-2), metric: "leads_by_channel", dimension: "unknown", value: 1 },
        { siteId, day: isoDay(-1), metric: "leads_by_channel", dimension: "referral", value: 0 },
        // Older than the window: not counted.
        { siteId, day: old, metric: "leads_by_channel", dimension: "email", value: 9 },
        {
          siteId,
          day: isoDay(-1),
          metric: "page_views_by_ad_consent",
          dimension: "unset",
          value: 70,
        },
      ]);

    const snapshot = (await getSiteSnapshots([siteId])).get(siteId);
    expect(snapshot?.breakdowns).toEqual([
      {
        metric: "leads_by_channel",
        values: [
          { dimension: "paid_social", value: 3 },
          { dimension: "unknown", value: 1 },
        ],
      },
      { metric: "page_views_by_ad_consent", values: [{ dimension: "unset", value: 70 }] },
    ]);
  });

  it("reads the headline numbers, newest day first", async () => {
    const siteId = await newSite();
    await getDb()
      .insert(siteDailyMetrics)
      .values([
        { siteId, day: isoDay(-1), metric: "page_views", dimension: "", value: 40 },
        { siteId, day: isoDay(-1), metric: "sessions", dimension: "", value: 25 },
        { siteId, day: isoDay(-1), metric: "lead_submitted", dimension: "partner", value: 1 },
        { siteId, day: isoDay(-1), metric: "lead_submitted", dimension: "subscribe", value: 2 },
        { siteId, day: isoDay(-2), metric: "page_views", dimension: "", value: 10 },
      ]);

    const snapshot = (await getSiteSnapshots([siteId])).get(siteId);
    expect(snapshot?.days.map(day => day.day)).toEqual([isoDay(-1), isoDay(-2)]);
    expect(snapshot?.days[0]).toEqual({
      day: isoDay(-1),
      pageViews: 40,
      sessions: 25,
      // Leads are added up across their breakdown: the panel shows one number.
      leads: 3,
    });
    expect(snapshot?.days[1]).toEqual({
      day: isoDay(-2),
      pageViews: 10,
      sessions: 0,
      leads: 0,
    });
  });

  it("shows at most a week, even when more has been stored", async () => {
    const siteId = await newSite();
    await getDb()
      .insert(siteDailyMetrics)
      .values(
        Array.from({ length: 20 }, (_unused, index) => ({
          siteId,
          day: isoDay(-(index + 1)),
          metric: "page_views",
          dimension: "",
          value: index,
        })),
      );

    const snapshot = (await getSiteSnapshots([siteId])).get(siteId);
    expect(snapshot?.days).toHaveLength(RECENT_DAYS);
    expect(snapshot?.days[0]?.day).toBe(isoDay(-1));
  });

  it("reads the latest result for a site, not an older one", async () => {
    const siteId = await newSite();
    const db = getDb();
    const [older] = await db
      .insert(snapshotRuns)
      .values({ startedAt: new Date("2026-09-16T03:20:00Z") })
      .returning({ id: snapshotRuns.id });
    const [newer] = await db
      .insert(snapshotRuns)
      .values({ startedAt: new Date("2026-09-17T03:20:00Z") })
      .returning({ id: snapshotRuns.id });

    await db.insert(siteSnapshotResults).values({
      runId: older!.id,
      siteId,
      outcome: "failed",
      reason: "An older failure",
      createdAt: new Date("2026-09-16T03:21:00Z"),
    });
    await db.insert(siteSnapshotResults).values({
      runId: newer!.id,
      siteId,
      outcome: "ok",
      reason: null,
      daysWritten: 7,
      createdAt: new Date("2026-09-17T03:21:00Z"),
    });

    const snapshot = (await getSiteSnapshots([siteId])).get(siteId);
    expect(snapshot?.lastResult).toMatchObject({ outcome: "ok", daysWritten: 7 });
  });
});
