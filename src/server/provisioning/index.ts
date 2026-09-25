import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  posthogConnections,
  posthogProvisionedObjects,
  posthogProvisioningRuns,
  sites,
} from "@/db/schema";
import { requireSession } from "@/server/session";
import {
  createDashboard,
  createInsight,
  listDashboards,
  listInsights,
  patchInsight,
  patchProject,
  PROVISIONING_MESSAGES,
  readOrganisationReport,
  readProject,
  type ClientOptions,
  type OrganisationReport,
  type ProvisioningConnection,
  type ProvisioningFailure,
} from "./client";
import {
  DASHBOARD_KEY,
  DASHBOARD_NAME,
  desiredInsights,
  desiredProject,
  type DesiredInsight,
  type ProvisioningSite,
} from "./desired";
import {
  filterDifference,
  insightDifferences,
  matchObject,
  settingDifferences,
  toApply,
  type Difference,
  type RecordedObject,
} from "./diff";
import { descriptionMarker } from "./posthog-fields";

/**
 * Check and apply (add-provisioning, design D1 to D6). Both check the session
 * first, take the project from the site's stored connection and never from the
 * form, and use the partner's key for this request only: it is not stored,
 * logged or returned.
 */

export const PROVISIONING_FORM_MESSAGES = {
  noConnection:
    "Connect this site's PostHog project first, so provisioning knows which project it is.",
  keyRequired: "Paste a personal API key with the scopes listed.",
  siteNotFound: "This site no longer exists.",
} as const;

export type ProvisioningOutcome = "matched" | "differs" | "applied" | "partial" | "failed";

export interface ProvisioningReport {
  outcome: ProvisioningOutcome;
  /** What still differs after the run, held items included. */
  differences: Difference[];
  /** Steps apply completed, in plain words. Empty for a check. */
  applied: string[];
  /** A fixed message when the run failed or stopped part way. */
  message: string | null;
  organisation: OrganisationReport | null;
  projectId: number;
  region: string;
}

export type ProvisioningResult =
  { ok: true; report: ProvisioningReport } | { ok: false; formError: string };

export interface ProvisioningDeps {
  client?: ClientOptions;
}

const keySchema = z.object({ apiKey: z.string().trim().min(1).max(200) });

interface Target {
  site: ProvisioningSite & { id: string };
  connection: ProvisioningConnection;
}

async function loadTarget(siteId: string, apiKey: string): Promise<Target | string> {
  const db = getDb();
  const [row] = await db
    .select({
      id: sites.id,
      productionUrl: sites.productionUrl,
      timezone: sites.timezone,
      taxonomyVersion: sites.taxonomyVersion,
      usesHeatmaps: sites.usesHeatmaps,
      measurementTier: sites.measurementTier,
      tierConfirmedFor: sites.tierConfirmedFor,
      region: posthogConnections.region,
      projectId: posthogConnections.projectId,
    })
    .from(sites)
    .leftJoin(posthogConnections, eq(posthogConnections.siteId, sites.id))
    .where(eq(sites.id, siteId));
  if (!row) return PROVISIONING_FORM_MESSAGES.siteNotFound;
  if (row.region === null || row.projectId === null) return PROVISIONING_FORM_MESSAGES.noConnection;
  const { region, projectId, ...site } = row;
  return { site, connection: { region, projectId, apiKey } };
}

async function recordedObjects(siteId: string, projectId: number) {
  const rows = await getDb()
    .select({
      kind: posthogProvisionedObjects.kind,
      contractKey: posthogProvisionedObjects.contractKey,
      posthogId: posthogProvisionedObjects.posthogId,
    })
    .from(posthogProvisionedObjects)
    .where(
      and(
        eq(posthogProvisionedObjects.siteId, siteId),
        eq(posthogProvisionedObjects.projectId, projectId),
      ),
    );
  const pick = (kind: "dashboard" | "insight"): RecordedObject[] =>
    rows.filter(row => row.kind === kind);
  return { dashboards: pick("dashboard"), insights: pick("insight") };
}

async function remember(
  siteId: string,
  projectId: number,
  kind: "dashboard" | "insight",
  contractKey: string,
  posthogId: number,
): Promise<void> {
  await getDb()
    .insert(posthogProvisionedObjects)
    .values({ siteId, projectId, kind, contractKey, posthogId })
    .onConflictDoUpdate({
      target: [
        posthogProvisionedObjects.siteId,
        posthogProvisionedObjects.projectId,
        posthogProvisionedObjects.kind,
        posthogProvisionedObjects.contractKey,
      ],
      set: { posthogId, updatedAt: new Date() },
    });
}

interface Inspection {
  differences: Difference[];
  dashboard: { id: number; adopted: boolean } | null;
  insights: DesiredInsight[];
  insightMatches: Map<string, { id: number; adopted: boolean }>;
  organisation: OrganisationReport | null;
}

async function inspect(
  target: Target,
  options: ClientOptions | undefined,
): Promise<Inspection | ProvisioningFailure> {
  const { site, connection } = target;
  const [project, dashboards, insights, recorded] = await Promise.all([
    readProject(connection, options),
    listDashboards(connection, options),
    listInsights(connection, options),
    recordedObjects(site.id, connection.projectId),
  ]);
  if (!project.ok) return project.failure;
  if (!dashboards.ok) return dashboards.failure;
  if (!insights.ok) return insights.failure;

  const differences: Difference[] = settingDifferences(
    project.value.settings,
    desiredProject(site),
  );
  const filter = filterDifference(
    project.value.settings["test_account_filters"],
    site.productionUrl,
  );
  if (filter) differences.push(filter);

  const dashboardMatch = matchObject(DASHBOARD_KEY, recorded.dashboards, dashboards.value);
  if (!dashboardMatch.object) differences.push({ type: "dashboard", change: "missing" });
  const dashboardId = dashboardMatch.object?.id ?? null;

  const desired = desiredInsights(site.taxonomyVersion);
  differences.push(...insightDifferences(desired, recorded.insights, insights.value, dashboardId));

  const insightMatches = new Map<string, { id: number; adopted: boolean }>();
  for (const insight of desired) {
    const match = matchObject(insight.key, recorded.insights, insights.value);
    if (match.object)
      insightMatches.set(insight.key, { id: match.object.id, adopted: match.adopted });
  }

  // Only reported: a failure here never fails the check.
  const organisation = project.value.organisationId
    ? await readOrganisationReport(connection, project.value.organisationId, options)
    : null;

  return {
    differences,
    dashboard: dashboardMatch.object
      ? { id: dashboardMatch.object.id, adopted: dashboardMatch.adopted }
      : null,
    insights: desired,
    insightMatches,
    organisation: organisation?.ok ? organisation.value : null,
  };
}

async function recordRun(
  target: Target,
  runBy: string,
  kind: "check" | "apply",
  differences: number,
  outcome: ProvisioningOutcome,
): Promise<void> {
  await getDb().insert(posthogProvisioningRuns).values({
    siteId: target.site.id,
    runBy,
    kind,
    differences,
    outcome,
    taxonomyVersion: target.site.taxonomyVersion,
  });
  // Logged by id and outcome only: never a key, a value or a request body.
  console.info(
    `provisioning: ${kind} site ${target.site.id} ${outcome} (${differences} differences)`,
  );
}

function report(
  target: Target,
  inspection: Inspection,
  outcome: ProvisioningOutcome,
  applied: string[],
  message: string | null,
): ProvisioningReport {
  return {
    outcome,
    differences: inspection.differences,
    applied,
    message,
    organisation: inspection.organisation,
    projectId: target.connection.projectId,
    region: target.connection.region,
  };
}

async function prepare(
  siteId: string,
  input: unknown,
): Promise<{ target: Target; runBy: string } | { formError: string }> {
  const session = await requireSession();
  const parsed = keySchema.safeParse(input);
  if (!parsed.success) return { formError: PROVISIONING_FORM_MESSAGES.keyRequired };
  const target = await loadTarget(siteId, parsed.data.apiKey);
  if (typeof target === "string") return { formError: target };
  return { target, runBy: session.user.id };
}

/** Reads the project and reports every difference. Sends only read requests. */
export async function checkProvisioning(
  siteId: string,
  input: unknown,
  deps: ProvisioningDeps = {},
): Promise<ProvisioningResult> {
  const prepared = await prepare(siteId, input);
  if ("formError" in prepared) return { ok: false, formError: prepared.formError };
  const { target, runBy } = prepared;

  const inspection = await inspect(target, deps.client);
  if (typeof inspection === "string") {
    await recordRun(target, runBy, "check", 0, "failed");
    return { ok: false, formError: PROVISIONING_MESSAGES[inspection] };
  }
  const outcome: ProvisioningOutcome =
    toApply(inspection.differences).length === 0 ? "matched" : "differs";
  await recordRun(target, runBy, "check", toApply(inspection.differences).length, outcome);
  return { ok: true, report: report(target, inspection, outcome, [], null) };
}

/**
 * Makes each difference apply can make, in order: project settings, the
 * dashboard, then each insight. Stops at the first failure, keeping what was
 * written, and always finishes with a fresh check.
 */
export async function applyProvisioning(
  siteId: string,
  input: unknown,
  deps: ProvisioningDeps = {},
): Promise<ProvisioningResult> {
  const prepared = await prepare(siteId, input);
  if ("formError" in prepared) return { ok: false, formError: prepared.formError };
  const { target, runBy } = prepared;
  const { site, connection } = target;
  const options = deps.client;

  const before = await inspect(target, options);
  if (typeof before === "string") {
    await recordRun(target, runBy, "apply", 0, "failed");
    return { ok: false, formError: PROVISIONING_MESSAGES[before] };
  }

  const pending = toApply(before.differences);
  const applied: string[] = [];
  let failure: ProvisioningFailure | null = null;

  const step = async (
    label: string,
    run: () => Promise<{ ok: boolean; failure?: ProvisioningFailure }>,
  ) => {
    if (failure) return;
    const result = await run();
    if (result.ok) applied.push(label);
    else failure = result.failure ?? "unexpected";
  };

  // 1. Project settings and the internal-traffic filter, in one PATCH.
  const patch: Record<string, unknown> = {};
  for (const difference of pending) {
    if (difference.type === "setting") patch[difference.field] = difference.required;
    if (difference.type === "filter") patch["test_account_filters"] = difference.remaining;
  }
  if (Object.keys(patch).length > 0) {
    await step("Project settings", () => patchProject(connection, patch, options));
  }

  // 2. The dashboard: adopt a marked one, or create it.
  let dashboardId = before.dashboard?.id ?? null;
  if (before.dashboard?.adopted) {
    await remember(site.id, connection.projectId, "dashboard", DASHBOARD_KEY, before.dashboard.id);
  }
  if (dashboardId === null) {
    await step("Baseline dashboard", async () => {
      const created = await createDashboard(
        connection,
        { name: DASHBOARD_NAME, description: descriptionMarker(DASHBOARD_KEY) },
        options,
      );
      if (created.ok) {
        dashboardId = created.value;
        await remember(site.id, connection.projectId, "dashboard", DASHBOARD_KEY, created.value);
      }
      return created;
    });
  }

  // 3. Insights: record adoptions, create the missing, correct the changed.
  for (const insight of before.insights) {
    const match = before.insightMatches.get(insight.key);
    if (match?.adopted)
      await remember(site.id, connection.projectId, "insight", insight.key, match.id);
  }
  for (const difference of pending) {
    if (difference.type !== "insight" || dashboardId === null) continue;
    const insight = before.insights.find(candidate => candidate.key === difference.key);
    if (!insight) continue;
    const onDashboard = [dashboardId];
    if (difference.change === "missing") {
      await step(`Insight: ${insight.name}`, async () => {
        const created = await createInsight(
          connection,
          {
            name: insight.name,
            description: descriptionMarker(insight.key),
            query: insight.query,
            dashboards: onDashboard,
          },
          options,
        );
        if (created.ok)
          await remember(site.id, connection.projectId, "insight", insight.key, created.value);
        return created;
      });
    } else if (difference.posthogId !== null) {
      const id = difference.posthogId;
      await step(`Insight: ${insight.name}`, () =>
        patchInsight(
          connection,
          id,
          difference.change === "changed" ? { query: insight.query } : { dashboards: onDashboard },
          options,
        ),
      );
    }
  }

  const after = await inspect(target, options);
  const differences = typeof after === "string" ? before.differences : after.differences;
  const outcome: ProvisioningOutcome =
    failure === null
      ? pending.length === 0
        ? "matched"
        : "applied"
      : applied.length > 0
        ? "partial"
        : "failed";
  await recordRun(target, runBy, "apply", toApply(differences).length, outcome);

  const inspection = typeof after === "string" ? before : after;
  return {
    ok: true,
    report: report(
      target,
      inspection,
      outcome,
      applied,
      failure ? PROVISIONING_MESSAGES[failure as ProvisioningFailure] : null,
    ),
  };
}

export interface LatestRun {
  kind: "check" | "apply";
  outcome: ProvisioningOutcome;
  differences: number;
  taxonomyVersion: number;
  runAt: Date;
}

/** Each site's latest check or apply, for the client page. */
export async function latestProvisioningRuns(siteIds: string[]): Promise<Map<string, LatestRun>> {
  await requireSession();
  if (siteIds.length === 0) return new Map();
  const rows = await getDb()
    .selectDistinctOn([posthogProvisioningRuns.siteId], {
      siteId: posthogProvisioningRuns.siteId,
      kind: posthogProvisioningRuns.kind,
      outcome: posthogProvisioningRuns.outcome,
      differences: posthogProvisioningRuns.differences,
      taxonomyVersion: posthogProvisioningRuns.taxonomyVersion,
      runAt: posthogProvisioningRuns.createdAt,
    })
    .from(posthogProvisioningRuns)
    .where(inArray(posthogProvisioningRuns.siteId, siteIds))
    .orderBy(posthogProvisioningRuns.siteId, desc(posthogProvisioningRuns.createdAt));
  return new Map(rows.map(({ siteId, ...run }) => [siteId, run]));
}
