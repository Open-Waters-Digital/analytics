import { z } from "zod";
import { googleApiKey } from "@/server/env";

/**
 * The Chrome UX Report and PageSpeed Insights (add-page-experience, design D1,
 * D5). One API key, restricted in Google Cloud to these two APIs.
 *
 * Confirmed on 27 September 2026 (task 1.1):
 * - `records:queryRecord` answers 404 "chrome ux report data not found" for an
 *   origin or URL Chrome has too little traffic for, which Luxury Gardens' Wix
 *   site was, on phone and desktop. That is `not_enough_data`, never a failure.
 * - A record carries `metrics.<name>.percentiles.p75`, a number except for
 *   cumulative_layout_shift, which is a string such as "0.00", and a three-bin
 *   `histogram` of `density`.
 * - `records:queryHistoryRecord` carries `collectionPeriods` (25 weekly periods,
 *   each with `firstDate` and `lastDate` as `{ year, month, day }`), and per
 *   metric `percentilesTimeseries.p75s` and `histogramTimeseries[].densities`,
 *   one entry per period; a period with too little data is null.
 * - `runPagespeed` took 11 seconds for the Open Waters site and 36 for Luxury
 *   Gardens' Wix site. `lighthouseResult.categories.performance.score` is 0 to
 *   1, and each timing is an audit's `numericValue` in milliseconds. A page that
 *   does not load answers HTTP 400, "FAILED_DOCUMENT_REQUEST".
 *
 * No `server-only` import: the nightly job runs this in plain Node. The key
 * rides in the query string, as Google requires, so no request URL is logged or
 * returned, and failures are fixed strings.
 */

export const PE_MESSAGES = {
  notConfigured: "Page experience is not configured on the server.",
  configuration: "Google refused the page experience API key on the server.",
  unreachable: "Google did not answer. Try again later.",
  unexpected: "Google returned something unexpected. Try again later.",
  pageFailed: "The page did not load for Google's test.",
} as const;

export type PeFailure = "configuration" | "unreachable" | "unexpected" | "page_failed";

export type PeResult<T> = { ok: true; value: T } | { ok: false; failure: PeFailure };

export interface PeDeps {
  fetchImpl?: typeof fetch;
  apiKey?: string | null;
  sleep?: (ms: number) => Promise<void>;
  fieldTimeoutMs?: number;
  labTimeoutMs?: number;
}

export const FIELD_TIMEOUT_MS = 10_000;
export const LAB_TIMEOUT_MS = 90_000;
const RETRY_DELAY_MS = 2_000;

export type FormFactor = "phone" | "desktop";

export interface FieldMeasurement {
  lcpMs: number | null;
  inpMs: number | null;
  fcpMs: number | null;
  ttfbMs: number | null;
  cls: number | null;
  distribution: Record<string, [number, number, number]>;
}

export interface HistoryPoint extends FieldMeasurement {
  /** The collection period's last day. */
  day: string;
}

export interface LabMeasurement {
  score: number | null;
  lcpMs: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  speedIndexMs: number | null;
  cls: number | null;
}

const METRICS = {
  largest_contentful_paint: "lcpMs",
  interaction_to_next_paint: "inpMs",
  first_contentful_paint: "fcpMs",
  experimental_time_to_first_byte: "ttfbMs",
  cumulative_layout_shift: "cls",
} as const;

const SHORT: Record<keyof typeof METRICS, string> = {
  largest_contentful_paint: "lcp",
  interaction_to_next_paint: "inp",
  first_contentful_paint: "fcp",
  experimental_time_to_first_byte: "ttfb",
  cumulative_layout_shift: "cls",
};

const FORM_FACTOR = { phone: "PHONE", desktop: "DESKTOP" } as const;

type Raw = { status: number; body: unknown };

async function request(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  retry: boolean,
  deps: PeDeps,
): Promise<Raw> {
  const { fetchImpl = fetch, sleep = defaultSleep } = deps;
  const once = async (): Promise<Raw> => {
    try {
      const response = await fetchImpl(url, {
        ...init,
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
  return result;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function keyOf(deps: PeDeps): string | null {
  return deps.apiKey === undefined ? googleApiKey() : deps.apiKey;
}

function classify(status: number, body?: unknown): PeFailure | null {
  if (status === 401 || status === 403) return "configuration";
  // Google answers a refused key with a 400 naming it.
  if (status === 400 && /api key/i.test(JSON.stringify(body ?? ""))) return "configuration";
  if (status === 0 || status === 429 || status >= 500) return "unreachable";
  if (status < 200 || status >= 300) return "unexpected";
  return null;
}

// ------------------------------------------------------------------ field data

const numberish = z.union([z.number(), z.string()]).transform(value => Number(value));

const metricSchema = z.object({
  histogram: z.array(z.object({ density: numberish.optional() })).optional(),
  percentiles: z.object({ p75: numberish.nullable().optional() }).optional(),
});

const recordSchema = z.object({
  record: z.object({ metrics: z.record(z.string(), metricSchema) }),
});

function measurement(metrics: Record<string, z.output<typeof metricSchema>>): FieldMeasurement {
  const result: FieldMeasurement = {
    lcpMs: null,
    inpMs: null,
    fcpMs: null,
    ttfbMs: null,
    cls: null,
    distribution: {},
  };
  for (const [name, field] of Object.entries(METRICS)) {
    const metric = metrics[name];
    if (!metric) continue;
    const p75 = metric.percentiles?.p75;
    if (p75 !== null && p75 !== undefined && Number.isFinite(p75)) {
      result[field] = field === "cls" ? p75 : Math.round(p75);
    }
    const densities = (metric.histogram ?? []).map(bin => bin.density ?? 0);
    if (densities.length === 3) {
      result.distribution[SHORT[name as keyof typeof METRICS]] = densities as [
        number,
        number,
        number,
      ];
    }
  }
  return result;
}

/**
 * Field data for an origin or a URL, over the last 28 days. `null` means Chrome
 * has too little traffic to report, which is normal for a small site.
 */
export async function fieldRecord(
  target: { origin: string } | { url: string },
  formFactor: FormFactor,
  deps: PeDeps = {},
): Promise<PeResult<FieldMeasurement | null>> {
  const key = keyOf(deps);
  if (!key) return { ok: false, failure: "configuration" };
  const raw = await request(
    `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...target, formFactor: FORM_FACTOR[formFactor] }),
    },
    deps.fieldTimeoutMs ?? FIELD_TIMEOUT_MS,
    true,
    deps,
  );
  if (raw.status === 404) return { ok: true, value: null };
  const failure = classify(raw.status, raw.body);
  if (failure) return { ok: false, failure };
  const parsed = recordSchema.safeParse(raw.body);
  return parsed.success
    ? { ok: true, value: measurement(parsed.data.record.metrics) }
    : { ok: false, failure: "unexpected" };
}

const dateSchema = z.object({ year: z.number(), month: z.number(), day: z.number() });

const historySchema = z.object({
  record: z.object({
    collectionPeriods: z.array(z.object({ lastDate: dateSchema })),
    metrics: z.record(
      z.string(),
      z.object({
        histogramTimeseries: z
          .array(z.object({ densities: z.array(numberish.nullable()) }))
          .optional(),
        percentilesTimeseries: z.object({ p75s: z.array(numberish.nullable()) }).optional(),
      }),
    ),
  }),
});

const isoDate = (date: z.output<typeof dateSchema>) =>
  `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;

/** About six months of weekly field data for an origin. `null`: too little traffic. */
export async function fieldHistory(
  origin: string,
  formFactor: FormFactor,
  deps: PeDeps = {},
): Promise<PeResult<HistoryPoint[] | null>> {
  const key = keyOf(deps);
  if (!key) return { ok: false, failure: "configuration" };
  const raw = await request(
    `https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin, formFactor: FORM_FACTOR[formFactor] }),
    },
    deps.fieldTimeoutMs ?? FIELD_TIMEOUT_MS,
    true,
    deps,
  );
  if (raw.status === 404) return { ok: true, value: null };
  const failure = classify(raw.status, raw.body);
  if (failure) return { ok: false, failure };
  const parsed = historySchema.safeParse(raw.body);
  if (!parsed.success) return { ok: false, failure: "unexpected" };

  const { collectionPeriods, metrics } = parsed.data.record;
  const points: HistoryPoint[] = [];
  collectionPeriods.forEach((period, index) => {
    const point: HistoryPoint = {
      day: isoDate(period.lastDate),
      lcpMs: null,
      inpMs: null,
      fcpMs: null,
      ttfbMs: null,
      cls: null,
      distribution: {},
    };
    let anything = false;
    for (const [name, field] of Object.entries(METRICS)) {
      const metric = metrics[name];
      const p75 = metric?.percentilesTimeseries?.p75s[index];
      if (p75 !== null && p75 !== undefined && Number.isFinite(p75)) {
        point[field] = field === "cls" ? p75 : Math.round(p75);
        anything = true;
      }
      const bins = (metric?.histogramTimeseries ?? []).map(bin => bin.densities[index] ?? null);
      if (bins.length === 3 && bins.every(bin => bin !== null)) {
        point.distribution[SHORT[name as keyof typeof METRICS]] = bins as [number, number, number];
      }
    }
    if (anything) points.push(point);
  });
  return { ok: true, value: points };
}

// -------------------------------------------------------------------- lab data

const labSchema = z.object({
  lighthouseResult: z.object({
    categories: z.object({ performance: z.object({ score: z.number().nullable() }) }),
    audits: z.record(z.string(), z.object({ numericValue: z.number().optional() })),
  }),
});

/** A Lighthouse run on a phone, on Google's servers. No retry: a slow run has usually failed on the site's side. */
export async function labRun(url: string, deps: PeDeps = {}): Promise<PeResult<LabMeasurement>> {
  const key = keyOf(deps);
  if (!key) return { ok: false, failure: "configuration" };
  const params = new URLSearchParams({ url, strategy: "mobile", category: "performance", key });
  const raw = await request(
    `https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`,
    { method: "GET" },
    deps.labTimeoutMs ?? LAB_TIMEOUT_MS,
    false,
    deps,
  );
  if (raw.status === 400 && classify(400, raw.body) === "configuration") {
    return { ok: false, failure: "configuration" };
  }
  if (raw.status === 400) {
    const text = JSON.stringify(raw.body ?? "");
    return {
      ok: false,
      failure:
        /FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|NO_FCP|unable to reliably load/i.test(
          text,
        )
          ? "page_failed"
          : "unexpected",
    };
  }
  const failure = classify(raw.status);
  if (failure) return { ok: false, failure };
  const parsed = labSchema.safeParse(raw.body);
  if (!parsed.success) return { ok: false, failure: "unexpected" };
  const { categories, audits } = parsed.data.lighthouseResult;
  const ms = (id: string) => {
    const value = audits[id]?.numericValue;
    return value === undefined ? null : Math.round(value);
  };
  const cls = audits["cumulative-layout-shift"]?.numericValue;
  return {
    ok: true,
    value: {
      score:
        categories.performance.score === null
          ? null
          : Math.round(categories.performance.score * 100),
      lcpMs: ms("largest-contentful-paint"),
      tbtMs: ms("total-blocking-time"),
      fcpMs: ms("first-contentful-paint"),
      speedIndexMs: ms("speed-index"),
      cls: cls === undefined ? null : Math.round(cls * 10_000) / 10_000,
    },
  };
}

export function peMessage(failure: PeFailure): string {
  switch (failure) {
    case "configuration":
      return PE_MESSAGES.configuration;
    case "unreachable":
      return PE_MESSAGES.unreachable;
    case "unexpected":
      return PE_MESSAGES.unexpected;
    case "page_failed":
      return PE_MESSAGES.pageFailed;
  }
}
