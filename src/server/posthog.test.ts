import { describe, expect, it, vi } from "vitest";
import {
  CHECK_MESSAGES,
  checkPostHogConnection,
  classifyCheckResponse,
  RETRY_DELAY_MS,
  runHogQlQueryWithRetry,
} from "./posthog";

const okBody = { results: [[42]], columns: ["count()"] };
const apiKey = "phx_SecretQueryReadKey9876";

describe("classifyCheckResponse", () => {
  it.each([
    [200, okBody, "ok", null],
    [401, { detail: "bad key" }, "unauthorised", CHECK_MESSAGES.unauthorised],
    [403, { detail: "no permission" }, "unauthorised", CHECK_MESSAGES.unauthorised],
    [404, { detail: "Project not found" }, "project_not_found", CHECK_MESSAGES.project_not_found],
    [429, { detail: "throttled" }, "error", CHECK_MESSAGES.unreachable],
    [500, null, "error", CHECK_MESSAGES.unreachable],
    [502, null, "error", CHECK_MESSAGES.unreachable],
    [200, "<html>not json</html>", "error", CHECK_MESSAGES.unexpected],
    [200, { unexpected: true }, "error", CHECK_MESSAGES.unexpected],
    [400, { detail: "bad query" }, "error", CHECK_MESSAGES.unexpected],
  ])("status %i → %s", (status, body, expected, message) => {
    expect(classifyCheckResponse(status, body)).toEqual({ status: expected, message });
  });

  it("never passes PostHog's own error text through", () => {
    const result = classifyCheckResponse(401, { detail: "key phx_leaked is invalid" });
    expect(result.message).not.toContain("phx_leaked");
  });
});

describe("checkPostHogConnection", () => {
  function jsonResponse(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("queries the region's host with the key as a bearer token", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody));
    const result = await checkPostHogConnection(
      { region: "eu", projectId: 12345, apiKey },
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({ status: "ok", message: null });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://eu.posthog.com/api/projects/12345/query/");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["authorization"]).toBe(`Bearer ${apiKey}`);
    expect(JSON.parse(String(init.body)).query.kind).toBe("HogQLQuery");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the US host for the US region", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody));
    await checkPostHogConnection(
      { region: "us", projectId: 1, apiKey },
      fetchImpl as unknown as typeof fetch,
    );
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toMatch(
      /^https:\/\/us\.posthog\.com\//,
    );
  });

  it.each([
    [401, "unauthorised"],
    [403, "unauthorised"],
    [404, "project_not_found"],
    [500, "error"],
  ])("maps HTTP %i to %s", async (status, expected) => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(status, { detail: `error mentioning ${apiKey}` }),
    );
    const result = await checkPostHogConnection(
      { region: "eu", projectId: 1, apiKey },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.status).toBe(expected);
    expect(result.message ?? "").not.toContain(apiKey);
  });

  it("reports a network error as unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError(`fetch failed for ${apiKey}`);
    });
    const result = await checkPostHogConnection(
      { region: "eu", projectId: 1, apiKey },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ status: "error", message: CHECK_MESSAGES.unreachable });
  });

  it("gives up after the timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const started = Date.now();
    const result = await checkPostHogConnection(
      { region: "eu", projectId: 1, apiKey },
      fetchImpl as unknown as typeof fetch,
      50,
    );
    expect(result).toEqual({ status: "error", message: CHECK_MESSAGES.unreachable });
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("runHogQlQueryWithRetry", () => {
  const connection = { region: "eu", projectId: 1, apiKey } as const;
  const query = "SELECT 1";

  function jsonResponse(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("tries once more after a rate limit, and keeps the second answer", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { detail: "throttled" }))
      .mockResolvedValueOnce(jsonResponse(200, okBody));
    const sleep = vi.fn(async () => {});

    const outcome = await runHogQlQueryWithRetry(connection, query, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
    });

    expect(outcome.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(RETRY_DELAY_MS);
  });

  it("gives up after the second failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, null));
    const outcome = await runHogQlQueryWithRetry(connection, query, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    expect(outcome.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    if (!outcome.ok) expect(outcome.failure.message).toBe(CHECK_MESSAGES.unreachable);
  });

  it("retries a transport failure, which has no status at all", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(200, okBody));

    const outcome = await runHogQlQueryWithRetry(connection, query, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    expect(outcome.ok).toBe(true);
  });

  it("does not retry a rejected key: trying again cannot help", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { detail: "nope" }));
    const sleep = vi.fn(async () => {});

    const outcome = await runHogQlQueryWithRetry(connection, query, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.status).toBe("unauthorised");
  });

  it("does not retry a timeout beyond the one retry", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );

    const outcome = await runHogQlQueryWithRetry(connection, query, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 20,
      sleep: async () => {},
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(outcome.ok).toBe(false);
  });
});
