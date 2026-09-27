import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createClient, getClientDetail } from "./clients";
import { createSite, updateSite } from "./sites";

vi.mock("@/server/session", () => import("@/test/mock-session"));

const hex = () => randomBytes(4).toString("hex");

async function newSite(extra: Record<string, unknown> = {}) {
  const slug = `pe-set-${hex()}`;
  await createClient({ name: slug, slug, analyticsOwnership: "open_waters" });
  const productionUrl = `https://${hex()}.example.com`;
  const created = await createSite(slug, {
    productionUrl,
    framework: "next",
    taxonomyVersion: "3",
    ...extra,
  });
  if (!created.ok) throw new Error(`site not created: ${JSON.stringify(created)}`);
  return { slug, siteId: created.value.siteId, productionUrl };
}

const detailOf = async (slug: string, siteId: string) =>
  (await getClientDetail(slug))!.sites.find(site => site.id === siteId)!;

describe("tracked pages", () => {
  it("tracks the home page for every new site", async () => {
    const { slug, siteId } = await newSite();
    expect((await detailOf(slug, siteId)).trackedPages).toEqual(["/"]);
  });

  it("adds the paths given, home page first, and replaces them on update", async () => {
    const { slug, siteId, productionUrl } = await newSite({
      trackedPages: "/contact\n/about\n/contact",
    });
    expect((await detailOf(slug, siteId)).trackedPages).toEqual(["/", "/about", "/contact"]);

    const base = { productionUrl, framework: "next", taxonomyVersion: "3" };
    expect((await updateSite(siteId, { ...base, trackedPages: "/services" })).ok).toBe(true);
    expect((await detailOf(slug, siteId)).trackedPages).toEqual(["/", "/services"]);
  });

  it.each([
    [
      "an eleventh page",
      Array.from({ length: 10 }, (_, index) => `/p${index}`).join("\n"),
      "at most ten",
    ],
    ["a query string", "/contact?ref=footer", "no query string"],
    ["a path without a slash", "contact", "starting with /"],
  ])("refuses %s, and stores nothing", async (_label, value, message) => {
    const { slug, siteId, productionUrl } = await newSite();
    const result = await updateSite(siteId, {
      productionUrl,
      framework: "next",
      taxonomyVersion: "3",
      trackedPages: value,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fieldErrors["trackedPages"]).toContain(message);
    expect((await detailOf(slug, siteId)).trackedPages).toEqual(["/"]);
  });
});

describe("performance budget", () => {
  it("stores targets, and removes the budget when every target is cleared", async () => {
    const { slug, siteId, productionUrl } = await newSite({
      budgetLcpMs: "2000",
      budgetCls: "0.05",
    });
    expect((await detailOf(slug, siteId)).budget).toEqual({
      lcpMs: 2000,
      inpMs: null,
      cls: "0.050",
      labScore: null,
    });
    const base = { productionUrl, framework: "next", taxonomyVersion: "3" };
    expect((await updateSite(siteId, { ...base, budgetLcpMs: "", budgetCls: "" })).ok).toBe(true);
    expect((await detailOf(slug, siteId)).budget).toBeNull();
  });

  it.each([
    ["budgetLcpMs", "-1", "cannot be negative"],
    ["budgetCls", "fast", "Enter a number"],
    ["budgetLabScore", "101", "at most 100"],
  ])("refuses %s of %s", async (field, value, message) => {
    const { siteId, productionUrl } = await newSite();
    const result = await updateSite(siteId, {
      productionUrl,
      framework: "next",
      taxonomyVersion: "3",
      [field]: value,
    });
    expect(!result.ok && result.fieldErrors[field]).toContain(message);
  });
});
