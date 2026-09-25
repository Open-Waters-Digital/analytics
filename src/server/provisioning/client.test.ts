import { describe, expect, it, vi } from "vitest";
import {
  createInsight,
  listInsights,
  patchProject,
  PROVISIONING_MESSAGES,
  readOrganisationReport,
  readProject,
} from "./client";

const apiKey = "phx_SecretProvisioningKey1234";
const connection = { region: "eu" as const, projectId: 277423, apiKey };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchReturning(...responses: Response[]) {
  const queue = [...responses];
  return vi.fn(async () => queue.shift() ?? json(500, null)) as unknown as typeof fetch;
}

describe("readProject", () => {
  it("keeps only the named settings, never the project's secret tokens", async () => {
    const fetchImpl = fetchReturning(
      json(200, {
        organization: "org-1",
        anonymize_ips: true,
        timezone: "UTC",
        secret_api_token: "phs_ProjectSecret",
        api_token: "phc_ProjectToken",
      }),
    );
    const result = await readProject(connection, { fetchImpl });
    expect(result).toMatchObject({
      ok: true,
      value: { organisationId: "org-1", settings: { anonymize_ips: true, timezone: "UTC" } },
    });
    expect(JSON.stringify(result)).not.toContain("phs_");
    expect(JSON.stringify(result)).not.toContain("phc_");
  });

  it("sends the key as a bearer token to the region's host", async () => {
    const fetchImpl = fetchReturning(json(200, {}));
    await readProject(connection, { fetchImpl });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(url).toBe("https://eu.posthog.com/api/projects/277423/");
    expect((init?.headers as Record<string, string>)["authorization"]).toBe(`Bearer ${apiKey}`);
  });

  it.each([
    [401, "unauthorised"],
    [403, "unauthorised"],
    [404, "not_found"],
    [429, "unreachable"],
    [500, "unreachable"],
    [400, "unexpected"],
  ] as const)("maps %i to %s", async (status, failure) => {
    const result = await readProject(connection, {
      fetchImpl: fetchReturning(json(status, { detail: `bad key ${apiKey}` })),
    });
    expect(result).toEqual({ ok: false, failure });
  });

  it("maps a timeout to unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as unknown as typeof fetch;
    expect(await readProject(connection, { fetchImpl })).toEqual({
      ok: false,
      failure: "unreachable",
    });
  });

  it("maps a body that is not JSON to unexpected", async () => {
    const fetchImpl = fetchReturning(new Response("<html>", { status: 200 }));
    expect(await readProject(connection, { fetchImpl })).toEqual({
      ok: false,
      failure: "unexpected",
    });
  });
});

describe("the fixed messages", () => {
  it("name the scopes, and never carry the key or PostHog's text", () => {
    expect(PROVISIONING_MESSAGES.unauthorised).toContain("project:write");
    for (const message of Object.values(PROVISIONING_MESSAGES)) {
      expect(message).not.toContain("phx_");
    }
  });
});

describe("writes", () => {
  it("patches only the fields it is given", async () => {
    const fetchImpl = fetchReturning(json(200, {}));
    await patchProject(connection, { timezone: "Europe/London" }, { fetchImpl });
    const [, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ timezone: "Europe/London" });
  });

  it("creates a saved insight on the dashboard and returns its id", async () => {
    const fetchImpl = fetchReturning(json(201, { id: 42 }));
    const result = await createInsight(
      connection,
      { name: "n", description: "ow:k", query: { kind: "InsightVizNode" }, dashboards: [7] },
      { fetchImpl },
    );
    expect(result).toEqual({ ok: true, value: 42 });
    const [, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({ saved: true, dashboards: [7] });
  });
});

describe("listInsights", () => {
  it("follows the next link across pages", async () => {
    const fetchImpl = fetchReturning(
      json(200, {
        results: [{ id: 1 }],
        next: "https://eu.posthog.com/api/projects/277423/insights/?offset=100",
      }),
      json(200, { results: [{ id: 2 }], next: null }),
    );
    const result = await listInsights(connection, { fetchImpl });
    expect(result.ok && result.value.map(insight => insight.id)).toEqual([1, 2]);
  });
});

describe("listInsights and the key", () => {
  it("refuses to follow a next link to another host", async () => {
    const fetchImpl = fetchReturning(
      json(200, { results: [{ id: 1 }], next: "https://evil.example/api/steal" }),
    );
    expect(await listInsights(connection, { fetchImpl })).toEqual({
      ok: false,
      failure: "unexpected",
    });
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(1);
  });
});

describe("readOrganisationReport", () => {
  it("reports the IP default and whether each proxy is live", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("proxy_records")
        ? json(200, { results: [{ domain: "e.example.co.uk", status: "valid" }] })
        : json(200, { default_anonymize_ips: true }),
    ) as unknown as typeof fetch;
    expect(await readOrganisationReport(connection, "org-1", { fetchImpl })).toEqual({
      ok: true,
      value: {
        discardsIpsByDefault: true,
        proxyDomains: [{ domain: "e.example.co.uk", live: true }],
      },
    });
  });
});
