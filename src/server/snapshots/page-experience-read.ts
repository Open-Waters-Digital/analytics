import "server-only";
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  peLabRuns,
  sitePageExperience,
  sitePerformanceBudgets,
  siteTrackedPages,
} from "@/db/schema";
import { labBelowTarget, verdictFor, type Budget, type Verdict } from "@/lib/page-experience";
import { requireSession } from "@/server/session";

/**
 * What the client page reads about page experience (add-page-experience,
 * design D6). Session-checked. Verdicts come from the latest origin field row
 * per form factor; the lab results carry a site Chrome cannot report on yet.
 */

/** A running lab run older than this is treated as abandoned (design D4). */
export const STALE_RUN_MS = 10 * 60 * 1000;
const TREND_MONTHS = 3;

export interface FormFactorReport {
  verdict: Verdict;
  latest: { day: string; lcpMs: number | null; inpMs: number | null; cls: number | null } | null;
  /** The last field value in each of the last three months, oldest first. */
  months: { month: string; lcpMs: number | null; inpMs: number | null; cls: number | null }[];
}

export interface PageExperienceReport {
  budget: Budget | null;
  phone: FormFactorReport;
  desktop: FormFactorReport;
  lab: {
    path: string;
    day: string | null;
    score: number | null;
    belowTarget: boolean;
    lcpMs: number | null;
    tbtMs: number | null;
    cls: number | null;
    failed: string | null;
  }[];
  runInProgress: boolean;
}

const numberOrNull = (value: string | null) => (value === null ? null : Number(value));

export async function getPageExperienceReport(
  siteId: string,
  now: Date = new Date(),
): Promise<PageExperienceReport> {
  await requireSession();
  const db = getDb();
  const since = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [budgetRow, tracked, rows, run] = await Promise.all([
    db.select().from(sitePerformanceBudgets).where(eq(sitePerformanceBudgets.siteId, siteId)),
    db
      .select({ path: siteTrackedPages.path })
      .from(siteTrackedPages)
      .where(eq(siteTrackedPages.siteId, siteId)),
    db
      .select()
      .from(sitePageExperience)
      .where(and(eq(sitePageExperience.siteId, siteId), gte(sitePageExperience.day, since)))
      .orderBy(desc(sitePageExperience.day)),
    db
      .select({ status: peLabRuns.status, startedAt: peLabRuns.startedAt })
      .from(peLabRuns)
      .where(eq(peLabRuns.siteId, siteId))
      .orderBy(desc(peLabRuns.startedAt))
      .limit(1),
  ]);

  const stored = budgetRow[0];
  const budget: Budget | null = stored
    ? {
        lcpMs: stored.lcpMs,
        inpMs: stored.inpMs,
        cls: numberOrNull(stored.cls),
        labScore: stored.labScore,
      }
    : null;

  const formFactor = (factor: "phone" | "desktop"): FormFactorReport => {
    const origin = rows.filter(
      row =>
        row.scope === "origin" &&
        row.formFactor === factor &&
        (row.source === "field" || row.source === "field_history"),
    );
    const latest = origin[0] ?? null;
    const byMonth = new Map<string, (typeof origin)[number]>();
    for (const row of origin) {
      if (row.status !== "ok") continue;
      const month = row.day.slice(0, 7);
      if (!byMonth.has(month)) byMonth.set(month, row);
    }
    return {
      verdict: verdictFor(
        latest
          ? {
              status: latest.status,
              lcpMs: latest.lcpMs,
              inpMs: latest.inpMs,
              cls: numberOrNull(latest.cls),
            }
          : null,
        budget,
      ),
      latest:
        latest && latest.status === "ok"
          ? {
              day: latest.day,
              lcpMs: latest.lcpMs,
              inpMs: latest.inpMs,
              cls: numberOrNull(latest.cls),
            }
          : null,
      months: [...byMonth.entries()]
        .slice(0, TREND_MONTHS)
        .reverse()
        .map(([month, row]) => ({
          month,
          lcpMs: row.lcpMs,
          inpMs: row.inpMs,
          cls: numberOrNull(row.cls),
        })),
    };
  };

  const paths = tracked
    .map(row => row.path)
    .sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));
  const lab = paths.map(path => {
    const row = rows.find(candidate => candidate.source === "lab" && candidate.path === path);
    return {
      path,
      day: row?.day ?? null,
      score: row?.labScore ?? null,
      belowTarget: labBelowTarget(row?.labScore ?? null, budget),
      lcpMs: row?.lcpMs ?? null,
      tbtMs: row?.tbtMs ?? null,
      cls: numberOrNull(row?.cls ?? null),
      failed: row?.status === "failed" ? row.reason : null,
    };
  });

  const latestRun = run[0];
  return {
    budget,
    phone: formFactor("phone"),
    desktop: formFactor("desktop"),
    lab,
    runInProgress:
      latestRun?.status === "running" &&
      now.getTime() - latestRun.startedAt.getTime() < STALE_RUN_MS,
  };
}
