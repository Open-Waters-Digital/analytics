import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import {
  clients,
  posthogConnections,
  siteDailyMetrics,
  siteSnapshotResults,
  sites,
  snapshotRuns,
} from "@/db/schema";
import { encryptApiKey, KEY_VERSION, lastFour } from "@/server/crypto";
import { CHECK_MESSAGES } from "@/server/posthog";
import { runNightlySnapshot, SNAPSHOT_MESSAGES, type SiteResult } from "./collect";
import { FIRST_PULL_DAYS, WINDOW_DAYS } from "./window";

/**
 * These run against the real test database (src/test/global-setup.ts) and a
 * stubbed PostHog. Other test files share the database, so every assertion is
 * about this test's own site, never a total across the table.
 */

const masterKey = randomBytes(32);
const apiKey = "phx_SnapshotQueryReadKey1234";
const now = new Date("2026-09-18T03:20:00Z");
/** The window `now` produces: the seven days ending yesterday. */
const yesterday = "2026-09-17";

type Row = [string, string, string, number, number, string];

interface Fixture {
  siteId: string;
  clientSlug: string;
  connectionId: string;
}

async function newSite(
  options: {
    ownership?: "open_waters" | "client_owned";
    status?: "active" | "offboarded";
    connection?: { lastCheckStatus?: "ok" | "unauthorised" | null; ciphertext?: string } | null;
  } = {},
): Promise<Fixture> {
  const db = getDb();
  const slug = `snap-${randomBytes(4).toString("hex")}`;
  const [client] = await db
    .insert(clients)
    .values({
      slug,
      name: `Snapshot ${slug}`,
      status: options.status ?? "active",
      analyticsOwnership: options.ownership ?? "open_waters",
    })
    .returning({ id: clients.id });

  const [site] = await db
    .insert(sites)
    .values({
      clientId: client!.id,
      productionUrl: `https://${slug}.example.com`,
      framework: "astro",
      taxonomyVersion: 1,
      timezone: "Europe/London",
    })
    .returning({ id: sites.id });

  const connectionId = randomUUID();
  if (options.connection !== null) {
    await db.insert(posthogConnections).values({
      id: connectionId,
      siteId: site!.id,
      region: "eu",
      projectId: 4242,
      apiKeyCiphertext:
        options.connection?.ciphertext ?? encryptApiKey(apiKey, connectionId, masterKey),
      keyVersion: KEY_VERSION,
      keyLast4: lastFour(apiKey),
      lastCheckAt: new Date("2026-09-17T09:00:00Z"),
      lastCheckStatus: options.connection?.lastCheckStatus ?? "ok",
      lastCheckMessage: null,
    });
  }

  return { siteId: site!.id, clientSlug: slug, connectionId };
}

/** A PostHog that answers each metric group from `rows`, keyed by group name. */
function postHogStub(rows: Partial<Record<string, Row[]>>, status = 200) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { name: string };
    const group = body.name.replace("openwaters_snapshot_", "");
    return new Response(JSON.stringify({ results: rows[group] ?? [], columns: [], types: [] }), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
}

function run(fetchImpl: ReturnType<typeof postHogStub> | typeof fetch) {
  return runNightlySnapshot({
    now: () => now,
    fetchImpl: fetchImpl as typeof fetch,
    masterKey: () => masterKey,
    sleep: async () => {},
    concurrency: 2,
  });
}

function resultFor(summary: { results: SiteResult[] }, siteId: string): SiteResult {
  const result = summary.results.find(candidate => candidate.siteId === siteId);
  if (!result) throw new Error("This test's site was not in the run");
  return result;
}

async function metricsFor(siteId: string) {
  return getDb()
    .select()
    .from(siteDailyMetrics)
    .where(eq(siteDailyMetrics.siteId, siteId))
    .orderBy(siteDailyMetrics.day, siteDailyMetrics.metric, siteDailyMetrics.dimension);
}

describe("runNightlySnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores a connected site's day, broken down as the event list defines", async () => {
    const site = await newSite();
    const fetchImpl = postHogStub({
      traffic: [
        [yesterday, "page_views", "", 40, 0, ""],
        [yesterday, "daily_visitors", "", 22, 0, ""],
      ],
      sessions: [[yesterday, "sessions", "", 25, 0, ""]],
      intent: [
        [yesterday, "cta_clicked", "book-a-call", 8, 0, ""],
        [yesterday, "cta_clicked", "see-our-work", 4, 0, ""],
      ],
      action: [[yesterday, "lead_submitted", "partner", 1, 0, ""]],
    });

    const summary = await run(fetchImpl);
    expect(resultFor(summary, site.siteId)).toMatchObject({ outcome: "ok", reason: null });

    const stored = await metricsFor(site.siteId);
    const day = stored.filter(row => row.day === yesterday);
    expect(day.find(row => row.metric === "page_views")?.value).toBe(40);
    expect(day.find(row => row.metric === "sessions")?.value).toBe(25);
    expect(
      day
        .filter(row => row.metric === "cta_clicked")
        .map(row => row.dimension)
        .sort(),
    ).toEqual(["book-a-call", "see-our-work"]);
    expect(day.find(row => row.metric === "lead_submitted")?.value).toBe(1);
  });

  it("records a quiet day as zero, so a gap always means 'not pulled'", async () => {
    const site = await newSite();
    await run(postHogStub({}));

    const stored = await metricsFor(site.siteId);
    const days = new Set(stored.map(row => row.day));
    expect(days.size).toBe(FIRST_PULL_DAYS);
    for (const day of days) {
      const forDay = stored.filter(row => row.day === day);
      expect(forDay.map(row => row.metric).sort()).toEqual([
        "daily_visitors",
        "page_views",
        "sessions",
      ]);
      expect(forDay.every(row => row.value === 0)).toBe(true);
    }
  });

  it("pulls thirty days the first time and seven after that", async () => {
    const site = await newSite();
    const first = await run(postHogStub({}));
    expect(resultFor(first, site.siteId).daysWritten).toBe(FIRST_PULL_DAYS);

    const second = await run(postHogStub({}));
    expect(resultFor(second, site.siteId).daysWritten).toBe(WINDOW_DAYS);
    // The older days from the first pull are left alone, not deleted.
    const days = new Set((await metricsFor(site.siteId)).map(row => row.day));
    expect(days.size).toBe(FIRST_PULL_DAYS);
  });

  it("replaces a day rather than adding to it when run twice", async () => {
    const site = await newSite();
    const rows: Partial<Record<string, Row[]>> = {
      traffic: [[yesterday, "page_views", "", 10, 0, ""]],
    };
    await run(postHogStub(rows));
    await run(postHogStub({ traffic: [[yesterday, "page_views", "", 12, 0, ""]] }));

    const pageViews = (await metricsFor(site.siteId)).filter(
      row => row.day === yesterday && row.metric === "page_views",
    );
    expect(pageViews).toHaveLength(1);
    expect(pageViews[0]?.value).toBe(12);
  });

  it("skips a client-owned site with no connection, as skipped and not failed", async () => {
    const site = await newSite({ ownership: "client_owned", connection: null });
    const summary = await run(postHogStub({}));

    expect(resultFor(summary, site.siteId)).toMatchObject({
      outcome: "skipped",
      reason: SNAPSHOT_MESSAGES.clientOwned,
    });
  });

  it("skips a site with no connection", async () => {
    const site = await newSite({ connection: null });
    const summary = await run(postHogStub({}));
    expect(resultFor(summary, site.siteId)).toMatchObject({
      outcome: "skipped",
      reason: SNAPSHOT_MESSAGES.noConnection,
    });
  });

  it("does not pull an offboarded client at all", async () => {
    const site = await newSite({ status: "offboarded" });
    const summary = await run(postHogStub({}));
    expect(summary.results.some(result => result.siteId === site.siteId)).toBe(false);
    expect(await metricsFor(site.siteId)).toEqual([]);
  });

  it("skips a key PostHog has already rejected, without asking again", async () => {
    const site = await newSite({ connection: { lastCheckStatus: "unauthorised" } });
    const fetchImpl = postHogStub({});
    const summary = await run(fetchImpl);

    expect(resultFor(summary, site.siteId)).toMatchObject({
      outcome: "skipped",
      reason: SNAPSHOT_MESSAGES.connectionFailed,
    });
    const asked = fetchImpl.mock.calls.some(call =>
      String((call[1] as RequestInit).body).includes("4242"),
    );
    expect(asked).toBe(false);
  });

  it("fails a site whose stored key cannot be decrypted, and keeps going", async () => {
    const site = await newSite({ connection: { ciphertext: "not.valid.ciphertext" } });
    const working = await newSite();
    const summary = await run(postHogStub({ traffic: [[yesterday, "page_views", "", 5, 0, ""]] }));

    expect(resultFor(summary, site.siteId)).toMatchObject({
      outcome: "failed",
      reason: SNAPSHOT_MESSAGES.unreadableKey,
    });
    expect(resultFor(summary, working.siteId).outcome).toBe("ok");
  });

  it("records a rejected key against the connection, and leaves stored days alone", async () => {
    const site = await newSite();
    await run(postHogStub({ traffic: [[yesterday, "page_views", "", 9, 0, ""]] }));

    const summary = await run(postHogStub({}, 401));
    expect(resultFor(summary, site.siteId)).toMatchObject({
      outcome: "failed",
      reason: CHECK_MESSAGES.unauthorised,
    });

    const [connection] = await getDb()
      .select()
      .from(posthogConnections)
      .where(eq(posthogConnections.siteId, site.siteId));
    expect(connection?.lastCheckStatus).toBe("unauthorised");

    const pageViews = (await metricsFor(site.siteId)).find(
      row => row.day === yesterday && row.metric === "page_views",
    );
    expect(pageViews?.value).toBe(9);
  });

  it("leaves the connection alone when PostHog is simply unreachable", async () => {
    const site = await newSite();
    const summary = await run(
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    expect(resultFor(summary, site.siteId)).toMatchObject({
      outcome: "failed",
      reason: CHECK_MESSAGES.unreachable,
    });
    const [connection] = await getDb()
      .select()
      .from(posthogConnections)
      .where(eq(posthogConnections.siteId, site.siteId));
    // An outage says nothing about the key, so tomorrow's run still tries.
    expect(connection?.lastCheckStatus).toBe("ok");
  });

  it("fails a site whose response it cannot read, without storing anything", async () => {
    const site = await newSite();
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ results: [["yesterday", "page_views"]] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const summary = await run(fetchImpl);
    expect(resultFor(summary, site.siteId)).toMatchObject({
      outcome: "failed",
      reason: SNAPSHOT_MESSAGES.unreadableResponse,
    });
    expect(await metricsFor(site.siteId)).toEqual([]);
  });

  it("refuses to add up two currencies in a day", async () => {
    const site = await newSite();
    const summary = await run(
      postHogStub({
        revenue: [
          [yesterday, "deal_won", "partner", 1, 100000, "GBP"],
          [yesterday, "deal_won", "partner", 1, 100000, "EUR"],
        ],
      }),
    );

    expect(resultFor(summary, site.siteId)).toMatchObject({
      outcome: "failed",
      reason: SNAPSHOT_MESSAGES.mixedCurrency,
    });
  });

  it("records the run and every site's outcome", async () => {
    const ok = await newSite();
    const skipped = await newSite({ connection: null });
    const summary = await run(postHogStub({}));

    const [row] = await getDb()
      .select()
      .from(snapshotRuns)
      .where(eq(snapshotRuns.id, summary.runId));
    expect(row?.startedAt).toEqual(summary.startedAt);
    expect(row?.finishedAt).toEqual(summary.finishedAt);
    expect(row!.sitesOk).toBeGreaterThanOrEqual(1);
    expect(row!.sitesSkipped).toBeGreaterThanOrEqual(1);

    const results = await getDb()
      .select()
      .from(siteSnapshotResults)
      .where(
        and(
          eq(siteSnapshotResults.runId, summary.runId),
          inArray(siteSnapshotResults.siteId, [ok.siteId, skipped.siteId]),
        ),
      );
    expect(results).toHaveLength(2);
    expect(results.find(result => result.siteId === ok.siteId)?.outcome).toBe("ok");
    expect(results.find(result => result.siteId === skipped.siteId)?.reason).toBe(
      SNAPSHOT_MESSAGES.noConnection,
    );
  });

  it("deletes run history older than ninety days", async () => {
    const [old] = await getDb()
      .insert(snapshotRuns)
      .values({ startedAt: new Date("2026-01-01T03:20:00Z") })
      .returning({ id: snapshotRuns.id });

    await run(postHogStub({}));

    const [still] = await getDb().select().from(snapshotRuns).where(eq(snapshotRuns.id, old!.id));
    expect(still).toBeUndefined();
  });

  it("never sends the key anywhere but PostHog's own endpoint", async () => {
    await newSite();
    const fetchImpl = postHogStub({});
    await run(fetchImpl);

    for (const [url, init] of fetchImpl.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/(eu|us)\.posthog\.com\//);
      expect(String((init as RequestInit).body)).not.toContain(apiKey);
    }
  });
});
