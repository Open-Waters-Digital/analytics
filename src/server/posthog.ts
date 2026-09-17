import { z } from "zod";

/**
 * The PostHog connection check: a read-only aggregate query proving a key can
 * query a project. The nightly job will use the same function.
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

export const CHECK_TIMEOUT_MS = 10_000;

export const CHECK_MESSAGES = {
  unauthorised:
    "PostHog rejected the key. Check it is a personal API key with Query Read access to this project.",
  project_not_found: "PostHog could not find this project in that region.",
  unreachable: "PostHog could not be reached. Try again in a minute.",
  unexpected: "PostHog returned something unexpected. Try again in a minute.",
} as const;

const HOSTS: Record<PostHogRegion, string> = {
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

export async function checkPostHogConnection(
  input: { region: PostHogRegion; projectId: number; apiKey: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<CheckResult> {
  const url = `${HOSTS[input.region]}/api/projects/${input.projectId}/query/`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: { kind: "HogQLQuery", query: CHECK_QUERY },
        name: "openwaters_connection_check",
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    // Timeout, DNS failure, connection reset: all "could not be reached".
    return { status: "error", message: CHECK_MESSAGES.unreachable };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return classifyCheckResponse(response.status, body);
}
