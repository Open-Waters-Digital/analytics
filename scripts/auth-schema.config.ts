/**
 * Input for Better Auth's schema generator only (`pnpm auth:schema`). It builds
 * the real configuration from placeholders so the generated tables match
 * exactly what the app runs, without needing secrets or a database.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { createAuth } from "../src/server/auth-config";

export const auth = createAuth(
  {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://placeholder@localhost:5432/placeholder",
    BETTER_AUTH_SECRET: "placeholder-secret-for-schema-generation-only",
    BETTER_AUTH_URL: "http://localhost:3000",
    AUTH_EMAIL_FROM: "placeholder@example.com",
    AUTH_ALLOWED_EMAILS: new Set(["placeholder@example.com"]),
    RESEND_API_KEY: undefined,
  },
  // postgres() connects lazily, so no connection is ever opened here.
  drizzle(postgres("postgres://placeholder@localhost:5432/placeholder"), { schema }),
);
