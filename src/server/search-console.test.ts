import { describe, expect, it, vi } from "vitest";
import {
  checkProperty,
  inspectUrl,
  listSitemaps,
  querySearchAnalytics,
  SEARCH_MESSAGES,
} from "./search-console";

const token = "ya29.SecretAccessToken";
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
    token: async () => token,
    sleep: vi.fn(async () => {}),
    calls: fetchImpl,
  };
}

describe("checkProperty", () => {
  it.each(["siteOwner", "siteFullUser", "siteRestrictedUser"])(
    "reads %s as readable",
    async level => {
      const d = deps(json(200, { siteUrl: "sc-domain:example.com", permissionLevel: level }));
      expect(await checkProperty("sc-domain:example.com", d)).toEqual({
        ok: true,
        value: "readable",
      });
      const [url, init] = d.calls.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(
        "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com",
      );
      expect((init.headers as Record<string, string>)["authorization"]).toBe(`Bearer ${token}`);
    },
  );

  it.each([
    ["an unverified user", json(200, { permissionLevel: "siteUnverifiedUser" })],
    ["a 403", json(403, { error: { message: "no permission for sc-domain:example.com" } })],
    ["a 404, which is also what an unshared property returns", json(404, { error: {} })],
  ])("reads %s as no access", async (_label, response) => {
    expect(await checkProperty("sc-domain:example.com", deps(response))).toEqual({
      ok: false,
      failure: "no_access",
    });
  });

  it("does not retry a check, since someone is waiting", async () => {
    const d = deps(json(500, {}), json(200, { permissionLevel: "siteOwner" }));
    expect(await checkProperty("sc-domain:example.com", d)).toEqual({
      ok: false,
      failure: "unreachable",
    });
    expect(d.calls).toHaveBeenCalledTimes(1);
  });

  it("reads a token failure as unreachable, without calling the API", async () => {
    const d = deps();
    const result = await checkProperty("sc-domain:example.com", {
      ...d,
      token: async () => {
        throw new Error("invalid_grant for key abc");
      },
    });
    expect(result).toEqual({ ok: false, failure: "unreachable" });
    expect(d.calls).not.toHaveBeenCalled();
  });
});

describe("querySearchAnalytics", () => {
  const request = { startDate: "2026-09-01", endDate: "2026-09-10", dimensions: ["date" as const] };

  it("asks for every data state and returns the rows", async () => {
    const d = deps(
      json(200, {
        rows: [{ keys: ["2026-09-01"], clicks: 3, impressions: 40, ctr: 0.075, position: 7.5 }],
      }),
    );
    expect(await querySearchAnalytics("sc-domain:example.com", request, d)).toEqual({
      ok: true,
      value: [{ keys: ["2026-09-01"], clicks: 3, impressions: 40, position: 7.5 }],
    });
    const [, init] = d.calls.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      dataState: "all",
      rowLimit: 25_000,
      startRow: 0,
    });
  });

  it("returns no rows for a period with no data", async () => {
    expect(
      await querySearchAnalytics("sc-domain:example.com", request, deps(json(200, {}))),
    ).toEqual({
      ok: true,
      value: [],
    });
  });

  it("retries once on a rate limit, then succeeds", async () => {
    const d = deps(json(429, {}), json(200, { rows: [] }));
    expect((await querySearchAnalytics("sc-domain:example.com", request, d)).ok).toBe(true);
    expect(d.sleep).toHaveBeenCalledWith(2_000);
  });

  it("gives up after two outages, and after a timeout", async () => {
    expect(
      await querySearchAnalytics(
        "sc-domain:example.com",
        request,
        deps(json(500, {}), json(502, {})),
      ),
    ).toEqual({ ok: false, failure: "unreachable" });
    const timeout = new DOMException("timed out", "TimeoutError");
    expect(
      await querySearchAnalytics("sc-domain:example.com", request, deps(timeout, timeout)),
    ).toEqual({ ok: false, failure: "unreachable" });
  });

  it("reads a malformed body as unexpected", async () => {
    expect(
      await querySearchAnalytics(
        "sc-domain:example.com",
        request,
        deps(json(200, { rows: [{ keys: 1 }] })),
      ),
    ).toEqual({ ok: false, failure: "unexpected" });
  });
});

describe("sitemaps and inspection", () => {
  it("lists the submitted sitemaps", async () => {
    const d = deps(json(200, { sitemap: [{ path: "https://example.com/sitemap.xml" }] }));
    expect(await listSitemaps("sc-domain:example.com", d)).toEqual({
      ok: true,
      value: ["https://example.com/sitemap.xml"],
    });
  });

  it.each([
    ["PASS", "indexed"],
    ["PARTIAL", "indexed"],
    ["FAIL", "not_indexed"],
    ["NEUTRAL", "not_indexed"],
    ["VERDICT_UNSPECIFIED", "unknown"],
  ])("maps the %s verdict to %s", async (verdict, expected) => {
    const d = deps(
      json(200, {
        inspectionResult: {
          indexStatusResult: {
            verdict,
            coverageState: "Page with redirect",
            lastCrawlTime: "2026-09-20T10:00:00Z",
          },
        },
      }),
    );
    const result = await inspectUrl("sc-domain:example.com", "https://example.com/a", d);
    expect(result).toEqual({
      ok: true,
      value: {
        verdict: expected,
        coverageState: "Page with redirect",
        lastCrawlAt: new Date("2026-09-20T10:00:00Z"),
      },
    });
  });
});

describe("the messages", () => {
  it("name the account to add, and carry no token or Google text", () => {
    expect(SEARCH_MESSAGES.noAccess("robot@project.iam.gserviceaccount.com")).toContain(
      "robot@project.iam.gserviceaccount.com",
    );
    for (const message of Object.values(SEARCH_MESSAGES)) {
      const text = typeof message === "function" ? message("x") : message;
      expect(text).not.toContain("ya29");
    }
  });
});
