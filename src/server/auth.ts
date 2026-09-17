import "server-only";
import { getDb } from "@/db/client";
import { createAuth, type Auth } from "./auth-config";
import { env } from "./env";

/**
 * The app's Better Auth instance, created on first use. Import-time creation
 * would read the environment during `next build`, which must not need secrets.
 */
let instance: Auth | undefined;

export function getAuth(): Auth {
  instance ??= createAuth(env(), getDb());
  return instance;
}
