import { z } from "zod";

/**
 * Talking to PostHog: one place that knows the host, the auth header, the
 * timeout and how to read a failure. The connection check and the nightly
 * snapshot both go through `runHogQlQuery`.
 *
 * Messages are fixed strings. PostHog's own error text is never shown or stored,
 * because it could echo details of the request.
 */

export type PostHogRegion = "eu" | "us";
export type CheckStatus = "ok" | "unauthorised" | "project_not_found" | "error";

export interface CheckResult {
  status: CheckStatus;
  /** Null when status is ok. */
  message: string | null;
}

export interface PostHogConnection {
  region: PostHogRegion;
  projectId: number;
  apiKey: string;
}

/** A person is waiting for this one. */
export const CHECK_TIMEOUT_MS = 10_000;
/** The snapshot's queries aggregate up to thirty days, and nobody is waiting. */
export const QUERY_TIMEOUT_MS = 30_000;
export const RETRY_DELAY_MS = 5_000;

export const CHECK_MESSAGES = {
  unauthorised:
    "PostHog rejected the key. Check it is a personal API key with Query Read access to this project.",
  project_not_found: "PostHog could not find this project in that region.",
  unreachable: "PostHog could not be reached. Try again in a minute.",
  unexpected: "PostHog returned something unexpected. Try again in a minute.",
} as const;

export const POSTHOG_HOSTS: Record<PostHogRegion, string> = {
  eu: "https://eu.posthog.com",
  us: "https://us.posthog.com",
};

const CHECK_QUERY = "SELECT count() FROM events WHERE timestamp > now() - INTERVAL 1 DAY";

// Only the shape needed to know the query ran. The count itself is discarded.
const queryResponse = z.object({ results: z.array(z.unknown()) });

export function classifyCheckResponse(status: number, body: unknown): CheckResult {
  if (status === 401 || status === 403) {
    return { status: "unauthorised", message: CHECK_MESSAGES.unauthorised };
  }
  if (status === 404) {
    return { status: "project_not_found", message: CHECK_MESSAGES.project_not_found };
  }
  if (status >= 200 && status < 300) {
    return queryResponse.safeParse(body).success
      ? { status: "ok", message: null }
      : { status: "error", message: CHECK_MESSAGES.unexpected };
  }
  if (status === 429 || status >= 500) {
    return { status: "error", message: CHECK_MESSAGES.unreachable };
  }
  return { status: "error", message: CHECK_MESSAGES.unexpected };
}

/** True for the failures that are worth trying once more: rate limits and outages. */
export function isRetryable(status: number): boolean {
  return status === 429 || status >= 500 || status === 0;
}

export interface QueryOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Shown in PostHog's own query log, so a slow query can be traced back. */
  name?: string;
}

export type QueryOutcome =
  { ok: true; body: unknown } | { ok: false; status: number; failure: CheckResult };

/**
 * Runs one HogQL query. Never throws: a transport failure becomes status 0,
 * which `isRetryable` treats like an outage.
 */
export async function runHogQlQuery(
  connection: PostHogConnection,
  query: string,
  options: QueryOptions = {},
): Promise<QueryOutcome> {
  const { fetchImpl = fetch, timeoutMs = QUERY_TIMEOUT_MS, name = "openwaters_query" } = options;
  const url = `${POSTHOG_HOSTS[connection.region]}/api/projects/${connection.projectId}/query/`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query }, name }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    // Timeout, DNS failure, connection reset: all "could not be reached".
    return {
      ok: false,
      status: 0,
      failure: { status: "error", message: CHECK_MESSAGES.unreachable },
    };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const classified = classifyCheckResponse(response.status, body);
  return classified.status === "ok"
    ? { ok: true, body }
    : { ok: false, status: response.status, failure: classified };
}

/**
 * One retry on a rate limit or an outage, then give up. Anything else (a
 * rejected key, a missing project) fails immediately: retrying cannot help.
 */
export async function runHogQlQueryWithRetry(
  connection: PostHogConnection,
  query: string,
  options: QueryOptions & { sleep?: (ms: number) => Promise<void> } = {},
): Promise<QueryOutcome> {
  const { sleep = defaultSleep, ...queryOptions } = options;
  const first = await runHogQlQuery(connection, query, queryOptions);
  if (first.ok || !isRetryable(first.status)) return first;

  await sleep(RETRY_DELAY_MS);
  return runHogQlQuery(connection, query, queryOptions);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * The connection check: a read-only aggregate query proving a key can query a
 * project. No retry, because someone is waiting for the answer and would rather
 * press the button again than wait fifteen seconds.
 */
export async function checkPostHogConnection(
  input: PostHogConnection,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<CheckResult> {
  const outcome = await runHogQlQuery(input, CHECK_QUERY, {
    fetchImpl,
    timeoutMs,
    name: "openwaters_connection_check",
  });
  return outcome.ok ? { status: "ok", message: null } : outcome.failure;
}
