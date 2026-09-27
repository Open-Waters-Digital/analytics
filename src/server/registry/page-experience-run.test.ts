import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import { peLabRuns, sitePageExperience, users } from "@/db/schema";
import { PE_MESSAGES } from "@/server/page-experience";
import type { PageExperienceDeps } from "@/server/snapshots/page-experience-pull";
import { TEST_USER_ID, testSession, UnauthorisedError } from "@/test/mock-session";
import { createClient } from "./clients";
import { RUN_MESSAGES, startLabRun } from "./page-experience-run";
import { createSite } from "./sites";

vi.mock("@/server/session", () => import("@/test/mock-session"));

const hex = () => randomBytes(4).toString("hex");
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const lighthouse = {
  lighthouseResult: {
    categories: { performance: { score: 0.88 } },
    audits: { "largest-contentful-paint": { numericValue: 1_700 } },
  },
};

async function newSite(trackedPages = "/contact") {
  const slug = `pe-run-${hex()}`;
  await createClient({ name: slug, slug, analyticsOwnership: "open_waters" });
  const created = await createSite(slug, {
    productionUrl: `https://${hex()}.example.com`,
    framework: "next",
    taxonomyVersion: "3",
    trackedPages,
  });
  if (!created.ok) throw new Error("site not created");
  return created.value.siteId;
}

function harness() {
  const fetchImpl = vi.fn(async () => json(200, lighthouse));
  const scheduled: (() => Promise<void>)[] = [];
  const deps: Partial<PageExperienceDeps> = {
    configured: () => true,
    pe: { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: "key", sleep: async () => {} },
  };
  return {
    fetchImpl,
    scheduled,
    schedule: (work: () => Promise<void>) => scheduled.push(work),
    deps,
  };
}

const latestRun = async (siteId: string) =>
  (
    await getDb()
      .select()
      .from(peLabRuns)
      .where(eq(peLabRuns.siteId, siteId))
      .orderBy(desc(peLabRuns.startedAt))
      .limit(1)
  )[0];

beforeAll(async () => {
  await getDb()
    .insert(users)
    .values({ id: TEST_USER_ID, name: "Test", email: "test@openwaters.digital" })
    .onConflictDoNothing();
});

beforeEach(() => {
  testSession.signedIn = true;
});

describe("startLabRun", () => {
  it("records a running run, returns at once, and measures every tracked page when the work runs", async () => {
    const siteId = await newSite();
    const h = harness();

    const result = await startLabRun(siteId, h.schedule, h.deps);

    expect(result.ok).toBe(true);
    expect(h.fetchImpl).not.toHaveBeenCalled();
    expect((await latestRun(siteId))?.status).toBe("running");

    await h.scheduled[0]!();
    const run = await latestRun(siteId);
    expect(run).toMatchObject({ status: "done", pagesDone: 2, runBy: TEST_USER_ID });
    const lab = await getDb()
      .select()
      .from(sitePageExperience)
      .where(and(eq(sitePageExperience.siteId, siteId), eq(sitePageExperience.source, "lab")));
    expect(lab.map(row => row.path).sort()).toEqual(["/", "/contact"]);
  });

  it("refuses a signed-out request before any call or row", async () => {
    const siteId = await newSite();
    const h = harness();
    testSession.signedIn = false;

    await expect(startLabRun(siteId, h.schedule, h.deps)).rejects.toBeInstanceOf(UnauthorisedError);
    expect(h.scheduled).toHaveLength(0);
    expect(await latestRun(siteId)).toBeUndefined();
  });

  it("refuses a second press while a run is in progress", async () => {
    const siteId = await newSite();
    const h = harness();
    expect((await startLabRun(siteId, h.schedule, h.deps)).ok).toBe(true);

    const again = await startLabRun(siteId, h.schedule, h.deps);

    expect(again).toMatchObject({ ok: false, formError: RUN_MESSAGES.alreadyRunning });
    expect(h.scheduled).toHaveLength(1);
  });

  it("releases a run left running for more than ten minutes", async () => {
    const siteId = await newSite();
    const [stale] = await getDb()
      .insert(peLabRuns)
      .values({ siteId, startedAt: new Date(Date.now() - 11 * 60 * 1000) })
      .returning({ id: peLabRuns.id });
    const h = harness();

    expect((await startLabRun(siteId, h.schedule, h.deps)).ok).toBe(true);

    const [released] = await getDb().select().from(peLabRuns).where(eq(peLabRuns.id, stale!.id));
    expect(released?.status).toBe("failed");
  });

  it("marks the run failed when Google refuses the key", async () => {
    const siteId = await newSite();
    const h = harness();
    h.fetchImpl.mockImplementation(async () =>
      json(400, { error: { message: "API key not valid" } }),
    );

    await startLabRun(siteId, h.schedule, h.deps);
    await h.scheduled[0]!();

    expect((await latestRun(siteId))?.status).toBe("failed");
  });

  it("says the server is not configured when no key is set", async () => {
    const siteId = await newSite();
    const h = harness();
    expect(await startLabRun(siteId, h.schedule, { ...h.deps, configured: () => false })).toEqual({
      ok: false,
      fieldErrors: {},
      formError: PE_MESSAGES.notConfigured,
    });
  });
});
