import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { testDatabaseUrls } from "./database-urls";

/**
 * Recreates the integration test database and applies every migration, so each
 * run starts from exactly what production would have. Runs once per `vitest`
 * invocation, before any test file.
 */
export default async function setup() {
  const urls = testDatabaseUrls(process.env);
  const databaseName = new URL(urls.test).pathname.slice(1);
  if (databaseName !== "analytics_test") {
    // A guard against ever dropping a real database.
    throw new Error(`Refusing to recreate database "${databaseName}"`);
  }

  const admin = postgres(urls.server, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${databaseName} with (force)`);
    await admin.unsafe(`create database ${databaseName}`);
  } catch (error) {
    throw new Error(
      `Integration tests need Postgres. Start it with \`pnpm db:up\`. (${(error as Error).name})`,
    );
  } finally {
    await admin.end({ timeout: 5 });
  }

  const sql = postgres(urls.test, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
