import { JWT } from "google-auth-library";
import { z } from "zod";
import { googleServiceAccount, type GoogleServiceAccount } from "@/server/env";
import { CHECK_TIMEOUT_MS, QUERY_TIMEOUT_MS } from "@/server/posthog";

/**
 * Talking to Google Search Console as the Open Waters service account
 * (add-search-console, design D1, D2, D7, D8).
 *
 * Confirmed on 25 September 2026 with the service account and no property
 * shared (task 1.1, first half):
 * - The token request works: `oauth2.googleapis.com/token`, a JWT signed with
 *   the key, scope `webmasters.readonly`, valid 3599 seconds.
 * - `GET webmasters/v3/sites` answers 200 `{}` with nothing shared.
 * - `GET webmasters/v3/sites/{siteUrl}` answers **404** "not a verified Search
 *   Console site in this account" for a property never shared, so a 404 is
 *   "no access", not "does not exist".
 * - Search Analytics and URL Inspection answer 403 for an unshared property.
 *
 * Still to confirm with a shared property (task 1.1, second half): the Search
 * Analytics row shape, paging, the earliest date, sitemaps and the inspection
 * result's fields. The schemas below follow Google's published API reference.
 *
 * No `server-only` import: the nightly job runs this in plain Node, where that
 * marker throws, as with ./posthog.ts. The lint rule that keeps src/components
 * out of src/server is what keeps it out of the browser.
 *
 * Messages are fixed strings. Google's error text never leaves this module.
 */

export const SEARCH_MESSAGES = {
  noAccess: (account: string) =>
    `Not shared with the Open Waters account, or not a Search Console property. Check the property name, and add ${account} as a restricted user.`,
  unreachable: "Google did not answer. Try again in a minute.",
  unexpected: "Google returned something unexpected. Try again in a minute.",
  configuration: "The Google service account key on the server cannot be read.",
  notConfigured: "Search Console is not configured on the server.",
} as const;

export type GoogleFailure = "no_access" | "unreachable" | "unexpected" | "configuration";

export type GoogleResult<T> = { ok: true; value: T } | { ok: false; failure: GoogleFailure };

export interface GoogleDeps {
  fetchImpl?: typeof fetch;
  /** Returns an access token, or throws. Replaced in tests. */
  token?: () => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  checkTimeoutMs?: number;
  queryTimeoutMs?: number;
}

const API = "https://searchconsole.googleapis.com";
const RETRY_DELAY_MS = 2_000;

let jwt: JWT | undefined;

async function defaultToken(account: GoogleServiceAccount): Promise<string> {
  jwt ??= new JWT({
    email: account.clientEmail,
    key: account.privateKey,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  const client = jwt;
  const { token } = await withTimeout(client.getAccessToken(), CHECK_TIMEOUT_MS);
  if (!token) throw new Error("no token");
  return token;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** The service account's email, for the "add this account" guidance. */
export function serviceAccountEmail(): string | null {
  try {
    return googleServiceAccount()?.clientEmail ?? null;
  } catch {
    return null;
  }
}

async function tokenFor(deps: GoogleDeps): Promise<GoogleResult<string>> {
  if (deps.token) {
    try {
      return { ok: true, value: await deps.token() };
    } catch {
      return { ok: false, failure: "unreachable" };
    }
  }
  let account: GoogleServiceAccount | null;
  try {
    account = googleServiceAccount();
  } catch {
    return { ok: false, failure: "configuration" };
  }
  if (!account) return { ok: false, failure: "configuration" };
  try {
    return { ok: true, value: await defaultToken(account) };
  } catch {
    // A rejected key and an unreachable token endpoint look alike from here;
    // both stop the run, and the log names neither the key nor Google's text.
    return { ok: false, failure: "unreachable" };
  }
}

async function call<T>(
  path: string,
  schema: z.ZodType<T>,
  init: { method?: "GET" | "POST"; body?: unknown; timeoutMs: number; retry: boolean },
  deps: GoogleDeps,
): Promise<GoogleResult<T>> {
  const token = await tokenFor(deps);
  if (!token.ok) return token;
  const { fetchImpl = fetch, sleep = defaultSleep } = deps;

  const once = async (): Promise<{ status: number; body: unknown }> => {
    try {
      const response = await fetchImpl(`${API}/${path}`, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${token.value}`,
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(init.timeoutMs),
        cache: "no-store",
      });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      return { status: response.status, body };
    } catch {
      return { status: 0, body: null };
    }
  };

  let result = await once();
  const retryable = (status: number) => status === 0 || status === 429 || status >= 500;
  if (init.retry && retryable(result.status)) {
    await sleep(RETRY_DELAY_MS);
    result = await once();
  }

  if (result.status === 403 || result.status === 404) return { ok: false, failure: "no_access" };
  if (retryable(result.status)) return { ok: false, failure: "unreachable" };
  if (result.status < 200 || result.status >= 300) return { ok: false, failure: "unexpected" };
  const parsed = schema.safeParse(result.body);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, failure: "unexpected" };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const siteSegment = (property: string) => encodeURIComponent(property);

// ---------------------------------------------------------------- the check

const READABLE_LEVELS = new Set(["siteOwner", "siteFullUser", "siteRestrictedUser"]);

const siteSchema = z.object({ permissionLevel: z.string() });

/** Whether the service account can read the property's data (design D7). */
export async function checkProperty(
  property: string,
  deps: GoogleDeps = {},
): Promise<GoogleResult<"readable">> {
  const result = await call(
    `webmasters/v3/sites/${siteSegment(property)}`,
    siteSchema,
    { timeoutMs: deps.checkTimeoutMs ?? CHECK_TIMEOUT_MS, retry: false },
    deps,
  );
  if (!result.ok) return result;
  return READABLE_LEVELS.has(result.value.permissionLevel)
    ? { ok: true, value: "readable" }
    : { ok: false, failure: "no_access" };
}

// ------------------------------------------------------------ search analytics

export type GoogleDimension = "date" | "device" | "query" | "page";

export interface SearchRow {
  keys: string[];
  clicks: number;
  impressions: number;
  position: number;
}

const rowsSchema = z.object({
  rows: z
    .array(
      z.object({
        keys: z.array(z.string()),
        clicks: z.number().nonnegative(),
        impressions: z.number().nonnegative(),
        position: z.number().nonnegative(),
      }),
    )
    .optional(),
});

/** Google's largest page. */
export const ROW_LIMIT = 25_000;

/**
 * One Search Analytics query, one page of it. `dataState: "all"` includes the
 * last few provisional days, which each night replaces until they settle.
 */
export async function querySearchAnalytics(
  property: string,
  request: { startDate: string; endDate: string; dimensions: GoogleDimension[]; startRow?: number },
  deps: GoogleDeps = {},
): Promise<GoogleResult<SearchRow[]>> {
  const result = await call(
    `webmasters/v3/sites/${siteSegment(property)}/searchAnalytics/query`,
    rowsSchema,
    {
      method: "POST",
      body: { ...request, rowLimit: ROW_LIMIT, startRow: request.startRow ?? 0, dataState: "all" },
      timeoutMs: deps.queryTimeoutMs ?? QUERY_TIMEOUT_MS,
      retry: true,
    },
    deps,
  );
  return result.ok ? { ok: true, value: result.value.rows ?? [] } : result;
}

// --------------------------------------------------------- sitemaps and indexing

const sitemapsSchema = z.object({
  sitemap: z.array(z.object({ path: z.string() })).optional(),
});

/** The sitemaps submitted in Search Console for the property. */
export async function listSitemaps(
  property: string,
  deps: GoogleDeps = {},
): Promise<GoogleResult<string[]>> {
  const result = await call(
    `webmasters/v3/sites/${siteSegment(property)}/sitemaps`,
    sitemapsSchema,
    { timeoutMs: deps.checkTimeoutMs ?? CHECK_TIMEOUT_MS, retry: true },
    deps,
  );
  return result.ok
    ? { ok: true, value: (result.value.sitemap ?? []).map(sitemap => sitemap.path) }
    : result;
}

export interface Inspection {
  verdict: "indexed" | "not_indexed" | "unknown";
  coverageState: string | null;
  lastCrawlAt: Date | null;
}

const inspectionSchema = z.object({
  inspectionResult: z.object({
    indexStatusResult: z
      .object({
        verdict: z.string().optional(),
        coverageState: z.string().optional(),
        lastCrawlTime: z.string().optional(),
      })
      .optional(),
  }),
});

function verdictOf(verdict: string | undefined): Inspection["verdict"] {
  if (verdict === "PASS" || verdict === "PARTIAL") return "indexed";
  if (verdict === "FAIL" || verdict === "NEUTRAL") return "not_indexed";
  return "unknown";
}

/** Google's index verdict for one page (design D5b). */
export async function inspectUrl(
  property: string,
  address: string,
  deps: GoogleDeps = {},
): Promise<GoogleResult<Inspection>> {
  const result = await call(
    "v1/urlInspection/index:inspect",
    inspectionSchema,
    {
      method: "POST",
      body: { inspectionUrl: address, siteUrl: property },
      timeoutMs: deps.queryTimeoutMs ?? QUERY_TIMEOUT_MS,
      retry: true,
    },
    deps,
  );
  if (!result.ok) return result;
  const status = result.value.inspectionResult.indexStatusResult;
  const crawled = status?.lastCrawlTime ? new Date(status.lastCrawlTime) : null;
  return {
    ok: true,
    value: {
      verdict: verdictOf(status?.verdict),
      coverageState: status?.coverageState?.slice(0, 200) ?? null,
      lastCrawlAt: crawled && !Number.isNaN(crawled.getTime()) ? crawled : null,
    },
  };
}
