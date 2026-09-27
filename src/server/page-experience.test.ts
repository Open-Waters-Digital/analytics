import { describe, expect, it, vi } from "vitest";
import { fieldHistory, fieldRecord, labRun } from "./page-experience";

const apiKey = "AIzaSecretPageExperienceKey";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function deps(...responses: (Response | Error)[]) {
  const queue = [...responses];
  const fetchImpl = vi.fn(async () => {
    const next = queue.shift() ?? json(500, {});
    if (next instanceof Error) throw next;
    return next;
  });
  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    apiKey,
    sleep: vi.fn(async () => {}),
    calls: fetchImpl,
  };
}

// The shape returned for a busy origin on 27 September 2026.
const record = {
  record: {
    metrics: {
      largest_contentful_paint: {
        histogram: [{ density: 0.9603 }, { density: 0.0257 }, { density: 0.014 }],
        percentiles: { p75: 852 },
      },
      interaction_to_next_paint: {
        histogram: [{ density: 0.8714 }, { density: 0.0921 }, { density: 0.0365 }],
        percentiles: { p75: 124 },
      },
      cumulative_layout_shift: {
        histogram: [{ density: 0.986 }, { density: 0.0052 }, { density: 0.0087 }],
        percentiles: { p75: "0.00" },
      },
    },
  },
};

describe("fieldRecord", () => {
  it("reads the 75th percentiles, CLS from a string, and the distributions", async () => {
    const result = await fieldRecord(
      { origin: "https://example.com" },
      "phone",
      deps(json(200, record)),
    );
    expect(result).toEqual({
      ok: true,
      value: {
        lcpMs: 852,
        inpMs: 124,
        fcpMs: null,
        ttfbMs: null,
        cls: 0,
        distribution: {
          lcp: [0.9603, 0.0257, 0.014],
          inp: [0.8714, 0.0921, 0.0365],
          cls: [0.986, 0.0052, 0.0087],
        },
      },
    });
  });

  it("reads a 404 as not enough Chrome traffic, as Luxury Gardens' Wix site returned", async () => {
    const d = deps(json(404, { error: { message: "chrome ux report data not found" } }));
    expect(await fieldRecord({ url: "https://example.com/" }, "desktop", d)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("leaves INP missing rather than guessing it", async () => {
    const withoutInp = structuredClone(record);
    delete (withoutInp.record.metrics as Record<string, unknown>)["interaction_to_next_paint"];
    const result = await fieldRecord(
      { origin: "https://example.com" },
      "phone",
      deps(json(200, withoutInp)),
    );
    expect(result.ok && result.value?.inpMs).toBeNull();
  });

  it("retries once on a rate limit, then gives up after two outages", async () => {
    const recovered = deps(json(429, {}), json(200, record));
    expect((await fieldRecord({ origin: "https://example.com" }, "phone", recovered)).ok).toBe(
      true,
    );
    expect(recovered.sleep).toHaveBeenCalledWith(2_000);
    expect(
      await fieldRecord(
        { origin: "https://example.com" },
        "phone",
        deps(json(500, {}), json(500, {})),
      ),
    ).toEqual({
      ok: false,
      failure: "unreachable",
    });
  });

  it("reads a refused key as a configuration error, and never puts the key in a result", async () => {
    const d = deps(json(400, { error: { message: `API key not valid: ${apiKey}` } }));
    const result = await fieldRecord({ origin: "https://example.com" }, "phone", d);
    expect(result).toEqual({ ok: false, failure: "configuration" });
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });

  it("is a configuration error with no key, and makes no call", async () => {
    const d = deps();
    expect(
      await fieldRecord({ origin: "https://example.com" }, "phone", { ...d, apiKey: null }),
    ).toEqual({
      ok: false,
      failure: "configuration",
    });
    expect(d.calls).not.toHaveBeenCalled();
  });

  it("reads a malformed body as unexpected", async () => {
    expect(
      await fieldRecord({ origin: "https://example.com" }, "phone", deps(json(200, { record: 1 }))),
    ).toEqual({
      ok: false,
      failure: "unexpected",
    });
  });
});

describe("fieldHistory", () => {
  it("returns one point per period with data, dated by the period's last day", async () => {
    const d = deps(
      json(200, {
        record: {
          collectionPeriods: [
            { lastDate: { year: 2026, month: 9, day: 12 } },
            { lastDate: { year: 2026, month: 9, day: 19 } },
          ],
          metrics: {
            largest_contentful_paint: {
              histogramTimeseries: [
                { densities: [null, 0.9] },
                { densities: [null, 0.07] },
                { densities: [null, 0.03] },
              ],
              percentilesTimeseries: { p75s: [null, 1_900] },
            },
          },
        },
      }),
    );
    expect(await fieldHistory("https://example.com", "phone", d)).toEqual({
      ok: true,
      value: [
        {
          day: "2026-09-19",
          lcpMs: 1_900,
          inpMs: null,
          fcpMs: null,
          ttfbMs: null,
          cls: null,
          distribution: { lcp: [0.9, 0.07, 0.03] },
        },
      ],
    });
  });
});

describe("labRun", () => {
  const lighthouse = {
    lighthouseResult: {
      categories: { performance: { score: 0.31 } },
      audits: {
        "largest-contentful-paint": { numericValue: 19_450.97 },
        "total-blocking-time": { numericValue: 1_395.5 },
        "first-contentful-paint": { numericValue: 5_266.4 },
        "speed-index": { numericValue: 12_243.1 },
        "cumulative-layout-shift": { numericValue: 0 },
      },
    },
  };

  it("reads the score as a percentage and the timings in milliseconds", async () => {
    expect(await labRun("https://example.com/", deps(json(200, lighthouse)))).toEqual({
      ok: true,
      value: { score: 31, lcpMs: 19_451, tbtMs: 1_396, fcpMs: 5_266, speedIndexMs: 12_243, cls: 0 },
    });
  });

  it("reads a page that did not load as a page failure", async () => {
    const d = deps(
      json(400, { error: { message: "Lighthouse returned error: FAILED_DOCUMENT_REQUEST." } }),
    );
    expect(await labRun("https://example.com/missing", d)).toEqual({
      ok: false,
      failure: "page_failed",
    });
  });

  it("does not retry a lab run that timed out", async () => {
    const d = deps(new DOMException("timed out", "TimeoutError"), json(200, lighthouse));
    expect(await labRun("https://example.com/", d)).toEqual({ ok: false, failure: "unreachable" });
    expect(d.calls).toHaveBeenCalledTimes(1);
  });
});
