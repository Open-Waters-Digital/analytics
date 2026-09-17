import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { isAllowed } from "./access";
import { createLinkSender } from "./email";
import type { Env } from "./env";
import { deliverMagicLink } from "./magic-link";

export const MAGIC_LINK_TTL_SECONDS = 15 * 60;
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SIGN_IN_RATE_LIMIT = { window: 10 * 60, max: 5 };

/**
 * The Better Auth configuration, as a factory with no import-time side effects.
 * `src/server/auth.ts` builds the app's instance lazily; the schema generator
 * builds one from placeholder values. Nothing here reads the environment.
 */
export function createAuth(config: Env, db: PostgresJsDatabase<typeof schema>) {
  const send = config.RESEND_API_KEY
    ? createLinkSender({ apiKey: config.RESEND_API_KEY, from: config.AUTH_EMAIL_FROM })
    : undefined;

  return betterAuth({
    appName: "Open Waters Analytics",
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "pg", schema, usePlural: true }),

    // Magic links are the only way in: no passwords, no social providers.
    emailAndPassword: { enabled: false },

    session: {
      expiresIn: SESSION_TTL_SECONDS,
      // Extends the session at most once a day of use: a rolling 30-day idle
      // expiry without a database write on every request.
      updateAge: 24 * 60 * 60,
    },

    // Database storage survives restarts and would hold across replicas.
    // Enabled in every environment so the limit can be tested locally.
    rateLimit: { enabled: true, storage: "database" },

    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: config.NODE_ENV === "production",
      // Railway's edge sets X-Real-IP to the connecting client; X-Forwarded-For
      // is the fallback and is only trusted when it holds a single address.
      ipAddress: { ipAddressHeaders: ["x-real-ip", "x-forwarded-for"] },
    },

    databaseHooks: {
      user: {
        create: {
          // Second line of the allowlist: no route can create an account for an
          // address that is not on it, even one added by a future plugin.
          before: async user =>
            isAllowed(user.email, config.AUTH_ALLOWED_EMAILS) ? undefined : false,
        },
      },
    },

    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SECONDS,
        storeToken: "hashed",
        rateLimit: SIGN_IN_RATE_LIMIT,
        sendMagicLink: async ({ email, url }) => {
          await deliverMagicLink(
            { email, url },
            { allowlist: config.AUTH_ALLOWED_EMAILS, nodeEnv: config.NODE_ENV, send, log: console },
          );
        },
      }),
      // Must be last: lets server actions set the session cookie.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
