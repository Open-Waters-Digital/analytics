import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { posthogConnections, sites } from "@/db/schema";
import { decryptApiKey, encryptApiKey, KEY_VERSION, lastFour } from "@/server/crypto";
import { credentialsKey, MissingConfigurationError } from "@/server/env";
import { checkPostHogConnection, type CheckResult } from "@/server/posthog";
import { requireSession } from "@/server/session";
import { fieldError, formError, fromZodError, ok, type Result } from "./result";
import { posthogConnectionSchema, removeSchema } from "./schemas";

export const UNREADABLE_KEY_MESSAGE = "Stored key cannot be read. Enter the key again.";
const NOT_CONFIGURED_MESSAGE =
  "Connections are unavailable: CREDENTIALS_ENCRYPTION_KEY is not set on the server.";

export interface ConnectionDeps {
  check: typeof checkPostHogConnection;
  masterKey: () => Buffer;
  now: () => Date;
}

const defaultDeps: ConnectionDeps = {
  check: checkPostHogConnection,
  masterKey: credentialsKey,
  now: () => new Date(),
};

/**
 * Adds a connection, or replaces the existing one. Nothing is written unless
 * PostHog accepts the details, so a failed replacement leaves the working
 * connection exactly as it was. A blank key when replacing reuses the stored key
 * (for a region or project ID correction).
 */
export async function savePostHogConnection(
  siteId: string,
  input: unknown,
  deps: ConnectionDeps = defaultDeps,
): Promise<Result> {
  await requireSession();
  const parsed = posthogConnectionSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const masterKey = masterKeyOrNull(deps);
  if (!masterKey) return formError(NOT_CONFIGURED_MESSAGE);

  const db = getDb();
  const [[site], [existing]] = await Promise.all([
    db.select({ id: sites.id }).from(sites).where(eq(sites.id, siteId)),
    db.select().from(posthogConnections).where(eq(posthogConnections.siteId, siteId)),
  ]);
  if (!site) return formError("That site no longer exists.");

  let apiKey = parsed.data.apiKey;
  if (!apiKey) {
    if (!existing) return fieldError("apiKey", "Enter the PostHog API key.");
    const stored = decryptApiKey(existing.apiKeyCiphertext, existing.id, masterKey);
    if (!stored.ok) return fieldError("apiKey", UNREADABLE_KEY_MESSAGE);
    apiKey = stored.apiKey;
  }

  const check = await deps.check({
    region: parsed.data.region,
    projectId: parsed.data.projectId,
    apiKey,
  });
  const failure = checkFailure(check);
  if (failure) return failure;

  const connectionId = existing?.id ?? randomUUID();
  const values = {
    region: parsed.data.region,
    projectId: parsed.data.projectId,
    apiKeyCiphertext: encryptApiKey(apiKey, connectionId, masterKey),
    keyVersion: KEY_VERSION,
    keyLast4: lastFour(apiKey),
    lastCheckAt: deps.now(),
    lastCheckStatus: "ok" as const,
    lastCheckMessage: null,
  };
  await db
    .insert(posthogConnections)
    .values({ id: connectionId, siteId, ...values })
    .onConflictDoUpdate({
      target: posthogConnections.siteId,
      set: { ...values, updatedAt: deps.now() },
    });
  return ok();
}

/**
 * Re-runs the check for a stored connection and records the outcome. A key that
 * cannot be decrypted is recorded as an error without contacting PostHog.
 */
export async function testPostHogConnection(
  siteId: string,
  deps: ConnectionDeps = defaultDeps,
): Promise<Result<CheckResult>> {
  await requireSession();

  const masterKey = masterKeyOrNull(deps);
  if (!masterKey) return formError(NOT_CONFIGURED_MESSAGE);

  const db = getDb();
  const [connection] = await db
    .select()
    .from(posthogConnections)
    .where(eq(posthogConnections.siteId, siteId));
  if (!connection) return formError("This site has no PostHog connection to test.");

  const stored = decryptApiKey(connection.apiKeyCiphertext, connection.id, masterKey);
  const result: CheckResult = stored.ok
    ? await deps.check({
        region: connection.region,
        projectId: connection.projectId,
        apiKey: stored.apiKey,
      })
    : { status: "error", message: UNREADABLE_KEY_MESSAGE };

  await db
    .update(posthogConnections)
    .set({
      lastCheckAt: deps.now(),
      lastCheckStatus: result.status,
      lastCheckMessage: result.message,
    })
    .where(eq(posthogConnections.id, connection.id));
  return ok(result);
}

export async function removePostHogConnection(siteId: string, input: unknown): Promise<Result> {
  await requireSession();
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return formError("Confirm before removing the connection.");

  await getDb().delete(posthogConnections).where(eq(posthogConnections.siteId, siteId));
  return ok();
}

function masterKeyOrNull(deps: ConnectionDeps): Buffer | null {
  try {
    return deps.masterKey();
  } catch (error) {
    if (error instanceof MissingConfigurationError) {
      console.error("registry: PostHog connections unavailable (CREDENTIALS_ENCRYPTION_KEY)");
      return null;
    }
    throw error;
  }
}

function checkFailure(check: CheckResult): Result<never> | null {
  switch (check.status) {
    case "ok":
      return null;
    case "unauthorised":
      return fieldError("apiKey", check.message ?? "PostHog rejected the key.");
    case "project_not_found":
      return fieldError("projectId", check.message ?? "PostHog could not find this project.");
    case "error":
      return formError(check.message ?? "PostHog could not be reached. Try again in a minute.");
  }
}
