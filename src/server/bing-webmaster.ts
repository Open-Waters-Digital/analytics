import { z } from "zod";
import { bingWebmasterApiKey } from "@/server/env";
import { CHECK_TIMEOUT_MS, QUERY_TIMEOUT_MS } from "@/server/posthog";

/**
 * Talking to Bing Webmaster Tools as the Open Waters account (add-search-console,
 * design D5a, D7, D8).
 *
 * Confirmed on 25 September 2026 with the account's key and no site shared
 * (task 1.2, first half):
 * - `GetUserSites` answers 200 `{"d": []}`.
 * - A statistics call for a site the account cannot see answers **HTTP 400**,
 *   `{"ErrorCode": 14, "Message": "ERROR!!! NotAuthorized"}`, whether or not
 *   the site exists.
 *
 * Still to confirm with a shared site (task 1.2, second half): the statistics'
 * row shapes, whether query and page statistics are daily or weekly, the
 * timezone of their dates, and the response to a bad key. The schemas below
 * follow Bing's published API reference: dates arrive as `/Date(ms)/` or
 * `/Date(ms±hhmm)/`.
 *
 * No `server-only` import: the nightly job runs this in plain Node, where that
 * marker throws, as with ./posthog.ts.
 *
 * The key travels in the query string, as Bing requires, so no request URL is
 * ever logged or returned. Bing's error text never leaves this module.
 */

export const BING_MESSAGES = {
  noAccess:
    "Not shared with the Open Waters Bing account, or not a Bing site. Check the URL, and add analytics@openwaters.digital as a read-only user.",
  unreachable: "Bing did not answer. Try again in a minute.",
  unexpected: "Bing returned something unexpected. Try again in a minute.",
  configuration: "The Bing API key on the server was refused.",
  notConfigured: "Bing is not configured on the server.",
} as const;

export type BingFailure = "no_access" | "unreachable" | "unexpected" | "configuration";

export type BingResult<T> = { ok: true; value: T } | { ok: false; failure: BingFailure };

export interface BingDeps {
  fetchImpl?: typeof fetch;
  apiKey?: string | null;
  sleep?: (ms: number) => Promise<void>;
  checkTimeoutMs?: number;
  queryTimeoutMs?: number;
}

const API = "https://ssl.bing.com/webmaster/api.svc/json";
const RETRY_DELAY_MS = 2_000;
const NOT_AUTHORISED = 14;

const errorSchema = z.object({ ErrorCode: z.number(), Message: z.string().optional() });

async function call<T>(
  method: string,
  params: Record<string, string>,
  schema: z.ZodType<T>,
  timeoutMs: number,
  retry: boolean,
  deps: BingDeps,
): Promise<BingResult<T>> {
  const apiKey = deps.apiKey === undefined ? bingWebmasterApiKey() : deps.apiKey;
  if (!apiKey) return { ok: false, failure: "configuration" };
  const { fetchImpl = fetch, sleep = defaultSleep } = deps;
  const url = `${API}/${method}?${new URLSearchParams({ ...params, apikey: apiKey })}`;

  const once = async (): Promise<{ status: number; body: unknown }> => {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
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

  const retryable = (status: number) => status === 0 || status === 429 || status >= 500;
  let result = await once();
  if (retry && retryable(result.status)) {
    await sleep(RETRY_DELAY_MS);
    result = await once();
  }

  if (result.status === 400) {
    const error = errorSchema.safeParse(result.body);
    if (error.success && error.data.ErrorCode === NOT_AUTHORISED) {
      return { ok: false, failure: "no_access" };
    }
    if (error.success && /api\s*key/i.test(error.data.Message ?? "")) {
      return { ok: false, failure: "configuration" };
    }
    return { ok: false, failure: "unexpected" };
  }
  if (result.status === 401 || result.status === 403)
    return { ok: false, failure: "configuration" };
  if (retryable(result.status)) return { ok: false, failure: "unreachable" };
  if (result.status < 200 || result.status >= 300) return { ok: false, failure: "unexpected" };
  const parsed = schema.safeParse(result.body);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, failure: "unexpected" };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Bing's `/Date(ms)/` or `/Date(ms±hhmm)/`, as a UTC calendar day. */
export function bingDay(value: string): string | null {
  const match = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1])).toISOString().slice(0, 10);
}

function sameSite(a: string, b: string): boolean {
  const normalise = (value: string) => value.trim().toLowerCase().replace(/\/+$/, "");
  return normalise(a) === normalise(b);
}

// ---------------------------------------------------------------- the check

const sitesSchema = z.object({ d: z.array(z.object({ Url: z.string() })) });

/** Whether the Open Waters account can see the site (design D7). */
export async function checkSite(
  siteUrl: string,
  deps: BingDeps = {},
): Promise<BingResult<"readable">> {
  const result = await call(
    "GetUserSites",
    {},
    sitesSchema,
    deps.checkTimeoutMs ?? CHECK_TIMEOUT_MS,
    false,
    deps,
  );
  if (!result.ok) return result;
  return result.value.d.some(site => sameSite(site.Url, siteUrl))
    ? { ok: true, value: "readable" }
    : { ok: false, failure: "no_access" };
}

// ---------------------------------------------------------------- statistics

export interface BingRow {
  day: string;
  /** The query or page; '' for site totals. */
  value: string;
  clicks: number;
  impressions: number;
  /** Average position where Bing reports one, else null. */
  position: number | null;
}

const trafficSchema = z.object({
  d: z.array(
    z.object({
      Date: z.string(),
      Clicks: z.number().nonnegative(),
      Impressions: z.number().nonnegative(),
    }),
  ),
});

const statsSchema = z.object({
  d: z.array(
    z.object({
      Query: z.string(),
      Date: z.string(),
      Clicks: z.number().nonnegative(),
      Impressions: z.number().nonnegative(),
      AvgImpressionPosition: z.number().optional(),
    }),
  ),
});

/** The site's clicks and impressions per day. */
export async function siteTraffic(
  siteUrl: string,
  deps: BingDeps = {},
): Promise<BingResult<BingRow[]>> {
  const result = await call(
    "GetRankAndTrafficStats",
    { siteUrl },
    trafficSchema,
    deps.queryTimeoutMs ?? QUERY_TIMEOUT_MS,
    true,
    deps,
  );
  if (!result.ok) return result;
  const rows: BingRow[] = [];
  for (const row of result.value.d) {
    const day = bingDay(row.Date);
    if (day)
      rows.push({
        day,
        value: "",
        clicks: row.Clicks,
        impressions: row.Impressions,
        position: null,
      });
  }
  return { ok: true, value: rows };
}

async function stats(
  method: "GetQueryStats" | "GetPageStats",
  siteUrl: string,
  deps: BingDeps,
): Promise<BingResult<BingRow[]>> {
  const result = await call(
    method,
    { siteUrl },
    statsSchema,
    deps.queryTimeoutMs ?? QUERY_TIMEOUT_MS,
    true,
    deps,
  );
  if (!result.ok) return result;
  const rows: BingRow[] = [];
  for (const row of result.value.d) {
    const day = bingDay(row.Date);
    if (!day) continue;
    rows.push({
      day,
      value: row.Query.slice(0, 200),
      clicks: row.Clicks,
      impressions: row.Impressions,
      position:
        row.AvgImpressionPosition && row.AvgImpressionPosition > 0
          ? row.AvgImpressionPosition
          : null,
    });
  }
  return { ok: true, value: rows };
}

export function queryStats(siteUrl: string, deps: BingDeps = {}): Promise<BingResult<BingRow[]>> {
  return stats("GetQueryStats", siteUrl, deps);
}

export function pageStats(siteUrl: string, deps: BingDeps = {}): Promise<BingResult<BingRow[]>> {
  return stats("GetPageStats", siteUrl, deps);
}
