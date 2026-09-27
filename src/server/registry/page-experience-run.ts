import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { peLabRuns, sites, siteTrackedPages } from "@/db/schema";
import { PE_MESSAGES } from "@/server/page-experience";
import { STALE_RUN_MS } from "@/server/snapshots/page-experience-read";
import {
  defaultPageExperienceDeps,
  runLab,
  type PageExperienceDeps,
} from "@/server/snapshots/page-experience-pull";
import { requireSession } from "@/server/session";
import { formError, ok, type Result } from "./result";

/**
 * Run now (add-page-experience, design D4). Checks the session, records a
 * running lab run, and hands the work to `schedule` — `after()` from the
 * action — so the request returns at once. One run per site at a time; a run
 * still marked running after ten minutes counts as abandoned.
 */

export const RUN_MESSAGES = {
  alreadyRunning: "A lab run is already in progress for this site.",
  notFound: "That site no longer exists.",
  noPages: "Add a tracked page before running the lab.",
} as const;

export async function startLabRun(
  siteId: string,
  schedule: (work: () => Promise<void>) => void,
  overrides: Partial<PageExperienceDeps> = {},
): Promise<Result<{ runId: string }>> {
  const session = await requireSession();
  const deps = { ...defaultPageExperienceDeps, ...overrides };
  if (!deps.configured()) return formError(PE_MESSAGES.notConfigured);

  const db = getDb();
  const [site] = await db
    .select({ productionUrl: sites.productionUrl })
    .from(sites)
    .where(eq(sites.id, siteId));
  if (!site) return formError(RUN_MESSAGES.notFound);
  const paths = (
    await db
      .select({ path: siteTrackedPages.path })
      .from(siteTrackedPages)
      .where(eq(siteTrackedPages.siteId, siteId))
  )
    .map(row => row.path)
    .sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));
  if (paths.length === 0) return formError(RUN_MESSAGES.noPages);

  const now = deps.now();
  const runId = await db.transaction(async tx => {
    // Two presses at once must not both start: serialise on the site.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${siteId}))`);
    await tx
      .update(peLabRuns)
      .set({ status: "failed", finishedAt: now })
      .where(
        and(
          eq(peLabRuns.siteId, siteId),
          eq(peLabRuns.status, "running"),
          lt(peLabRuns.startedAt, new Date(now.getTime() - STALE_RUN_MS)),
        ),
      );
    const [running] = await tx
      .select({ id: peLabRuns.id })
      .from(peLabRuns)
      .where(and(eq(peLabRuns.siteId, siteId), eq(peLabRuns.status, "running")))
      .limit(1);
    if (running) return null;
    const [created] = await tx
      .insert(peLabRuns)
      .values({ siteId, runBy: session.user.id, startedAt: now })
      .returning({ id: peLabRuns.id });
    return created!.id;
  });
  if (!runId) return formError(RUN_MESSAGES.alreadyRunning);

  schedule(async () => {
    let failure: string | null;
    try {
      failure = await runLab(siteId, site.productionUrl, paths, deps, runId);
    } catch (error) {
      console.error(
        `page experience: lab run failed (${error instanceof Error ? error.name : "unknown"})`,
      );
      failure = PE_MESSAGES.unexpected;
    }
    await getDb()
      .update(peLabRuns)
      .set({ status: failure ? "failed" : "done", finishedAt: deps.now() })
      .where(eq(peLabRuns.id, runId));
  });
  return ok({ runId });
}
