import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createAuth, MAGIC_LINK_TTL_SECONDS, SESSION_TTL_SECONDS } from "./auth-config";
import { parseEnv } from "./env";

const config = parseEnv({
  DATABASE_URL: "postgres://placeholder@localhost:5432/placeholder",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  AUTH_EMAIL_FROM: "analytics@openwaters.digital",
  AUTH_ALLOWED_EMAILS: "alex@openwaters.digital",
});

// postgres() is lazy: nothing here opens a connection.
const auth = createAuth(config, drizzle(postgres(config.DATABASE_URL), { schema }));

function user(email: string) {
  const now = new Date();
  return {
    id: "00000000-0000-0000-0000-000000000000",
    email,
    name: "",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  };
}

describe("createAuth", () => {
  const before = auth.options.databaseHooks?.user?.create?.before;

  it("refuses to create a user for an address not on the allowlist", async () => {
    expect(before).toBeTypeOf("function");
    await expect(before!(user("stranger@example.com"))).resolves.toBe(false);
  });

  it("allows creating a user for an allowlisted address, in any case", async () => {
    await expect(before!(user("Alex@OpenWaters.digital"))).resolves.not.toBe(false);
  });

  it("uses 15-minute links and 30-day sessions", () => {
    expect(MAGIC_LINK_TTL_SECONDS).toBe(900);
    expect(SESSION_TTL_SECONDS).toBe(2_592_000);
    expect(auth.options.session?.expiresIn).toBe(SESSION_TTL_SECONDS);
  });

  it("has no password sign-in", () => {
    expect(auth.options.emailAndPassword?.enabled).toBe(false);
  });
});
