/**
 * Applies pending migrations from ./drizzle. Bundled to dist/migrate.mjs at
 * build time and run by Railway's pre-deploy command, so a failed migration
 * stops the deploy before new code serves traffic. Never run on container
 * start: with more than one replica, every container would race to migrate.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { databaseEnv } from "@/server/env";

// Only DATABASE_URL: a migration must not fail because an unrelated secret is
// unset. Notices ("schema already exists, skipping") are expected on every run.
const sql = postgres(databaseEnv().DATABASE_URL, {
  max: 1,
  connect_timeout: 10,
  onnotice: () => {},
});

/** Rows in Drizzle's journal table, or 0 before the first migration creates it. */
async function appliedCount(): Promise<number> {
  // Two queries: Postgres resolves every table in a statement before running
  // it, so a single CASE still fails when the journal table does not exist.
  const [table] = await sql<{ exists: boolean }[]>`
    select to_regclass('drizzle.__drizzle_migrations') is not null as exists`;
  if (!table?.exists) return 0;
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from drizzle.__drizzle_migrations`;
  return row?.count ?? 0;
}

try {
  const before = await appliedCount();
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  const applied = (await appliedCount()) - before;
  // A distinct message for "did something" makes a deploy log answer the
  // question "did this release migrate?" at a glance.
  console.info(applied > 0 ? `migrate: applied ${applied}` : "migrate: up to date");
} catch (error) {
  console.error("migrate: failed", error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
