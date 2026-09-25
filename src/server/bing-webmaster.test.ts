import { describe, expect, it, vi } from "vitest";
import { bingDay, checkSite, queryStats, siteTraffic } from "./bing-webmaster";

const apiKey = "BingSecretApiKey123";
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

describe("bingDay", () => {
  it.each([
    ["/Date(1790208000000)/", "2026-09-24"],
    ["/Date(1790208000000-0700)/", "2026-09-24"],
    ["2026-09-24", null],
  ])("reads %s as %s", (value, expected) => {
    expect(bingDay(value)).toBe(expected);
  });
});

describe("checkSite", () => {
  it("is readable when the account lists the site, ignoring case and a trailing slash", async () => {
    const d = deps(json(200, { d: [{ Url: "https://WWW.example.com" }] }));
    expect(await checkSite("https://www.example.com/", d)).toEqual({ ok: true, value: "readable" });
  });

  it("is no access when the account does not list it", async () => {
    expect(await checkSite("https://www.example.com/", deps(json(200, { d: [] })))).toEqual({
      ok: false,
      failure: "no_access",
    });
  });

  it("is a configuration error with no key, and makes no call", async () => {
    const d = deps();
    expect(await checkSite("https://www.example.com/", { ...d, apiKey: null })).toEqual({
      ok: false,
      failure: "configuration",
    });
    expect(d.calls).not.toHaveBeenCalled();
  });
});

describe("statistics", () => {
  it("reads ErrorCode 14 as no access, as confirmed for an unshared site", async () => {
    const d = deps(json(400, { ErrorCode: 14, Message: "ERROR!!! NotAuthorized" }));
    expect(await siteTraffic("https://www.example.com/", d)).toEqual({
      ok: false,
      failure: "no_access",
    });
  });

  it("reads a refused key as a configuration error", async () => {
    const d = deps(json(400, { ErrorCode: 3, Message: "ERROR!!! InvalidApiKey" }));
    expect(await siteTraffic("https://www.example.com/", d)).toEqual({
      ok: false,
      failure: "configuration",
    });
  });

  it("returns daily totals", async () => {
    const d = deps(
      json(200, { d: [{ Date: "/Date(1790208000000)/", Clicks: 4, Impressions: 90 }] }),
    );
    expect(await siteTraffic("https://www.example.com/", d)).toEqual({
      ok: true,
      value: [{ day: "2026-09-24", value: "", clicks: 4, impressions: 90, position: null }],
    });
  });

  it("returns query rows with their position, cut to 200 characters", async () => {
    const long = "q".repeat(250);
    const d = deps(
      json(200, {
        d: [
          {
            Query: long,
            Date: "/Date(1790208000000)/",
            Clicks: 1,
            Impressions: 10,
            AvgImpressionPosition: 3.2,
          },
        ],
      }),
    );
    const result = await queryStats("https://www.example.com/", d);
    expect(result.ok && result.value[0]).toMatchObject({ value: "q".repeat(200), position: 3.2 });
  });

  it("retries once, then gives up, and never puts the key in a result", async () => {
    const d = deps(json(503, {}), json(503, {}));
    const result = await siteTraffic("https://www.example.com/", d);
    expect(result).toEqual({ ok: false, failure: "unreachable" });
    expect(d.calls).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });

  it("reads a malformed body as unexpected", async () => {
    expect(await siteTraffic("https://www.example.com/", deps(json(200, { d: "nope" })))).toEqual({
      ok: false,
      failure: "unexpected",
    });
  });
});
