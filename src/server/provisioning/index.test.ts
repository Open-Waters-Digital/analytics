import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import {
  posthogConnections,
  posthogProvisionedObjects,
  posthogProvisioningRuns,
  sites,
  users,
} from "@/db/schema";
import { createClient } from "@/server/registry/clients";
import { createSite } from "@/server/registry/sites";
import { TEST_USER_ID, testSession } from "@/test/mock-session";
import { desiredInsights } from "./desired";
import {
  applyProvisioning,
  checkProvisioning,
  latestProvisioningRuns,
  PROVISIONING_FORM_MESSAGES,
} from "./index";

vi.mock("@/server/session", () => import("@/test/mock-session"));

const apiKey = "phx_SecretProvisioningKey1234";
const projectId = 277423;
const hex = () => randomBytes(4).toString("hex");

/**
 * An in-memory PostHog project: enough of the API for provisioning, with every
 * request counted and an optional failure on the Nth write.
 */
function fakePostHog(options: { failWriteNumber?: number } = {}) {
  const project: Record<string, unknown> = {
    organization: "org-1",
    cookieless_server_hash_mode: 0,
    anonymize_ips: false,
    timezone: "UTC",
    app_urls: [],
    heatmaps_opt_in: false,
    session_recording_opt_in: true,
    session_recording_masking_config: null,
    test_account_filters: [{ key: "id", type: "cohort", value: 1, operator: "not_in" }],
    secret_api_token: "phs_ProjectSecret",
  };
  const dashboards: { id: number; name: string; description: string }[] = [];
  const insights: {
    id: number;
    name: string;
    description: string;
    query: unknown;
    dashboards: number[];
  }[] = [];
  let nextId = 1000;
  let writes = 0;
  const requests: { method: string; path: string }[] = [];

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = new URL(url).pathname.replace(/^\/api\//, "");
    requests.push({ method, path });
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (method !== "GET") {
      writes += 1;
      if (writes === options.failWriteNumber) {
        throw new DOMException("timed out", "TimeoutError");
      }
    }

    if (path === `projects/${projectId}/`) {
      if (method === "PATCH") Object.assign(project, body);
      return json(200, project);
    }
    if (path === `projects/${projectId}/dashboards/`) {
      if (method === "POST") {
        const created = {
          id: nextId++,
          name: String(body["name"]),
          description: String(body["description"]),
        };
        dashboards.push(created);
        return json(201, created);
      }
      return json(200, { results: dashboards, next: null });
    }
    if (path === `projects/${projectId}/insights/`) {
      if (method === "POST") {
        const created = {
          id: nextId++,
          name: String(body["name"]),
          description: String(body["description"]),
          query: body["query"],
          dashboards: (body["dashboards"] as number[]) ?? [],
        };
        insights.push(created);
        return json(201, created);
      }
      return json(200, { results: insights, next: null });
    }
    const insightMatch = path.match(new RegExp(`^projects/${projectId}/insights/(\\d+)/$`));
    if (insightMatch && method === "PATCH") {
      const insight = insights.find(candidate => candidate.id === Number(insightMatch[1]));
      if (!insight) return json(404, {});
      Object.assign(insight, body);
      return json(200, insight);
    }
    if (path === "organizations/org-1/") return json(200, { default_anonymize_ips: true });
    if (path === "organizations/org-1/proxy_records/") return json(200, { results: [] });
    return json(404, {});
  });

  return {
    project,
    dashboards,
    insights,
    requests,
    writeCount: () => requests.filter(request => request.method !== "GET").length,
    deps: { client: { fetchImpl: fetchImpl as unknown as typeof fetch } },
    fetchImpl,
  };
}

async function newSite(tier: "essentials" | "insights" = "essentials", connected = true) {
  const slug = `prov-${hex()}`;
  await createClient({ name: `Provisioning ${slug}`, slug, analyticsOwnership: "open_waters" });
  const created = await createSite(slug, {
    productionUrl: `https://${hex()}.example.com`,
    framework: "next",
    taxonomyVersion: "3",
    timezone: "Europe/London",
  });
  if (!created.ok) throw new Error("site not created");
  const siteId = created.value.siteId;
  await getDb().update(sites).set({ measurementTier: tier }).where(eq(sites.id, siteId));
  if (connected) {
    await getDb().insert(posthogConnections).values({
      id: randomUUID(),
      siteId,
      region: "eu",
      projectId,
      apiKeyCiphertext: "not-used-by-provisioning",
      keyVersion: 1,
      keyLast4: "0000",
    });
  }
  return siteId;
}

beforeAll(async () => {
  await getDb()
    .insert(users)
    .values({ id: TEST_USER_ID, name: "Test", email: "test@openwaters.digital" })
    .onConflictDoNothing();
});

beforeEach(() => {
  testSession.signedIn = true;
});

describe("checkProvisioning", () => {
  it("rejects a signed-out call before any request to PostHog", async () => {
    const siteId = await newSite();
    const posthog = fakePostHog();
    testSession.signedIn = false;
    await expect(checkProvisioning(siteId, { apiKey }, posthog.deps)).rejects.toThrow();
    expect(posthog.fetchImpl).not.toHaveBeenCalled();
  });

  it("asks for a key, and for a connection, without calling PostHog", async () => {
    const posthog = fakePostHog();
    const connected = await newSite();
    expect(await checkProvisioning(connected, { apiKey: "  " }, posthog.deps)).toEqual({
      ok: false,
      formError: PROVISIONING_FORM_MESSAGES.keyRequired,
    });
    const unconnected = await newSite("essentials", false);
    expect(await checkProvisioning(unconnected, { apiKey }, posthog.deps)).toEqual({
      ok: false,
      formError: PROVISIONING_FORM_MESSAGES.noConnection,
    });
    expect(posthog.fetchImpl).not.toHaveBeenCalled();
  });

  it("lists every difference on a fresh project and sends only reads", async () => {
    const siteId = await newSite();
    const posthog = fakePostHog();
    const result = await checkProvisioning(siteId, { apiKey }, posthog.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.outcome).toBe("differs");
    const types = result.report.differences.map(d => (d.type === "setting" ? d.field : d.type));
    expect(types).toEqual(
      expect.arrayContaining([
        "cookieless_server_hash_mode",
        "anonymize_ips",
        "timezone",
        "app_urls",
        "session_recording_opt_in",
        "dashboard",
        "insight",
      ]),
    );
    expect(posthog.writeCount()).toBe(0);
    expect(result.report.organisation).toEqual({ discardsIpsByDefault: true, proxyDomains: [] });
  });
});

describe("applyProvisioning", () => {
  it("converges, and a second apply writes nothing", async () => {
    const siteId = await newSite();
    const posthog = fakePostHog();

    const first = await applyProvisioning(siteId, { apiKey }, posthog.deps);
    expect(first.ok && first.report.outcome).toBe("applied");
    expect(first.ok && first.report.differences).toEqual([]);
    expect(posthog.project["session_recording_opt_in"]).toBe(false);
    expect(posthog.dashboards).toHaveLength(1);
    expect(posthog.insights).toHaveLength(desiredInsights(3).length);
    expect(
      posthog.insights.every(insight => insight.dashboards.includes(posthog.dashboards[0]!.id)),
    ).toBe(true);

    const writesAfterFirst = posthog.writeCount();
    const second = await applyProvisioning(siteId, { apiKey }, posthog.deps);
    expect(second.ok && second.report.outcome).toBe("matched");
    expect(posthog.writeCount()).toBe(writesAfterFirst);
  });

  it("records each created object, so a lost description marker does not duplicate it", async () => {
    const siteId = await newSite();
    const posthog = fakePostHog();
    await applyProvisioning(siteId, { apiKey }, posthog.deps);

    for (const insight of posthog.insights) insight.description = "A partner rewrote this";
    const writes = posthog.writeCount();
    const again = await applyProvisioning(siteId, { apiKey }, posthog.deps);
    expect(again.ok && again.report.outcome).toBe("matched");
    expect(posthog.writeCount()).toBe(writes);

    const rows = await getDb()
      .select()
      .from(posthogProvisionedObjects)
      .where(eq(posthogProvisionedObjects.siteId, siteId));
    expect(rows).toHaveLength(desiredInsights(3).length + 1);
  });

  it("adopts objects by their marker when the record is lost", async () => {
    const siteId = await newSite();
    const posthog = fakePostHog();
    await applyProvisioning(siteId, { apiKey }, posthog.deps);
    await getDb()
      .delete(posthogProvisionedObjects)
      .where(eq(posthogProvisionedObjects.siteId, siteId));

    const writes = posthog.writeCount();
    const again = await applyProvisioning(siteId, { apiKey }, posthog.deps);
    expect(again.ok && again.report.outcome).toBe("matched");
    expect(posthog.writeCount()).toBe(writes);
    expect(posthog.insights).toHaveLength(desiredInsights(3).length);
  });

  it("keeps recording off at an unconfirmed higher tier, and reports it held", async () => {
    const siteId = await newSite("insights");
    const posthog = fakePostHog();
    posthog.project["session_recording_opt_in"] = false;

    const result = await applyProvisioning(siteId, { apiKey }, posthog.deps);
    expect(posthog.project["session_recording_opt_in"]).toBe(false);
    expect(result.ok && result.report.outcome).toBe("applied");
    const held = result.ok
      ? result.report.differences.filter(d => d.type === "setting" && d.held)
      : [];
    expect(held.map(d => (d.type === "setting" ? d.field : ""))).toEqual([
      "session_recording_opt_in",
      "session_recording_masking_config",
    ]);
  });

  it("allows recording, masked, once the tier is confirmed", async () => {
    const siteId = await newSite("insights");
    await getDb()
      .update(sites)
      .set({
        tierConfirmedFor: "insights",
        tierConfirmedAt: new Date(),
        tierConfirmedBy: TEST_USER_ID,
      })
      .where(eq(sites.id, siteId));
    const posthog = fakePostHog();

    await applyProvisioning(siteId, { apiKey }, posthog.deps);
    expect(posthog.project["session_recording_opt_in"]).toBe(true);
    expect(posthog.project["session_recording_masking_config"]).toEqual({ maskAllInputs: true });
  });

  it("records partial when a write times out, and the next check lists only the rest", async () => {
    const siteId = await newSite();
    const posthog = fakePostHog({ failWriteNumber: 2 });

    const result = await applyProvisioning(siteId, { apiKey }, posthog.deps);
    expect(result.ok && result.report.outcome).toBe("partial");
    expect(result.ok && result.report.applied).toEqual(["Project settings"]);
    expect(result.ok && result.report.message).toContain("could not be reached");

    const check = await checkProvisioning(siteId, { apiKey }, fakePostHogSharing(posthog).deps);
    const remaining = check.ok ? check.report.differences.map(d => d.type) : [];
    expect(remaining).not.toContain("setting");
    expect(remaining).toContain("dashboard");
  });

  it("stores no key and no values, and logs neither", async () => {
    const siteId = await newSite();
    const posthog = fakePostHog();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await applyProvisioning(siteId, { apiKey }, posthog.deps);

    const runs = await getDb()
      .select()
      .from(posthogProvisioningRuns)
      .where(eq(posthogProvisioningRuns.siteId, siteId));
    expect(runs.length).toBeGreaterThan(0);
    expect(JSON.stringify(runs)).not.toContain(apiKey);
    expect(JSON.stringify(runs)).not.toContain("Europe/London");
    expect(runs.every(run => run.runBy === TEST_USER_ID)).toBe(true);
    expect(JSON.stringify(info.mock.calls)).not.toContain(apiKey);
    info.mockRestore();
  });
});

/** A second fake over the same project state, with no failure planned. */
function fakePostHogSharing(original: ReturnType<typeof fakePostHog>) {
  const fresh = fakePostHog();
  Object.assign(fresh.project, original.project);
  fresh.dashboards.push(...original.dashboards);
  fresh.insights.push(...original.insights);
  return fresh;
}

describe("latestProvisioningRuns", () => {
  it("returns each site's most recent run only", async () => {
    const siteId = await newSite();
    const posthog = fakePostHog();
    await checkProvisioning(siteId, { apiKey }, posthog.deps);
    await applyProvisioning(siteId, { apiKey }, posthog.deps);
    const untouched = await newSite();

    const runs = await latestProvisioningRuns([siteId, untouched]);
    expect(runs.get(siteId)).toMatchObject({
      kind: "apply",
      outcome: "applied",
      taxonomyVersion: 3,
    });
    expect(runs.has(untouched)).toBe(false);
  });
});
