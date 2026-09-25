import { randomBytes } from "node:crypto";
import { and, eq, inArray, min } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import {
  bingWebmasterSites,
  clients,
  searchConsoleProperties,
  siteIndexStatus,
  siteSearchDaily,
  siteSnapshotResults,
  sites,
  snapshotRuns,
} from "@/db/schema";
import { addDays } from "./window";
import { indexingPass, onProperty, parseSitemap, runSearchPass, type SearchDeps } from "./search";

const hex = () => randomBytes(4).toString("hex");
const WEDNESDAY = new Date("2026-09-23T10:00:00Z");
const MONDAY = new Date("2026-09-28T10:00:00Z");

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * Google and Bing as fakes. Each engine has data from `since` to yesterday, a
 * row a day of totals, one device, two queries and two pages, and can be told
 * to refuse access.
 */
function fakes(
  options: {
    googleSince?: string;
    bingSince?: string;
    googleRefuses?: boolean;
    bingRefuses?: boolean;
    sitemaps?: Record<string, string>;
    submitted?: string[];
    pages?: number;
  } = {},
) {
  const googleSince = options.googleSince ?? "2025-01-01";
  const bingSince = options.bingSince ?? "2025-01-01";
  const calls = {
    google: 0,
    bing: 0,
    inspections: [] as string[],
    sitemaps: 0,
    starts: [] as string[],
  };

  const googleFetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.google += 1;
    if (options.googleRefuses) return json(403, { error: { message: "no permission" } });
    if (url.includes("urlInspection")) {
      const body = JSON.parse(String(init?.body)) as { inspectionUrl: string };
      calls.inspections.push(body.inspectionUrl);
      const indexed = !body.inspectionUrl.endsWith("/redirected");
      return json(200, {
        inspectionResult: {
          indexStatusResult: {
            verdict: indexed ? "PASS" : "NEUTRAL",
            coverageState: indexed ? "Submitted and indexed" : "Page with redirect",
            lastCrawlTime: "2026-09-20T10:00:00Z",
          },
        },
      });
    }
    if (url.endsWith("/sitemaps")) {
      return json(200, { sitemap: (options.submitted ?? []).map(path => ({ path })) });
    }
    const body = JSON.parse(String(init?.body)) as {
      startDate: string;
      endDate: string;
      dimensions: string[];
    };
    calls.starts.push(body.startDate);
    const rows = [];
    for (let day = body.startDate; day <= body.endDate; day = addDays(day, 1)) {
      if (day < googleSince) continue;
      const second = body.dimensions[1];
      if (!second) rows.push({ keys: [day], clicks: 3, impressions: 40, position: 5 });
      else if (second === "device")
        rows.push({ keys: [day, "MOBILE"], clicks: 2, impressions: 30, position: 4 });
      else {
        for (const value of second === "query"
          ? ["garden design kent", "luxury gardens"]
          : ["https://example.com/", "https://example.com/about?x=1"]) {
          rows.push({ keys: [day, value], clicks: 1, impressions: 10, position: 3 });
        }
      }
    }
    return json(200, rows.length ? { rows } : {});
  });

  const bingFetch = vi.fn(async (url: string) => {
    calls.bing += 1;
    if (options.bingRefuses) return json(400, { ErrorCode: 14, Message: "ERROR!!! NotAuthorized" });
    const today = "2026-09-27";
    const days: string[] = [];
    for (let day = bingSince; day <= today; day = addDays(day, 1)) days.push(day);
    const at = (day: string) => `/Date(${Date.parse(`${day}T00:00:00Z`)})/`;
    if (url.includes("GetRankAndTrafficStats")) {
      return json(200, { d: days.map(day => ({ Date: at(day), Clicks: 1, Impressions: 20 })) });
    }
    return json(200, {
      d: days.map(day => ({
        Query: url.includes("GetPageStats") ? "https://example.com/" : "garden design",
        Date: at(day),
        Clicks: 1,
        Impressions: 5,
        AvgImpressionPosition: 2,
      })),
    });
  });

  const siteFetch = vi.fn(async (url: string) => {
    calls.sitemaps += 1;
    const body = options.sitemaps?.[url];
    return body === undefined
      ? new Response("missing", { status: 404 })
      : new Response(body, { status: 200 });
  });

  const deps = (now: Date): Partial<SearchDeps> => ({
    now: () => now,
    google: {
      fetchImpl: googleFetch as unknown as typeof fetch,
      token: async () => "token",
      sleep: async () => {},
    },
    bing: {
      fetchImpl: bingFetch as unknown as typeof fetch,
      apiKey: "bing-key",
      sleep: async () => {},
    },
    fetchImpl: siteFetch as unknown as typeof fetch,
    sleep: async () => {},
    googleConfigured: () => true,
    bingConfigured: () => true,
  });
  return { deps, calls };
}

async function newSite(
  options: {
    replaces?: boolean;
    status?: "active" | "offboarded";
    ownership?: "open_waters" | "client_owned";
    google?: boolean;
    bing?: boolean;
    googleStatus?: "no_access" | null;
  } = {},
) {
  const db = getDb();
  const slug = `search-${hex()}`;
  const [client] = await db
    .insert(clients)
    .values({
      slug,
      name: slug,
      status: options.status ?? "active",
      analyticsOwnership: options.ownership ?? "open_waters",
    })
    .returning({ id: clients.id });
  const [site] = await db
    .insert(sites)
    .values({
      clientId: client!.id,
      productionUrl: `https://${hex()}.example.com`,
      framework: "next",
      taxonomyVersion: 3,
      timezone: "Europe/London",
      replacesExistingSite: options.replaces ?? false,
    })
    .returning({ id: sites.id });
  if (options.google ?? true) {
    await db.insert(searchConsoleProperties).values({
      siteId: site!.id,
      property: "sc-domain:example.com",
      lastCheckStatus: options.googleStatus ?? null,
    });
  }
  if (options.bing ?? true) {
    await db
      .insert(bingWebmasterSites)
      .values({ siteId: site!.id, siteUrl: "https://example.com/" });
  }
  return site!.id;
}

const createdRuns: string[] = [];

// Runs this file makes are not the snapshot's: read.test.ts reads the latest one.
afterAll(async () => {
  if (createdRuns.length > 0) {
    await getDb().delete(snapshotRuns).where(inArray(snapshotRuns.id, createdRuns));
  }
});

async function newRun(): Promise<string> {
  const [run] = await getDb()
    .insert(snapshotRuns)
    .values({ startedAt: new Date() })
    .returning({ id: snapshotRuns.id });
  createdRuns.push(run!.id);
  return run!.id;
}

async function rowsOf(siteId: string, engine: "google" | "bing") {
  return getDb()
    .select()
    .from(siteSearchDaily)
    .where(and(eq(siteSearchDaily.siteId, siteId), eq(siteSearchDaily.engine, engine)));
}

async function earliest(siteId: string, engine: "google" | "bing") {
  const [row] = await getDb()
    .select({ day: min(siteSearchDaily.day) })
    .from(siteSearchDaily)
    .where(and(eq(siteSearchDaily.siteId, siteId), eq(siteSearchDaily.engine, engine)));
  return row?.day ?? null;
}

const resultsFor = (
  results: Awaited<ReturnType<typeof runSearchPass>>["results"],
  siteId: string,
) => results.filter(result => result.siteId === siteId);

describe("runSearchPass", () => {
  it("stores ten days from each engine for a new site, and a re-run replaces them", async () => {
    const siteId = await newSite();
    const engines = fakes();
    const first = await runSearchPass(await newRun(), engines.deps(WEDNESDAY));
    expect(
      resultsFor(first.results, siteId).map(result => [result.source, result.outcome]),
    ).toEqual([
      ["google_search", "ok"],
      ["bing_search", "ok"],
    ]);

    const google = await rowsOf(siteId, "google");
    const totals = google.filter(row => row.breakdown === "total");
    expect(totals).toHaveLength(10);
    expect(totals.map(row => row.day).sort()[0]).toBe("2026-09-13");
    expect(
      google.filter(row => row.breakdown === "page").every(row => !row.value.includes("?")),
    ).toBe(true);
    expect((await rowsOf(siteId, "bing")).filter(row => row.breakdown === "total")).toHaveLength(
      10,
    );

    await runSearchPass(await newRun(), engines.deps(WEDNESDAY));
    expect(await rowsOf(siteId, "google")).toHaveLength(google.length);
  });

  it("backfills a replacement site, only once, and only from the day each engine has data", async () => {
    const siteId = await newSite({ replaces: true });
    const engines = fakes({ googleSince: "2025-08-01", bingSince: "2026-03-03" });
    await runSearchPass(await newRun(), engines.deps(WEDNESDAY));
    expect(await earliest(siteId, "google")).toBe("2025-08-01");
    expect(await earliest(siteId, "bing")).toBe("2026-03-03");

    const [property] = await getDb()
      .select({ backfilledAt: searchConsoleProperties.backfilledAt })
      .from(searchConsoleProperties)
      .where(eq(searchConsoleProperties.siteId, siteId));
    expect(property?.backfilledAt).toBeInstanceOf(Date);

    const startsBefore = engines.calls.starts.length;
    await runSearchPass(await newRun(), engines.deps(WEDNESDAY));
    // Only the ten-day window this time: no request reaches back past it.
    const again = engines.calls.starts.slice(startsBefore);
    expect(again.length).toBeGreaterThan(0);
    expect(again.every(start => start === "2026-09-13")).toBe(true);
  });

  it("backfills a site marked as a replacement after its first pull", async () => {
    const siteId = await newSite();
    const engines = fakes({ googleSince: "2025-06-01" });
    await runSearchPass(await newRun(), engines.deps(WEDNESDAY));
    expect(await earliest(siteId, "google")).toBe("2026-09-13");

    await getDb().update(sites).set({ replacesExistingSite: true }).where(eq(sites.id, siteId));
    await runSearchPass(await newRun(), engines.deps(WEDNESDAY));
    expect(await earliest(siteId, "google")).toBe("2025-06-01");
  });

  it("writes no zeros before an engine's data begins, and fills gaps after it", async () => {
    const siteId = await newSite();
    const engines = fakes({ googleSince: "2026-09-18" });
    await runSearchPass(await newRun(), engines.deps(WEDNESDAY));
    const totals = (await rowsOf(siteId, "google")).filter(row => row.breakdown === "total");
    expect(totals.map(row => row.day).sort()).toEqual([
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
      "2026-09-22",
    ]);
  });

  it("marks a refused property no access, keeps its rows, and skips it after", async () => {
    const siteId = await newSite();
    await runSearchPass(await newRun(), fakes().deps(WEDNESDAY));
    const before = await rowsOf(siteId, "google");

    const refusing = fakes({ googleRefuses: true });
    const result = await runSearchPass(await newRun(), refusing.deps(WEDNESDAY));
    expect(resultsFor(result.results, siteId)[0]).toMatchObject({
      source: "google_search",
      outcome: "failed",
    });
    expect(await rowsOf(siteId, "google")).toHaveLength(before.length);
    const [property] = await getDb()
      .select({ status: searchConsoleProperties.lastCheckStatus })
      .from(searchConsoleProperties)
      .where(eq(searchConsoleProperties.siteId, siteId));
    expect(property?.status).toBe("no_access");

    const next = fakes();
    const skipped = await runSearchPass(await newRun(), next.deps(WEDNESDAY));
    expect(resultsFor(skipped.results, siteId)[0]?.outcome).toBe("skipped");
  });

  it("records a Bing failure beside a Google success for the same site", async () => {
    const siteId = await newSite();
    const runId = await newRun();
    await runSearchPass(runId, fakes({ bingRefuses: true }).deps(WEDNESDAY));
    const stored = await getDb()
      .select({ source: siteSnapshotResults.source, outcome: siteSnapshotResults.outcome })
      .from(siteSnapshotResults)
      .where(and(eq(siteSnapshotResults.runId, runId), eq(siteSnapshotResults.siteId, siteId)));
    expect(stored.sort((a, b) => a.source.localeCompare(b.source))).toEqual([
      { source: "bing_search", outcome: "failed" },
      { source: "google_search", outcome: "ok" },
    ]);
  });

  it("skips an offboarded client, and pulls a client-owned one", async () => {
    const offboarded = await newSite({ status: "offboarded" });
    const clientOwned = await newSite({ ownership: "client_owned" });
    const result = await runSearchPass(await newRun(), fakes().deps(WEDNESDAY));
    expect(resultsFor(result.results, offboarded)).toEqual([]);
    expect(resultsFor(result.results, clientOwned).every(entry => entry.outcome === "ok")).toBe(
      true,
    );
  });

  it("skips a site with no property, and an engine that is not configured", async () => {
    const bare = await newSite({ google: false, bing: false });
    const engines = fakes();
    const result = await runSearchPass(await newRun(), {
      ...engines.deps(WEDNESDAY),
      bingConfigured: () => false,
    });
    expect(resultsFor(result.results, bare).map(entry => entry.outcome)).toEqual([
      "skipped",
      "skipped",
    ]);
  });
});

describe("the indexing pass", () => {
  const urlset = (addresses: string[]) =>
    `<?xml version="1.0"?><urlset>${addresses.map(address => `<url><loc>${address}</loc></url>`).join("")}</urlset>`;

  it("inspects every page of a small sitemap, and records each verdict", async () => {
    const siteId = await newSite();
    const pages = Array.from({ length: 30 }, (_, index) => `https://example.com/page-${index}`);
    pages.push("https://example.com/redirected", "https://elsewhere.org/not-ours");
    const engines = fakes({
      submitted: ["https://example.com/sitemap.xml"],
      sitemaps: { "https://example.com/sitemap.xml": urlset(pages) },
    });
    const summary = await indexingPass(siteId, "sc-domain:example.com", engines.deps(MONDAY));
    expect(summary).toEqual({ siteId, inspected: 31, failed: null });
    expect(engines.calls.inspections).not.toContain("https://elsewhere.org/not-ours");
    const stored = await getDb()
      .select()
      .from(siteIndexStatus)
      .where(eq(siteIndexStatus.siteId, siteId));
    expect(stored.find(row => row.address.endsWith("/redirected"))).toMatchObject({
      verdict: "not_indexed",
      coverageState: "Page with redirect",
    });
  });

  it("follows one level of sitemap index", async () => {
    const siteId = await newSite();
    const engines = fakes({
      submitted: ["https://example.com/sitemap-index.xml"],
      sitemaps: {
        "https://example.com/sitemap-index.xml":
          "<sitemapindex><sitemap><loc>https://example.com/pages.xml</loc></sitemap></sitemapindex>",
        "https://example.com/pages.xml": urlset(["https://example.com/a", "https://example.com/b"]),
      },
    });
    expect(
      (await indexingPass(siteId, "sc-domain:example.com", engines.deps(MONDAY))).inspected,
    ).toBe(2);
  });

  it("says a sitemap needs submitting, and keeps earlier results when the sitemap cannot be fetched", async () => {
    const siteId = await newSite();
    expect(
      await indexingPass(siteId, "sc-domain:example.com", fakes({ submitted: [] }).deps(MONDAY)),
    ).toEqual({
      siteId,
      inspected: 0,
      failed: "No sitemap is submitted in Search Console.",
    });

    await indexingPass(
      siteId,
      "sc-domain:example.com",
      fakes({
        submitted: ["https://example.com/sitemap.xml"],
        sitemaps: { "https://example.com/sitemap.xml": urlset(["https://example.com/a"]) },
      }).deps(MONDAY),
    );
    const missing = await indexingPass(
      siteId,
      "sc-domain:example.com",
      fakes({ submitted: ["https://example.com/sitemap.xml"], sitemaps: {} }).deps(MONDAY),
    );
    expect(missing.failed).toBe("The site's sitemap could not be fetched.");
    expect(
      await getDb().select().from(siteIndexStatus).where(eq(siteIndexStatus.siteId, siteId)),
    ).toHaveLength(1);
  });

  it("covers a large sitemap over successive weeks, never-inspected pages first", async () => {
    const siteId = await newSite();
    const pages = Array.from({ length: 700 }, (_, index) => `https://example.com/p${index}`);
    const options = {
      submitted: ["https://example.com/sitemap.xml"],
      sitemaps: { "https://example.com/sitemap.xml": urlset(pages) },
    };
    const first = fakes(options);
    expect(
      (await indexingPass(siteId, "sc-domain:example.com", first.deps(MONDAY))).inspected,
    ).toBe(500);
    const second = fakes(options);
    await indexingPass(
      siteId,
      "sc-domain:example.com",
      second.deps(new Date("2026-10-05T10:00:00Z")),
    );
    expect(second.calls.inspections.slice(0, 200)).toEqual(pages.slice(500));
    expect(
      await getDb().select().from(siteIndexStatus).where(eq(siteIndexStatus.siteId, siteId)),
    ).toHaveLength(700);
  });

  it("runs only on Mondays, as part of the nightly pass", async () => {
    await newSite();
    const engines = fakes({ submitted: [] });
    expect((await runSearchPass(await newRun(), engines.deps(WEDNESDAY))).indexing).toEqual([]);
    expect(
      (await runSearchPass(await newRun(), engines.deps(MONDAY))).indexing.length,
    ).toBeGreaterThan(0);
  });
});

describe("helpers", () => {
  it.each([
    ["https://example.com/a", "sc-domain:example.com", true],
    ["https://www.example.com/a", "sc-domain:example.com", true],
    ["https://notexample.com/a", "sc-domain:example.com", false],
    ["https://example.com/blog/a", "https://example.com/blog/", true],
    ["https://example.com/a", "https://example.com/blog/", false],
  ])("onProperty(%s, %s) is %s", (address, property, expected) => {
    expect(onProperty(address, property)).toBe(expected);
  });

  it("parses locations and unescapes ampersands", () => {
    expect(
      parseSitemap("<urlset><url><loc> https://example.com/a?x=1&amp;y=2 </loc></url></urlset>"),
    ).toEqual({
      index: false,
      locations: ["https://example.com/a?x=1&y=2"],
    });
  });
});
