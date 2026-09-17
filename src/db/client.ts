import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/server/env";
import * as schema from "./schema";

/**
 * One pool per process. Next.js dev reloads modules on every change, so the
 * pool is kept on globalThis there, or each reload would open a new one until
 * Postgres refuses connections.
 */
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

function createSql(): postgres.Sql {
  return postgres(env().DATABASE_URL, { max: 10, connect_timeout: 10, idle_timeout: 30 });
}

export const sql = globalForDb.sql ?? createSql();
if (env().NODE_ENV !== "production") globalForDb.sql = sql;

export const db = drizzle(sql, { schema, casing: "snake_case" });
