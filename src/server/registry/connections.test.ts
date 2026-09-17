import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import { posthogConnections } from "@/db/schema";
import { MissingConfigurationError } from "@/server/env";
import { CHECK_MESSAGES, type CheckResult } from "@/server/posthog";
import { createClient, getClientDetail, listClients } from "./clients";
import {
  removePostHogConnection,
  savePostHogConnection,
  testPostHogConnection,
  UNREADABLE_KEY_MESSAGE,
  type ConnectionDeps,
} from "./connections";
import { createSite } from "./sites";

vi.mock("@/server/session", () => import("@/test/mock-session"));

const hex = () => randomBytes(4).toString("hex");
const masterKey = randomBytes(32);
const goodKey = `phx_GoodKey${hex()}WXYZ`;

function deps(result: CheckResult = { status: "ok", message: null }, key = masterKey) {
  const check = vi.fn(async () => result);
  const value: ConnectionDeps = {
    check,
    masterKey: () => key,
    now: () => new Date("2026-09-17T12:00:00Z"),
  };
  return { check, deps: value };
}

async function newSite() {
  const slug = `conn-${hex()}`;
  await createClient({ name: `Connections ${slug}`, slug, analyticsOwnership: "open_waters" });
  const site = await createSite(slug, {
    productionUrl: `https://${hex()}.example.com`,
    framework: "astro",
    taxonomyVersion: "1",
  });
  if (!site.ok) throw new Error("site not created");
  return { slug, siteId: site.value.siteId };
}

async function connectionOf(slug: string, siteId: string) {
  return (await getClientDetail(slug))!.sites.find(site => site.id === siteId)!.posthog;
}

describe("savePostHogConnection", () => {
  it("stores a connection only after a passing check, showing the last four only", async () => {
    const { slug, siteId } = await newSite();
    const { deps: d, check } = deps();

    const result = await savePostHogConnection(
      siteId,
      { region: "eu", projectId: "12345", apiKey: goodKey },
      d,
    );
    expect(result.ok).toBe(true);
    expect(check).toHaveBeenCalledWith({ region: "eu", projectId: 12345, apiKey: goodKey });

    expect(await connectionOf(slug, siteId)).toEqual({
      region: "eu",
      projectId: 12345,
      keyLast4: "WXYZ",
      lastCheckAt: new Date("2026-09-17T12:00:00Z"),
      lastCheckStatus: "ok",
      lastCheckMessage: null,
    });
    const summary = (await listClients()).find(client => client.slug === slug);
    expect(summary?.connectedSiteCount).toBe(1);
  });

  it("holds ciphertext only in the database", async () => {
    const { siteId } = await newSite();
    await savePostHogConnection(
      siteId,
      { region: "eu", projectId: "1", apiKey: goodKey },
      deps().deps,
    );

    const [row] = await getDb()
      .select()
      .from(posthogConnections)
      .where(eq(posthogConnections.siteId, siteId));
    expect(row!.apiKeyCiphertext).not.toContain(goodKey);
    expect(row!.apiKeyCiphertext).not.toContain("GoodKey");
    expect(JSON.stringify(row)).not.toContain(goodKey);
    expect(row!.keyVersion).toBe(1);
  });

  it.each([
    [{ status: "unauthorised", message: CHECK_MESSAGES.unauthorised }, "apiKey"],
    [{ status: "project_not_found", message: CHECK_MESSAGES.project_not_found }, "projectId"],
  ] as const)("stores nothing when the check says %s", async (check, field) => {
    const { slug, siteId } = await newSite();
    const result = await savePostHogConnection(
      siteId,
      { region: "eu", projectId: "1", apiKey: goodKey },
      deps(check).deps,
    );
    expect(result).toEqual({ ok: false, fieldErrors: { [field]: check.message } });
    expect(await connectionOf(slug, siteId)).toBeNull();
  });

  it("stores nothing when PostHog cannot be reached", async () => {
    const { slug, siteId } = await newSite();
    const result = await savePostHogConnection(
      siteId,
      { region: "eu", projectId: "1", apiKey: goodKey },
      deps({ status: "error", message: CHECK_MESSAGES.unreachable }).deps,
    );
    expect(result).toEqual({ ok: false, fieldErrors: {}, formError: CHECK_MESSAGES.unreachable });
    expect(await connectionOf(slug, siteId)).toBeNull();
  });

  it("leaves the working connection untouched when a replacement fails its check", async () => {
    const { slug, siteId } = await newSite();
    await savePostHogConnection(
      siteId,
      { region: "eu", projectId: "111", apiKey: goodKey },
      deps().deps,
    );
    const [before] = await getDb()
      .select()
      .from(posthogConnections)
      .where(eq(posthogConnections.siteId, siteId));

    const result = await savePostHogConnection(
      siteId,
      { region: "us", projectId: "222", apiKey: "phx_BadKey0000" },
      deps({ status: "unauthorised", message: CHECK_MESSAGES.unauthorised }).deps,
    );
    expect(result.ok).toBe(false);

    const [after] = await getDb()
      .select()
      .from(posthogConnections)
      .where(eq(posthogConnections.siteId, siteId));
    expect(after).toEqual(before);
    expect((await connectionOf(slug, siteId))?.keyLast4).toBe("WXYZ");
  });

  it("replaces region and project with a blank key by reusing the stored key", async () => {
    const { slug, siteId } = await newSite();
    await savePostHogConnection(
      siteId,
      { region: "eu", projectId: "111", apiKey: goodKey },
      deps().deps,
    );
    const { deps: d, check } = deps();

    const result = await savePostHogConnection(
      siteId,
      { region: "us", projectId: "222", apiKey: "" },
      d,
    );
    expect(result.ok).toBe(true);
    expect(check).toHaveBeenCalledWith({ region: "us", projectId: 222, apiKey: goodKey });
    expect(await connectionOf(slug, siteId)).toMatchObject({
      region: "us",
      projectId: 222,
      keyLast4: "WXYZ",
    });
  });

  it("requires a key for a new connection", async () => {
    const { siteId } = await newSite();
    const { deps: d, check } = deps();
    const result = await savePostHogConnection(siteId, { region: "eu", projectId: "1" }, d);
    expect(result).toEqual({ ok: false, fieldErrors: { apiKey: "Enter the PostHog API key." } });
    expect(check).not.toHaveBeenCalled();
  });

  it.each(["0", "-3", "1.5", "abc", ""])(
    "rejects the project ID %j without calling PostHog",
    async projectId => {
      const { siteId } = await newSite();
      const { deps: d, check } = deps();
      const result = await savePostHogConnection(
        siteId,
        { region: "eu", projectId, apiKey: goodKey },
        d,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fieldErrors["projectId"]).toBeDefined();
      expect(check).not.toHaveBeenCalled();
    },
  );

  it("reports a missing master key as unavailable, without calling PostHog", async () => {
    const { siteId } = await newSite();
    const check = vi.fn();
    const result = await savePostHogConnection(
      siteId,
      { region: "eu", projectId: "1", apiKey: goodKey },
      {
        check,
        masterKey: () => {
          throw new MissingConfigurationError("CREDENTIALS_ENCRYPTION_KEY is not set");
        },
        now: () => new Date(),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.formError).toMatch(/CREDENTIALS_ENCRYPTION_KEY/);
    expect(check).not.toHaveBeenCalled();
  });
});

describe("testPostHogConnection", () => {
  it("records a revoked key, then recovery", async () => {
    const { slug, siteId } = await newSite();
    await savePostHogConnection(
      siteId,
      { region: "eu", projectId: "1", apiKey: goodKey },
      deps().deps,
    );

    await testPostHogConnection(
      siteId,
      deps({ status: "unauthorised", message: CHECK_MESSAGES.unauthorised }).deps,
    );
    expect(await connectionOf(slug, siteId)).toMatchObject({
      lastCheckStatus: "unauthorised",
      lastCheckMessage: CHECK_MESSAGES.unauthorised,
    });
    expect((await listClients()).find(client => client.slug === slug)?.connectedSiteCount).toBe(0);

    await testPostHogConnection(siteId, deps().deps);
    expect(await connectionOf(slug, siteId)).toMatchObject({
      lastCheckStatus: "ok",
      lastCheckMessage: null,
    });
  });

  it("records an undecryptable key as an error without contacting PostHog", async () => {
    const { slug, siteId } = await newSite();
    await savePostHogConnection(
      siteId,
      { region: "eu", projectId: "1", apiKey: goodKey },
      deps().deps,
    );

    // A different master key stands in for a changed or lost one.
    const { deps: d, check } = deps({ status: "ok", message: null }, randomBytes(32));
    const result = await testPostHogConnection(siteId, d);

    expect(check).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      value: { status: "error", message: UNREADABLE_KEY_MESSAGE },
    });
    expect(await connectionOf(slug, siteId)).toMatchObject({
      lastCheckStatus: "error",
      lastCheckMessage: "Stored key cannot be read. Enter the key again.",
    });
  });

  it("fails when copied ciphertext is moved onto another connection", async () => {
    const a = await newSite();
    const b = await newSite();
    await savePostHogConnection(
      a.siteId,
      { region: "eu", projectId: "1", apiKey: goodKey },
      deps().deps,
    );
    await savePostHogConnection(
      b.siteId,
      { region: "eu", projectId: "2", apiKey: "phx_OtherKey1111" },
      deps().deps,
    );

    const [rowA] = await getDb()
      .select()
      .from(posthogConnections)
      .where(eq(posthogConnections.siteId, a.siteId));
    await getDb()
      .update(posthogConnections)
      .set({ apiKeyCiphertext: rowA!.apiKeyCiphertext })
      .where(eq(posthogConnections.siteId, b.siteId));

    const { deps: d, check } = deps();
    const result = await testPostHogConnection(b.siteId, d);
    expect(check).not.toHaveBeenCalled();
    expect(result.ok && result.value.status).toBe("error");
  });
});

describe("removePostHogConnection", () => {
  it("needs confirmation, then deletes the stored key", async () => {
    const { slug, siteId } = await newSite();
    await savePostHogConnection(
      siteId,
      { region: "eu", projectId: "1", apiKey: goodKey },
      deps().deps,
    );

    expect((await removePostHogConnection(siteId, {})).ok).toBe(false);
    expect(await connectionOf(slug, siteId)).not.toBeNull();

    expect((await removePostHogConnection(siteId, { confirm: "yes" })).ok).toBe(true);
    expect(await connectionOf(slug, siteId)).toBeNull();
    expect(
      await getDb().select().from(posthogConnections).where(eq(posthogConnections.siteId, siteId)),
    ).toHaveLength(0);
  });
});
