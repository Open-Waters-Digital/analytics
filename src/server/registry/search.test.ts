import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import { bingWebmasterSites, searchConsoleProperties } from "@/db/schema";
import { testSession } from "@/test/mock-session";
import { createClient, getClientDetail } from "./clients";
import {
  checkBingSite,
  checkSearchConsoleProperty,
  saveBingSite,
  saveSearchConsoleProperty,
} from "./search";
import { createSite, updateSite } from "./sites";

vi.mock("@/server/session", () => import("@/test/mock-session"));

const hex = () => randomBytes(4).toString("hex");
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function newSite(extra: Record<string, unknown> = {}) {
  const slug = `reg-search-${hex()}`;
  await createClient({ name: slug, slug, analyticsOwnership: "open_waters" });
  const productionUrl = `https://${hex()}.example.com`;
  const created = await createSite(slug, {
    productionUrl,
    framework: "next",
    taxonomyVersion: "3",
    ...extra,
  });
  if (!created.ok) throw new Error("site not created");
  return { slug, siteId: created.value.siteId, productionUrl };
}

const detailOf = async (slug: string, siteId: string) =>
  (await getClientDetail(slug))!.sites.find(site => site.id === siteId)!;

function google(response: Response) {
  const fetchImpl = vi.fn(async () => response);
  return {
    calls: fetchImpl,
    deps: {
      google: { fetchImpl: fetchImpl as unknown as typeof fetch, token: async () => "token" },
      googleConfigured: () => true,
    },
  };
}

function bing(response: Response) {
  const fetchImpl = vi.fn(async () => response);
  return {
    calls: fetchImpl,
    deps: {
      bing: { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: "key" },
      bingConfigured: () => true,
    },
  };
}

beforeEach(() => {
  testSession.signedIn = true;
});

describe("saving and checking a Search Console property", () => {
  it.each([
    ["a readable property", json(200, { permissionLevel: "siteRestrictedUser" }), "readable"],
    ["an unshared property, which Google answers 404", json(404, {}), "no_access"],
    ["a 403", json(403, {}), "no_access"],
    ["an outage", json(503, {}), "check_failed"],
  ])("stores the check result for %s", async (_label, response, expected) => {
    const { slug, siteId } = await newSite();
    const engine = google(response);
    const result = await saveSearchConsoleProperty(
      siteId,
      { property: "sc-domain:example.com" },
      engine.deps,
    );
    expect(result).toEqual({ ok: true, value: { check: expected } });
    const detail = await detailOf(slug, siteId);
    expect(detail.searchConsole).toMatchObject({
      value: "sc-domain:example.com",
      status: expected,
    });
    expect(detail.searchConsole?.message ?? "").not.toMatch(/token|googleapis/i);
  });

  it("keeps the property after a failed check, and a later failure replaces an earlier success", async () => {
    const { slug, siteId } = await newSite();
    await saveSearchConsoleProperty(
      siteId,
      { property: "sc-domain:example.com" },
      google(json(200, { permissionLevel: "siteOwner" })).deps,
    );
    await checkSearchConsoleProperty(siteId, google(json(500, {})).deps);
    const detail = await detailOf(slug, siteId);
    expect(detail.searchConsole).toMatchObject({
      value: "sc-domain:example.com",
      status: "check_failed",
    });
    expect(detail.searchConsole?.message).toContain("Google did not answer");
  });

  it("does not call Google when the key is not configured", async () => {
    const { siteId } = await newSite();
    const engine = google(json(200, {}));
    const result = await saveSearchConsoleProperty(
      siteId,
      { property: "sc-domain:example.com" },
      { ...engine.deps, googleConfigured: () => false },
    );
    expect(result).toEqual({ ok: true, value: { check: "not_configured" } });
    expect(engine.calls).not.toHaveBeenCalled();
  });

  it("starts a changed property again, clearing its backfill", async () => {
    const { siteId } = await newSite();
    const engine = google(json(200, { permissionLevel: "siteOwner" }));
    await saveSearchConsoleProperty(siteId, { property: "sc-domain:one.com" }, engine.deps);
    await getDb()
      .update(searchConsoleProperties)
      .set({ backfilledAt: new Date() })
      .where(eq(searchConsoleProperties.siteId, siteId));
    await saveSearchConsoleProperty(siteId, { property: "sc-domain:two.com" }, engine.deps);
    const [row] = await getDb()
      .select()
      .from(searchConsoleProperties)
      .where(eq(searchConsoleProperties.siteId, siteId));
    expect(row).toMatchObject({ property: "sc-domain:two.com", backfilledAt: null });
  });

  it("rejects a signed-out check with no call to Google", async () => {
    const { siteId } = await newSite();
    const engine = google(json(200, { permissionLevel: "siteOwner" }));
    testSession.signedIn = false;
    await expect(checkSearchConsoleProperty(siteId, engine.deps)).rejects.toThrow();
    await expect(
      saveSearchConsoleProperty(siteId, { property: "sc-domain:example.com" }, engine.deps),
    ).rejects.toThrow();
    expect(engine.calls).not.toHaveBeenCalled();
  });
});

describe("saving and checking a Bing site", () => {
  it("is readable when the Open Waters account lists it", async () => {
    const { slug, siteId } = await newSite();
    const engine = bing(json(200, { d: [{ Url: "https://www.example.com/" }] }));
    expect(
      await saveBingSite(siteId, { siteUrl: "https://www.example.com/" }, engine.deps),
    ).toEqual({
      ok: true,
      value: { check: "readable" },
    });
    expect((await detailOf(slug, siteId)).bing).toMatchObject({ status: "readable" });
  });

  it("is no access when it is not listed", async () => {
    const { siteId } = await newSite();
    const engine = bing(json(200, { d: [] }));
    await saveBingSite(siteId, { siteUrl: "https://www.example.com/" }, engine.deps);
    const [row] = await getDb()
      .select()
      .from(bingWebmasterSites)
      .where(eq(bingWebmasterSites.siteId, siteId));
    expect(row?.lastCheckStatus).toBe("no_access");
    expect(row?.lastCheckMessage).toContain("analytics@openwaters.digital");
  });

  it("explains the accepted format for a bare hostname, and stores nothing", async () => {
    const { siteId } = await newSite();
    const result = await saveBingSite(
      siteId,
      { siteUrl: "www.example.com" },
      bing(json(200, { d: [] })).deps,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fieldErrors["siteUrl"]).toContain("ending in a slash");
    expect(
      await getDb().select().from(bingWebmasterSites).where(eq(bingWebmasterSites.siteId, siteId)),
    ).toEqual([]);
  });

  it("asks for a site before checking one", async () => {
    const { siteId } = await newSite();
    expect((await checkBingSite(siteId, bing(json(200, { d: [] })).deps)).ok).toBe(false);
  });
});

describe("replacement sites and brand terms", () => {
  it("stores the replacement flag and brand terms, trimmed, lowercased and without repeats", async () => {
    const { slug, siteId } = await newSite({
      replacesExistingSite: "on",
      brandTerms: " Luxury Gardens \nLGD, luxury gardens\n",
    });
    const detail = await detailOf(slug, siteId);
    expect(detail.replacesExistingSite).toBe(true);
    expect(detail.brandTerms).toEqual(["luxury gardens", "lgd"]);
  });

  it("refuses 21 brand terms, and a term over 50 characters", async () => {
    const { siteId, productionUrl } = await newSite();
    const base = { productionUrl, framework: "next", taxonomyVersion: "3" };
    const tooMany = Array.from({ length: 21 }, (_, index) => `term${index}`).join("\n");
    const many = await updateSite(siteId, { ...base, brandTerms: tooMany });
    expect(!many.ok && many.fieldErrors["brandTerms"]).toContain("at most 20");
    const long = await updateSite(siteId, { ...base, brandTerms: "x".repeat(51) });
    expect(!long.ok && long.fieldErrors["brandTerms"]).toContain("50 characters");
  });
});
