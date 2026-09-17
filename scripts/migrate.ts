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

try {
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.info("migrate: up to date");
} catch (error) {
  console.error("migrate: failed", error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
