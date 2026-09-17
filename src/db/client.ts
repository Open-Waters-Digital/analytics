import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/server/env";
import * as schema from "./schema";

/**
 * The connection is created on first use, never at import. `next build` imports
 * route modules to analyse them, and the build must not need a database: Railway
 * runs migrations as the pre-deploy step, after the build, and its private
 * network does not exist during a build at all (see AGENTS.md → Deploy). An
 * import-time connection would make a missing DATABASE_URL a build failure.
 *
 * One pool per process. In development it is kept on globalThis, because Next
 * reloads modules on every change and each reload would otherwise open a new
 * pool until Postgres refuses connections.
 */
type Database = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

const globalForDb = globalThis as unknown as { analyticsDb?: Database };

export function getDb(): Database {
  if (globalForDb.analyticsDb) return globalForDb.analyticsDb;

  const sql = postgres(env().DATABASE_URL, { max: 10, connect_timeout: 10, idle_timeout: 30 });
  const db = drizzle(sql, { schema, casing: "snake_case" });
  globalForDb.analyticsDb = db;
  return db;
}
