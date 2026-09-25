import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import { sites, users } from "@/db/schema";
import { createClient } from "@/server/registry/clients";
import { createSite } from "@/server/registry/sites";
import { TEST_USER_ID, testSession } from "@/test/mock-session";
import { confirmTier, TIER_MESSAGES } from "./tier";

vi.mock("@/server/session", () => import("@/test/mock-session"));

const hex = () => randomBytes(4).toString("hex");
const both = { bannerLive: "on", privacyPageNamesTools: "on" };

async function newSite(measurementTier: string) {
  const slug = `tier-${hex()}`;
  await createClient({ name: `Tier ${slug}`, slug, analyticsOwnership: "open_waters" });
  const created = await createSite(slug, {
    productionUrl: `https://${hex()}.example.com`,
    framework: "next",
    taxonomyVersion: "3",
    measurementTier,
  });
  if (!created.ok) throw new Error("site not created");
  return created.value.siteId;
}

async function confirmationOf(siteId: string) {
  const [row] = await getDb()
    .select({
      for: sites.tierConfirmedFor,
      at: sites.tierConfirmedAt,
      by: sites.tierConfirmedBy,
    })
    .from(sites)
    .where(eq(sites.id, siteId));
  return row;
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

describe("confirmTier", () => {
  it("records who confirmed which tier, and when", async () => {
    const siteId = await newSite("insights");
    expect((await confirmTier(siteId, { tier: "insights", ...both })).ok).toBe(true);
    const row = await confirmationOf(siteId);
    expect(row).toMatchObject({ for: "insights", by: TEST_USER_ID });
    expect(row?.at).toBeInstanceOf(Date);
  });

  it("needs both conditions ticked", async () => {
    const siteId = await newSite("growth");
    const result = await confirmTier(siteId, { tier: "growth", bannerLive: "on" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fieldErrors["privacyPageNamesTools"]).toBeTruthy();
    expect((await confirmationOf(siteId))?.for).toBeNull();
  });

  it("refuses a tier that is not the site's current one", async () => {
    const siteId = await newSite("growth");
    expect(await confirmTier(siteId, { tier: "insights", ...both })).toEqual({
      ok: false,
      fieldErrors: {},
      formError: TIER_MESSAGES.changed,
    });
    expect((await confirmationOf(siteId))?.for).toBeNull();
  });

  it("has nothing to confirm at Essentials", async () => {
    const siteId = await newSite("essentials");
    expect(await confirmTier(siteId, { tier: "essentials", ...both })).toEqual({
      ok: false,
      fieldErrors: {},
      formError: TIER_MESSAGES.essentials,
    });
  });

  it("rejects a signed-out call and records nothing", async () => {
    const siteId = await newSite("insights");
    testSession.signedIn = false;
    await expect(confirmTier(siteId, { tier: "insights", ...both })).rejects.toThrow();
    testSession.signedIn = true;
    expect((await confirmationOf(siteId))?.for).toBeNull();
  });
});
