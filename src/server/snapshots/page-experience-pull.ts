import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  clients,
  peLabRuns,
  sitePageExperience,
  siteSnapshotResults,
  sites,
  siteTrackedPages,
} from "@/db/schema";
import { googleApiKey } from "@/server/env";
import {
  fieldHistory,
  fieldRecord,
  labRun,
  PE_MESSAGES,
  peMessage,
  type FieldMeasurement,
  type FormFactor,
  type PeDeps,
} from "@/server/page-experience";
import { mapWithConcurrency } from "./concurrency";

/**
 * The page experience pass (add-page-experience, design D3, D4). Runs in the
 * nightly job after search, and its lab half also runs from Run now. Like
 * ./collect.ts and ./search.ts it works as the system, with no session.
 */

export interface PageExperienceDeps {
  now: () => Date;
  pe: PeDeps;
  concurrency: number;
  configured: () => boolean;
}

export const defaultPageExperienceDeps: PageExperienceDeps = {
  now: () => new Date(),
  pe: {},
  concurrency: 3,
  configured: () => googleApiKey() !== null,
};

export interface PageExperienceResult {
  siteId: string;
  clientSlug: string;
  outcome: "ok" | "failed" | "skipped";
  reason: string | null;
  durationMs: number;
}

const FORM_FACTORS: FormFactor[] = ["phone", "desktop"];

type Row = typeof sitePageExperience.$inferInsert;

function fieldRow(
  siteId: string,
  day: string,
  source: "field" | "field_history",
  scope: "origin" | "page",
  path: string,
  formFactor: FormFactor,
  value: FieldMeasurement | null,
): Row {
  return {
    siteId,
    day,
    source,
    scope,
    path,
    formFactor,
    status: value ? "ok" : "not_enough_data",
    lcpMs: value?.lcpMs ?? null,
    inpMs: value?.inpMs ?? null,
    fcpMs: value?.fcpMs ?? null,
    ttfbMs: value?.ttfbMs ?? null,
    cls: value?.cls === null || value?.cls === undefined ? null : String(value.cls),
    distribution: value?.distribution ?? null,
  };
}

/** Replaces the rows for a site, day and source, so a re-run never doubles. */
async function replaceRows(
  siteId: string,
  source: "field" | "field_history" | "lab",
  days: string[],
  rows: Row[],
): Promise<void> {
  if (rows.length === 0) return;
  await getDb().transaction(async tx => {
    for (const day of new Set(days)) {
      await tx
        .delete(sitePageExperience)
        .where(
          and(
            eq(sitePageExperience.siteId, siteId),
            eq(sitePageExperience.source, source),
            eq(sitePageExperience.day, day),
          ),
        );
    }
    await tx.insert(sitePageExperience).values(rows);
  });
}

interface Candidate {
  siteId: string;
  clientSlug: string;
  productionUrl: string;
  replacesExistingSite: boolean;
  paths: string[];
}

async function candidates(): Promise<Candidate[]> {
  const db = getDb();
  const siteRows = await db
    .select({
      siteId: sites.id,
      clientSlug: clients.slug,
      productionUrl: sites.productionUrl,
      replacesExistingSite: sites.replacesExistingSite,
    })
    .from(sites)
    .innerJoin(clients, eq(clients.id, sites.clientId))
    .where(ne(clients.status, "offboarded"))
    .orderBy(clients.slug, sites.productionUrl);
  const tracked = await db.select().from(siteTrackedPages);
  return siteRows.map(site => ({
    ...site,
    paths: tracked
      .filter(row => row.siteId === site.siteId)
      .map(row => row.path)
      .sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b))),
  }));
}

const pageUrl = (productionUrl: string, path: string) => new URL(path, productionUrl).toString();
const today = (now: Date) => now.toISOString().slice(0, 10);

/** Field data for the origin and every tracked page, both form factors. */
async function pullField(candidate: Candidate, deps: PageExperienceDeps): Promise<string | null> {
  const day = today(deps.now());
  const origin = new URL(candidate.productionUrl).origin;
  const rows: Row[] = [];
  for (const formFactor of FORM_FACTORS) {
    const result = await fieldRecord({ origin }, formFactor, deps.pe);
    if (!result.ok) return peMessage(result.failure);
    rows.push(fieldRow(candidate.siteId, day, "field", "origin", "", formFactor, result.value));
    for (const path of candidate.paths) {
      const page = await fieldRecord(
        { url: pageUrl(candidate.productionUrl, path) },
        formFactor,
        deps.pe,
      );
      if (!page.ok) return peMessage(page.failure);
      rows.push(fieldRow(candidate.siteId, day, "field", "page", path, formFactor, page.value));
    }
  }
  await replaceRows(candidate.siteId, "field", [day], rows);
  return null;
}

/** On a replacement site's first pull, the origin's weekly history (design D3). */
async function pullHistory(candidate: Candidate, deps: PageExperienceDeps): Promise<string | null> {
  if (!candidate.replacesExistingSite) return null;
  const [existing] = await getDb()
    .select({ one: sql<number>`1` })
    .from(sitePageExperience)
    .where(
      and(
        eq(sitePageExperience.siteId, candidate.siteId),
        eq(sitePageExperience.source, "field_history"),
      ),
    )
    .limit(1);
  if (existing) return null;

  const origin = new URL(candidate.productionUrl).origin;
  const rows: Row[] = [];
  for (const formFactor of FORM_FACTORS) {
    const result = await fieldHistory(origin, formFactor, deps.pe);
    if (!result.ok) return peMessage(result.failure);
    for (const point of result.value ?? []) {
      rows.push(
        fieldRow(candidate.siteId, point.day, "field_history", "origin", "", formFactor, point),
      );
    }
  }
  await replaceRows(
    candidate.siteId,
    "field_history",
    rows.map(row => row.day),
    rows,
  );
  return null;
}

/**
 * A lab run of every tracked page on a phone, results written as each arrives.
 * A page that does not load is recorded as failed and the others carry on; an
 * outage or a refused key stops the run.
 */
export async function runLab(
  siteId: string,
  productionUrl: string,
  paths: string[],
  deps: PageExperienceDeps,
  runId: string | null = null,
): Promise<string | null> {
  const day = today(deps.now());
  let done = 0;
  for (const path of paths) {
    const result = await labRun(pageUrl(productionUrl, path), deps.pe);
    if (!result.ok && result.failure !== "page_failed") return peMessage(result.failure);
    const row: Row = {
      siteId,
      day,
      source: "lab",
      scope: "page",
      path,
      formFactor: "phone",
      status: result.ok ? "ok" : "failed",
      reason: result.ok ? null : PE_MESSAGES.pageFailed,
      ...(result.ok
        ? {
            labScore: result.value.score,
            lcpMs: result.value.lcpMs,
            tbtMs: result.value.tbtMs,
            fcpMs: result.value.fcpMs,
            speedIndexMs: result.value.speedIndexMs,
            cls: result.value.cls === null ? null : String(result.value.cls),
          }
        : {}),
    };
    await getDb().transaction(async tx => {
      await tx
        .delete(sitePageExperience)
        .where(
          and(
            eq(sitePageExperience.siteId, siteId),
            eq(sitePageExperience.source, "lab"),
            eq(sitePageExperience.day, day),
            eq(sitePageExperience.path, path),
          ),
        );
      await tx.insert(sitePageExperience).values(row);
    });
    done += 1;
    if (runId) {
      await getDb().update(peLabRuns).set({ pagesDone: done }).where(eq(peLabRuns.id, runId));
    }
  }
  return null;
}

export async function runPageExperiencePass(
  runId: string,
  overrides: Partial<PageExperienceDeps> = {},
): Promise<PageExperienceResult[]> {
  const deps = { ...defaultPageExperienceDeps, ...overrides };
  const all = await candidates();
  const monday = deps.now().getUTCDay() === 1;

  return mapWithConcurrency(all, deps.concurrency, async candidate => {
    const started = Date.now();
    const done = (outcome: PageExperienceResult["outcome"], reason: string | null) => ({
      siteId: candidate.siteId,
      clientSlug: candidate.clientSlug,
      outcome,
      reason,
      durationMs: Date.now() - started,
    });
    let result: PageExperienceResult;
    if (!deps.configured()) {
      result = done("skipped", PE_MESSAGES.notConfigured);
    } else {
      const failed =
        (await pullField(candidate, deps)) ??
        (await pullHistory(candidate, deps)) ??
        (monday
          ? await runLab(candidate.siteId, candidate.productionUrl, candidate.paths, deps)
          : null);
      result = done(failed ? "failed" : "ok", failed);
    }
    await getDb().insert(siteSnapshotResults).values({
      runId,
      siteId: result.siteId,
      source: "page_experience",
      outcome: result.outcome,
      reason: result.reason,
      durationMs: result.durationMs,
    });
    return result;
  });
}
