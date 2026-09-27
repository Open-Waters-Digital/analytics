import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import {
  clients,
  peLabRuns,
  sitePageExperience,
  siteSnapshotResults,
  sites,
  siteTrackedPages,
  snapshotRuns,
} from "@/db/schema";
import { PE_MESSAGES } from "@/server/page-experience";
import { runLab, runPageExperiencePass, type PageExperienceDeps } from "./page-experience-pull";

const hex = () => randomBytes(4).toString("hex");
const WEDNESDAY = new Date("2026-09-23T10:00:00Z");
const MONDAY = new Date("2026-09-28T10:00:00Z");

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const record = {
  record: {
    metrics: {
      largest_contentful_paint: {
        histogram: [{ density: 0.8 }, { density: 0.15 }, { density: 0.05 }],
        percentiles: { p75: 1_800 },
      },
      cumulative_layout_shift: {
        histogram: [{ density: 0.9 }, { density: 0.05 }, { density: 0.05 }],
        percentiles: { p75: "0.04" },
      },
    },
  },
};

const history = {
  record: {
    collectionPeriods: [{ lastDate: { year: 2026, month: 9, day: 19 } }],
    metrics: {
      largest_contentful_paint: {
        histogramTimeseries: [{ densities: [0.7] }, { densities: [0.2] }, { densities: [0.1] }],
        percentilesTimeseries: { p75s: [2_400] },
      },
    },
  },
};

const lighthouse = (score: number) => ({
  lighthouseResult: {
    categories: { performance: { score } },
    audits: {
      "largest-contentful-paint": { numericValue: 1_500 },
      "total-blocking-time": { numericValue: 90 },
      "first-contentful-paint": { numericValue: 900 },
      "speed-index": { numericValue: 1_200 },
      "cumulative-layout-shift": { numericValue: 0.01 },
    },
  },
});

/**
 * The Chrome UX Report and PageSpeed Insights as one fake. A page whose path
 * contains "quiet" has no Chrome data; one containing "broken" fails in the lab.
 */
function fakes(options: { refuse?: boolean } = {}) {
  const calls = { field: 0, history: 0, lab: [] as string[] };
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (options.refuse) return json(400, { error: { message: "API key not valid" } });
    if (url.includes("runPagespeed")) {
      const target = new URL(url).searchParams.get("url") ?? "";
      calls.lab.push(new URL(target).pathname);
      if (target.includes("broken")) {
        return json(400, {
          error: { message: "Lighthouse returned error: FAILED_DOCUMENT_REQUEST" },
        });
      }
      return json(200, lighthouse(0.92));
    }
    if (url.includes("queryHistoryRecord")) {
      calls.history += 1;
      return json(200, history);
    }
    calls.field += 1;
    const body = JSON.parse(String(init?.body)) as { url?: string };
    if (body.url?.includes("quiet")) return json(404, { error: { message: "not found" } });
    return json(200, record);
  });
  const deps = (now: Date): Partial<PageExperienceDeps> => ({
    now: () => now,
    configured: () => true,
    pe: { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: "key", sleep: async () => {} },
  });
  return { deps, calls };
}

async function newSite(
  options: { replaces?: boolean; paths?: string[]; status?: "active" | "offboarded" } = {},
) {
  const db = getDb();
  const slug = `pe-${hex()}`;
  const [client] = await db
    .insert(clients)
    .values({
      slug,
      name: slug,
      status: options.status ?? "active",
      analyticsOwnership: "open_waters",
    })
    .returning({ id: clients.id });
  const productionUrl = `https://${hex()}.example.com`;
  const [site] = await db
    .insert(sites)
    .values({
      clientId: client!.id,
      productionUrl,
      framework: "next",
      taxonomyVersion: 3,
      timezone: "Europe/London",
      replacesExistingSite: options.replaces ?? false,
    })
    .returning({ id: sites.id });
  await db
    .insert(siteTrackedPages)
    .values((options.paths ?? ["/"]).map(path => ({ siteId: site!.id, path })));
  return { siteId: site!.id, productionUrl };
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

const rowsOf = (siteId: string, source: "field" | "field_history" | "lab") =>
  getDb()
    .select()
    .from(sitePageExperience)
    .where(and(eq(sitePageExperience.siteId, siteId), eq(sitePageExperience.source, source)));

async function resultOf(runId: string, siteId: string) {
  const [row] = await getDb()
    .select()
    .from(siteSnapshotResults)
    .where(
      and(
        eq(siteSnapshotResults.runId, runId),
        eq(siteSnapshotResults.siteId, siteId),
        eq(siteSnapshotResults.source, "page_experience"),
      ),
    );
  return row;
}

describe("runPageExperiencePass", () => {
  it("records the origin and every tracked page on both form factors, and runs no lab midweek", async () => {
    const { siteId } = await newSite({ paths: ["/", "/quiet"] });
    const { deps, calls } = fakes();
    const runId = await newRun();

    await runPageExperiencePass(runId, deps(WEDNESDAY));

    const field = await rowsOf(siteId, "field");
    // Origin, / and /quiet, each on a phone and a desktop.
    expect(field).toHaveLength(6);
    const quiet = field.filter(row => row.path === "/quiet");
    expect(quiet.every(row => row.status === "not_enough_data" && row.lcpMs === null)).toBe(true);
    const origin = field.find(row => row.scope === "origin" && row.formFactor === "phone");
    expect(origin).toMatchObject({ status: "ok", lcpMs: 1_800, cls: "0.0400", day: "2026-09-23" });
    expect(await rowsOf(siteId, "lab")).toHaveLength(0);
    expect(calls.lab).toHaveLength(0);
    expect((await resultOf(runId, siteId))?.outcome).toBe("ok");
  });

  it("replaces a day's rows on a re-run rather than doubling them", async () => {
    const { siteId } = await newSite();
    const { deps } = fakes();
    await runPageExperiencePass(await newRun(), deps(WEDNESDAY));
    await runPageExperiencePass(await newRun(), deps(WEDNESDAY));
    expect(await rowsOf(siteId, "field")).toHaveLength(4);
  });

  it("fetches history once, and only for a site that replaces an old one", async () => {
    const replacing = await newSite({ replaces: true });
    const fresh = await newSite();
    const { deps } = fakes();

    await runPageExperiencePass(await newRun(), deps(WEDNESDAY));
    const first = await rowsOf(replacing.siteId, "field_history");
    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({ day: "2026-09-19", lcpMs: 2_400 });
    expect(await rowsOf(fresh.siteId, "field_history")).toHaveLength(0);

    await runPageExperiencePass(await newRun(), deps(new Date("2026-09-24T10:00:00Z")));
    expect(await rowsOf(replacing.siteId, "field_history")).toHaveLength(2);
  });

  it("runs the lab on a Monday, recording a page that did not load and carrying on", async () => {
    const { siteId } = await newSite({ paths: ["/", "/broken", "/services"] });
    const { deps } = fakes();
    const runId = await newRun();

    await runPageExperiencePass(runId, deps(MONDAY));

    const lab = await rowsOf(siteId, "lab");
    expect(lab.map(row => row.path).sort()).toEqual(["/", "/broken", "/services"]);
    expect(lab.find(row => row.path === "/")).toMatchObject({
      status: "ok",
      labScore: 92,
      lcpMs: 1_500,
      tbtMs: 90,
      formFactor: "phone",
    });
    expect(lab.find(row => row.path === "/broken")).toMatchObject({
      status: "failed",
      reason: PE_MESSAGES.pageFailed,
      labScore: null,
    });
    expect((await resultOf(runId, siteId))?.outcome).toBe("ok");
  });

  it("records a refused key as a failure with the plain message, and writes nothing", async () => {
    const { siteId } = await newSite();
    const { deps } = fakes({ refuse: true });
    const runId = await newRun();

    await runPageExperiencePass(runId, deps(MONDAY));

    const result = await resultOf(runId, siteId);
    expect(result?.outcome).toBe("failed");
    expect(result?.reason).toBe(PE_MESSAGES.configuration);
    expect(await rowsOf(siteId, "field")).toHaveLength(0);
  });

  it("does not pull an offboarded client", async () => {
    const { siteId } = await newSite({ status: "offboarded" });
    const { deps } = fakes();
    const runId = await newRun();

    await runPageExperiencePass(runId, deps(MONDAY));

    expect(await resultOf(runId, siteId)).toBeUndefined();
    expect(await rowsOf(siteId, "field")).toHaveLength(0);
  });

  it("skips every site when no key is set, and says so", async () => {
    const { siteId } = await newSite();
    const runId = await newRun();

    await runPageExperiencePass(runId, { configured: () => false, now: () => WEDNESDAY });

    const result = await resultOf(runId, siteId);
    expect(result).toMatchObject({ outcome: "skipped", reason: PE_MESSAGES.notConfigured });
  });
});

describe("runLab", () => {
  it("counts pages done on the run as each result lands", async () => {
    const { siteId, productionUrl } = await newSite({ paths: ["/", "/about"] });
    const [run] = await getDb()
      .insert(peLabRuns)
      .values({ siteId, startedAt: new Date() })
      .returning({ id: peLabRuns.id });
    const { deps } = fakes();
    const full = { concurrency: 1, ...deps(WEDNESDAY) } as PageExperienceDeps;

    expect(await runLab(siteId, productionUrl, ["/", "/about"], full, run!.id)).toBeNull();

    const [after] = await getDb().select().from(peLabRuns).where(eq(peLabRuns.id, run!.id));
    expect(after?.pagesDone).toBe(2);
    expect(await rowsOf(siteId, "lab")).toHaveLength(2);
  });
});
