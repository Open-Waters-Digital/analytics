import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import {
  clients,
  peLabRuns,
  sitePageExperience,
  sitePerformanceBudgets,
  sites,
  siteTrackedPages,
} from "@/db/schema";
import { testSession } from "@/test/mock-session";
import { getPageExperienceReport } from "./page-experience-read";

vi.mock("@/server/session", () => import("@/test/mock-session"));

const hex = () => randomBytes(4).toString("hex");
const NOW = new Date("2026-09-25T10:00:00Z");

async function newSite(paths: string[] = ["/"]) {
  const db = getDb();
  const [client] = await db
    .insert(clients)
    .values({ slug: `pe-${hex()}`, name: "PE", analyticsOwnership: "open_waters" })
    .returning({ id: clients.id });
  const [site] = await db
    .insert(sites)
    .values({
      clientId: client!.id,
      productionUrl: `https://${hex()}.example.com`,
      framework: "next",
      taxonomyVersion: 3,
      timezone: "Europe/London",
    })
    .returning({ id: sites.id });
  await db.insert(siteTrackedPages).values(paths.map(path => ({ siteId: site!.id, path })));
  return site!.id;
}

type Row = typeof sitePageExperience.$inferInsert;
const origin = (siteId: string, day: string, values: Partial<Row> = {}): Row => ({
  siteId,
  day,
  source: "field",
  scope: "origin",
  path: "",
  formFactor: "phone",
  status: "ok",
  lcpMs: 1_900,
  inpMs: 120,
  cls: "0.0200",
  ...values,
});

beforeEach(() => {
  testSession.signedIn = true;
});

describe("getPageExperienceReport", () => {
  it("gives each form factor a verdict from its latest field row, against the site's budget", async () => {
    const siteId = await newSite();
    await getDb()
      .insert(sitePageExperience)
      .values([
        origin(siteId, "2026-09-24", { lcpMs: 2_300 }),
        origin(siteId, "2026-09-20", { lcpMs: 1_500 }),
        origin(siteId, "2026-09-24", { formFactor: "desktop", lcpMs: 1_200 }),
      ]);
    await getDb().insert(sitePerformanceBudgets).values({ siteId, lcpMs: 2_000 });

    const report = await getPageExperienceReport(siteId, NOW);
    expect(report.phone.verdict).toMatchObject({ outcome: "failing", failing: ["LCP"] });
    expect(report.phone.latest?.lcpMs).toBe(2_300);
    expect(report.desktop.verdict.outcome).toBe("passing");
  });

  it("says there is not enough Chrome traffic, and still shows the lab results", async () => {
    const siteId = await newSite(["/", "/contact"]);
    await getDb()
      .insert(sitePageExperience)
      .values([
        origin(siteId, "2026-09-24", {
          status: "not_enough_data",
          lcpMs: null,
          inpMs: null,
          cls: null,
        }),
        {
          siteId,
          day: "2026-09-22",
          source: "lab",
          scope: "page",
          path: "/",
          formFactor: "phone",
          status: "ok",
          labScore: 84,
          lcpMs: 3_100,
          tbtMs: 120,
          cls: "0.0100",
        },
        {
          siteId,
          day: "2026-09-22",
          source: "lab",
          scope: "page",
          path: "/contact",
          formFactor: "phone",
          status: "failed",
          reason: "The page did not load",
        },
      ]);

    const report = await getPageExperienceReport(siteId, NOW);
    expect(report.phone.verdict.outcome).toBe("not_enough_data");
    expect(report.lab).toEqual([
      {
        path: "/",
        day: "2026-09-22",
        score: 84,
        belowTarget: true,
        lcpMs: 3_100,
        tbtMs: 120,
        cls: 0.01,
        failed: null,
      },
      {
        path: "/contact",
        day: "2026-09-22",
        score: null,
        belowTarget: false,
        lcpMs: null,
        tbtMs: null,
        cls: null,
        failed: "The page did not load",
      },
    ]);
  });

  it("keeps the last value of each of the last three months, oldest first", async () => {
    const siteId = await newSite();
    await getDb()
      .insert(sitePageExperience)
      .values([
        origin(siteId, "2026-09-24", { lcpMs: 1_900 }),
        origin(siteId, "2026-09-01", { lcpMs: 2_900 }),
        origin(siteId, "2026-08-30", { lcpMs: 2_100, source: "field_history" }),
        origin(siteId, "2026-07-26", { lcpMs: 2_400, source: "field_history" }),
      ]);
    const months = (await getPageExperienceReport(siteId, NOW)).phone.months;
    expect(months.map(month => [month.month, month.lcpMs])).toEqual([
      ["2026-07", 2_400],
      ["2026-08", 2_100],
      ["2026-09", 1_900],
    ]);
  });

  it("reports a run in progress, and not one abandoned ten minutes ago", async () => {
    const siteId = await newSite();
    await getDb()
      .insert(peLabRuns)
      .values({ siteId, status: "running", startedAt: new Date("2026-09-25T09:58:00Z") });
    expect((await getPageExperienceReport(siteId, NOW)).runInProgress).toBe(true);

    const stale = await newSite();
    await getDb()
      .insert(peLabRuns)
      .values({ siteId: stale, status: "running", startedAt: new Date("2026-09-25T09:40:00Z") });
    expect((await getPageExperienceReport(stale, NOW)).runInProgress).toBe(false);
  });

  it("rejects a signed-out reader", async () => {
    const siteId = await newSite();
    testSession.signedIn = false;
    await expect(getPageExperienceReport(siteId, NOW)).rejects.toThrow();
  });
});
