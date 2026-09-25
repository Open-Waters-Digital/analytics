import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth-schema";
import { timestamps } from "./columns";
import { sites } from "./registry-schema";

/**
 * Provisioning (openspec change add-provisioning): the record of each check and
 * apply, and the PostHog objects provisioning created.
 *
 * Neither table holds a setting's value or any key. A value is PostHog's and
 * can be read again; a key is used for one request and never kept.
 */

export const provisioningKind = pgEnum("provisioning_kind", ["check", "apply"]);
export const provisioningOutcome = pgEnum("provisioning_outcome", [
  "matched",
  "differs",
  "applied",
  "partial",
  "failed",
]);
export const provisionedKind = pgEnum("provisioned_kind", ["dashboard", "insight"]);

export const posthogProvisioningRuns = pgTable(
  "posthog_provisioning_runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    siteId: uuid()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    runBy: uuid().references(() => users.id, { onDelete: "set null" }),
    kind: provisioningKind().notNull(),
    differences: integer().notNull(),
    outcome: provisioningOutcome().notNull(),
    taxonomyVersion: integer().notNull(),
    ...timestamps,
  },
  table => [
    index("posthog_provisioning_runs_site_created_idx").on(table.siteId, table.createdAt.desc()),
    index("posthog_provisioning_runs_run_by_idx").on(table.runBy),
    check("posthog_provisioning_runs_differences_non_negative", sql`${table.differences} >= 0`),
  ],
);

/**
 * Which PostHog dashboard and insights provisioning made for a site, by their
 * contract key. PostHog's tags would have done this, but they are a paid
 * feature client organisations will not have (design D2).
 */
export const posthogProvisionedObjects = pgTable(
  "posthog_provisioned_objects",
  {
    id: uuid().primaryKey().defaultRandom(),
    siteId: uuid()
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** Part of the key, so a site moved to a new project starts clean. */
    projectId: integer().notNull(),
    kind: provisionedKind().notNull(),
    /** 'baseline' for the dashboard, else the contract's insight key. */
    contractKey: text().notNull(),
    posthogId: integer().notNull(),
    ...timestamps,
  },
  table => [
    unique("posthog_provisioned_objects_site_project_kind_key_unique").on(
      table.siteId,
      table.projectId,
      table.kind,
      table.contractKey,
    ),
    check("posthog_provisioned_objects_posthog_id_positive", sql`${table.posthogId} > 0`),
  ],
);
