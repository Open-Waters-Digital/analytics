import "server-only";
import { z } from "zod";
import { CHECK_TIMEOUT_MS, POSTHOG_HOSTS, type PostHogRegion } from "@/server/posthog";
import { PROJECT_FIELDS, REQUIRED_SCOPES } from "./posthog-fields";

/**
 * Provisioning's calls to PostHog: read and write the project's settings, its
 * dashboards and insights, and read the organisation's defaults and proxy.
 *
 * Every call has the 10-second check timeout, because a person is waiting, and
 * no retry, because they can press the button again (design D6). A failure is
 * one of four fixed messages. PostHog's own error text, and the key, never
 * leave this module: a project response carries the project's secret tokens,
 * so only the named settings are kept from it.
 */

export interface ProvisioningConnection {
  region: PostHogRegion;
  projectId: number;
  apiKey: string;
}

export const PROVISIONING_MESSAGES = {
  unauthorised: `PostHog rejected the key. It needs these scopes on this project: ${REQUIRED_SCOPES.join(", ")}.`,
  not_found: "PostHog could not find this project, or something in it, in that region.",
  unreachable: "PostHog could not be reached. Try again in a minute.",
  unexpected: "PostHog returned something unexpected. Try again in a minute.",
} as const;

export type ProvisioningFailure = keyof typeof PROVISIONING_MESSAGES;

export type CallResult<T> = { ok: true; value: T } | { ok: false; failure: ProvisioningFailure };

export interface ClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function call<T>(
  connection: ProvisioningConnection,
  path: string,
  schema: z.ZodType<T>,
  init: { method?: "GET" | "POST" | "PATCH"; body?: unknown } = {},
  options: ClientOptions = {},
): Promise<CallResult<T>> {
  const { fetchImpl = fetch, timeoutMs = CHECK_TIMEOUT_MS } = options;
  const url = path.startsWith("https://")
    ? path
    : `${POSTHOG_HOSTS[connection.region]}/api/${path}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${connection.apiKey}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    return { ok: false, failure: "unreachable" };
  }

  if (response.status === 401 || response.status === 403)
    return { ok: false, failure: "unauthorised" };
  if (response.status === 404) return { ok: false, failure: "not_found" };
  if (response.status === 429 || response.status >= 500)
    return { ok: false, failure: "unreachable" };
  if (response.status < 200 || response.status >= 300) return { ok: false, failure: "unexpected" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, failure: "unexpected" };
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, failure: "unexpected" };
}

// ------------------------------------------------------------------ project

const projectSchema = z
  .object({ organization: z.string().optional() })
  .catchall(z.unknown())
  .transform(raw => {
    const settings: Record<string, unknown> = {};
    for (const field of Object.values(PROJECT_FIELDS)) settings[field] = raw[field];
    return { organisationId: raw.organization ?? null, settings };
  });

export type ProjectState = z.output<typeof projectSchema>;

export function readProject(
  connection: ProvisioningConnection,
  options?: ClientOptions,
): Promise<CallResult<ProjectState>> {
  return call(connection, `projects/${connection.projectId}/`, projectSchema, {}, options);
}

export async function patchProject(
  connection: ProvisioningConnection,
  settings: Record<string, unknown>,
  options?: ClientOptions,
): Promise<CallResult<null>> {
  const result = await call(
    connection,
    `projects/${connection.projectId}/`,
    z.unknown(),
    { method: "PATCH", body: settings },
    options,
  );
  return result.ok ? { ok: true, value: null } : result;
}

// ------------------------------------------------------ dashboards and insights

const objectSchema = z.object({
  id: z.number().int().positive(),
  description: z.string().nullable().optional(),
  deleted: z.boolean().optional(),
});

const dashboardSchema = objectSchema;
const insightSchema = objectSchema.extend({
  dashboards: z.array(z.number()).optional(),
  query: z.unknown().optional(),
});

export type PostHogDashboard = z.output<typeof dashboardSchema>;
export type PostHogInsight = z.output<typeof insightSchema>;

function pageOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({ results: z.array(item), next: z.string().nullable().optional() });
}

/** Up to ten pages of a hundred, which is far beyond any client's project. */
const MAX_PAGES = 10;

async function listAll<T>(
  connection: ProvisioningConnection,
  path: string,
  item: z.ZodType<T>,
  options?: ClientOptions,
): Promise<CallResult<T[]>> {
  const collected: T[] = [];
  let next: string | null = `projects/${connection.projectId}/${path}/?limit=100`;
  for (let page = 0; next && page < MAX_PAGES; page += 1) {
    const result: CallResult<{ results: T[]; next?: string | null }> = await call(
      connection,
      next,
      pageOf(item) as unknown as z.ZodType<{ results: T[]; next?: string | null }>,
      {},
      options,
    );
    if (!result.ok) return result;
    collected.push(...result.value.results);
    next = result.value.next ?? null;
    // The key goes with every request, so a next link is followed only on the
    // region's own host.
    if (next && !next.startsWith(`${POSTHOG_HOSTS[connection.region]}/api/`)) {
      return { ok: false, failure: "unexpected" };
    }
  }
  return { ok: true, value: collected };
}

export function listDashboards(
  connection: ProvisioningConnection,
  options?: ClientOptions,
): Promise<CallResult<PostHogDashboard[]>> {
  return listAll(connection, "dashboards", dashboardSchema, options);
}

export function listInsights(
  connection: ProvisioningConnection,
  options?: ClientOptions,
): Promise<CallResult<PostHogInsight[]>> {
  return listAll(connection, "insights", insightSchema, options);
}

const createdSchema = z.object({ id: z.number().int().positive() });

export async function createDashboard(
  connection: ProvisioningConnection,
  body: { name: string; description: string },
  options?: ClientOptions,
): Promise<CallResult<number>> {
  const result = await call(
    connection,
    `projects/${connection.projectId}/dashboards/`,
    createdSchema,
    { method: "POST", body },
    options,
  );
  return result.ok ? { ok: true, value: result.value.id } : result;
}

export async function createInsight(
  connection: ProvisioningConnection,
  body: { name: string; description: string; query: unknown; dashboards: number[] },
  options?: ClientOptions,
): Promise<CallResult<number>> {
  const result = await call(
    connection,
    `projects/${connection.projectId}/insights/`,
    createdSchema,
    { method: "POST", body: { ...body, saved: true } },
    options,
  );
  return result.ok ? { ok: true, value: result.value.id } : result;
}

export async function patchInsight(
  connection: ProvisioningConnection,
  id: number,
  body: { query?: unknown; dashboards?: number[] },
  options?: ClientOptions,
): Promise<CallResult<null>> {
  const result = await call(
    connection,
    `projects/${connection.projectId}/insights/${id}/`,
    z.unknown(),
    { method: "PATCH", body },
    options,
  );
  return result.ok ? { ok: true, value: null } : result;
}

// ---------------------------------------------------------------- organisation

export interface OrganisationReport {
  discardsIpsByDefault: boolean | null;
  proxyDomains: { domain: string; live: boolean }[];
}

const organisationSchema = z.object({ default_anonymize_ips: z.boolean().optional() });
const proxySchema = z.object({
  results: z.array(z.object({ domain: z.string(), status: z.string().optional() })),
});

/** What provisioning only reports. A failure here never fails a check. */
export async function readOrganisationReport(
  connection: ProvisioningConnection,
  organisationId: string,
  options?: ClientOptions,
): Promise<CallResult<OrganisationReport>> {
  const [organisation, proxies] = await Promise.all([
    call(connection, `organizations/${organisationId}/`, organisationSchema, {}, options),
    call(connection, `organizations/${organisationId}/proxy_records/`, proxySchema, {}, options),
  ]);
  if (!organisation.ok) return organisation;
  if (!proxies.ok) return proxies;
  return {
    ok: true,
    value: {
      discardsIpsByDefault: organisation.value.default_anonymize_ips ?? null,
      proxyDomains: proxies.value.results.map(record => ({
        domain: record.domain,
        live: record.status === "valid",
      })),
    },
  };
}
