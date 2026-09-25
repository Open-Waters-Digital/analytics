import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import {
  bingWebmasterSites,
  clients,
  searchConsoleProperties,
  siteDailyMetrics,
  siteSearchDaily,
  sites,
} from "@/db/schema";
import { testSession } from "@/test/mock-session";
import { getSearchReport, isBranded } from "./search-read";

vi.mock("@/server/session", () => import("@/test/mock-session"));

const hex = () => randomBytes(4).toString("hex");
// The report's 28 days end on 22 September in Pacific Time.
const NOW = new Date("2026-09-23T10:00:00Z");

async function newSite(brandTerms: string[] = []) {
  const db = getDb();
  const [client] = await db
    .insert(clients)
    .values({ slug: `sr-${hex()}`, name: "Search report", analyticsOwnership: "open_waters" })
    .returning({ id: clients.id });
  const [site] = await db
    .insert(sites)
    .values({
      clientId: client!.id,
      productionUrl: `https://${hex()}.example.com`,
      framework: "next",
      taxonomyVersion: 3,
      timezone: "Europe/London",
      brandTerms,
    })
    .returning({ id: sites.id });
  await db
    .insert(searchConsoleProperties)
    .values({ siteId: site!.id, property: "sc-domain:example.com" });
  await db.insert(bingWebmasterSites).values({ siteId: site!.id, siteUrl: "https://example.com/" });
  return site!.id;
}

type Row = {
  engine: "google" | "bing";
  day: string;
  breakdown: "total" | "device" | "query" | "page";
  value?: string;
  clicks: number;
  impressions: number;
  positionSum?: number;
};

async function insert(siteId: string, rows: Row[]) {
  await getDb()
    .insert(siteSearchDaily)
    .values(rows.map(row => ({ siteId, value: "", positionSum: 0, ...row })));
}

beforeEach(() => {
  testSession.signedIn = true;
});

describe("getSearchReport", () => {
  it("weights position by impressions, and leaves Bing's position unreported", async () => {
    const siteId = await newSite();
    await insert(siteId, [
      {
        engine: "google",
        day: "2026-09-10",
        breakdown: "total",
        clicks: 5,
        impressions: 100,
        positionSum: 200,
      },
      {
        engine: "google",
        day: "2026-09-11",
        breakdown: "total",
        clicks: 15,
        impressions: 300,
        positionSum: 1800,
      },
      { engine: "bing", day: "2026-09-10", breakdown: "total", clicks: 2, impressions: 50 },
    ]);
    const report = await getSearchReport(siteId, NOW);
    expect(report.google?.current).toEqual({
      clicks: 20,
      impressions: 400,
      ctr: 0.05,
      position: 5,
    });
    expect(report.bing?.current.position).toBeNull();
    expect(report.combined.current).toMatchObject({ clicks: 22, impressions: 450, position: 5 });
    expect(report.google?.historyBegins).toBe("2026-09-10");
  });

  it("labels the branded split with the share of clicks it covers", async () => {
    const siteId = await newSite(["luxury gardens"]);
    await insert(siteId, [
      { engine: "google", day: "2026-09-15", breakdown: "total", clicks: 500, impressions: 5_000 },
      {
        engine: "google",
        day: "2026-09-15",
        breakdown: "query",
        value: "luxury gardens kent",
        clicks: 200,
        impressions: 900,
      },
      {
        engine: "google",
        day: "2026-09-15",
        breakdown: "query",
        value: "garden designer tunbridge wells",
        clicks: 120,
        impressions: 800,
      },
    ]);
    const report = await getSearchReport(siteId, NOW);
    expect(report.branded).toEqual({ branded: 200, nonBranded: 120, coverage: 0.64 });
  });

  it("recalculates the split over stored data when a brand term is added later", async () => {
    const siteId = await newSite([]);
    await insert(siteId, [
      { engine: "google", day: "2026-09-15", breakdown: "total", clicks: 10, impressions: 100 },
      {
        engine: "google",
        day: "2026-09-15",
        breakdown: "query",
        value: "lgd design",
        clicks: 4,
        impressions: 40,
      },
    ]);
    expect((await getSearchReport(siteId, NOW)).branded).toBeNull();
    await getDb()
      .update(sites)
      .set({ brandTerms: ["lgd"] })
      .where(eq(sites.id, siteId));
    expect((await getSearchReport(siteId, NOW)).branded).toMatchObject({
      branded: 4,
      nonBranded: 0,
    });
  });

  it("compares the last 28 days with the 28 before, and lists top queries across engines", async () => {
    const siteId = await newSite();
    await insert(siteId, [
      { engine: "google", day: "2026-09-20", breakdown: "total", clicks: 30, impressions: 300 },
      { engine: "google", day: "2026-08-20", breakdown: "total", clicks: 10, impressions: 100 },
      {
        engine: "google",
        day: "2026-09-20",
        breakdown: "query",
        value: "garden design",
        clicks: 6,
        impressions: 60,
      },
      {
        engine: "bing",
        day: "2026-09-20",
        breakdown: "query",
        value: "garden design",
        clicks: 2,
        impressions: 20,
      },
      {
        engine: "google",
        day: "2026-09-20",
        breakdown: "query",
        value: "patio ideas",
        clicks: 7,
        impressions: 90,
      },
    ]);
    const report = await getSearchReport(siteId, NOW);
    expect(report.period).toEqual({
      from: "2026-08-26",
      to: "2026-09-22",
      previousFrom: "2026-07-29",
      previousTo: "2026-08-25",
    });
    expect(report.google?.previous.clicks).toBe(10);
    expect(report.topQueries.slice(0, 2)).toEqual([
      { value: "garden design", clicks: 8, impressions: 80 },
      { value: "patio ideas", clicks: 7, impressions: 90 },
    ]);
  });

  it("puts organic search clicks beside organic sessions and enquiries", async () => {
    const siteId = await newSite();
    await insert(siteId, [
      { engine: "google", day: "2026-09-15", breakdown: "total", clicks: 40, impressions: 400 },
    ]);
    await getDb()
      .insert(siteDailyMetrics)
      .values([
        {
          siteId,
          day: "2026-09-15",
          metric: "sessions_by_channel",
          dimension: "Organic Search",
          value: 35,
        },
        {
          siteId,
          day: "2026-09-15",
          metric: "sessions_by_channel",
          dimension: "Direct",
          value: 99,
        },
        {
          siteId,
          day: "2026-09-15",
          metric: "leads_by_channel",
          dimension: "organic_search",
          value: 2,
        },
      ]);
    expect((await getSearchReport(siteId, NOW)).searchToEnquiry).toEqual({
      organicClicks: 40,
      organicSessions: 35,
      organicLeads: 2,
    });
  });

  it("rejects a signed-out reader", async () => {
    const siteId = await newSite();
    testSession.signedIn = false;
    await expect(getSearchReport(siteId, NOW)).rejects.toThrow();
  });
});

describe("isBranded", () => {
  it("matches a term anywhere in the query, ignoring case", () => {
    expect(isBranded("Luxury Gardens Kent", ["luxury gardens"])).toBe(true);
    expect(isBranded("garden design", ["luxury gardens"])).toBe(false);
  });
});
