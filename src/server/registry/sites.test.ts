import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import { siteChanges, siteExpectedEvents, sites } from "@/db/schema";
import { eventsFor } from "@/lib/event-list";
import { testSession } from "@/test/mock-session";
import { UnauthorisedError } from "@/server/session-policy";
import { createClient, getClientDetail, listClients } from "./clients";
import { addRecipient, removeRecipient } from "./recipients";
import {
  addSiteChange,
  createSite,
  deleteSiteChange,
  removeSite,
  saveCommercialContext,
  saveSearchConsoleProperty,
  setExpectedEvents,
  updateSite,
  updateSiteChange,
} from "./sites";
import { toMinorUnits } from "./schemas";

vi.mock("@/server/session", () => import("@/test/mock-session"));

const hex = () => randomBytes(4).toString("hex");

async function newClient() {
  const slug = `site-test-${hex()}`;
  await createClient({ name: `Site test ${slug}`, slug, analyticsOwnership: "open_waters" });
  return slug;
}

async function newSite(slug: string, overrides: Record<string, unknown> = {}) {
  const result = await createSite(slug, {
    productionUrl: `https://${hex()}.example.com`,
    framework: "astro",
    taxonomyVersion: "1",
    ...overrides,
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.value.siteId;
}

async function siteOf(slug: string, siteId: string) {
  const detail = await getClientDetail(slug);
  return detail!.sites.find(site => site.id === siteId)!;
}

describe("sites", () => {
  it("adds a site with defaults and every version 1 event expected", async () => {
    const slug = await newClient();
    const siteId = await newSite(slug, { productionUrl: `https://${hex()}.example.com/` });
    const site = await siteOf(slug, siteId);

    expect(site).toMatchObject({
      framework: "astro",
      timezone: "Europe/London",
      taxonomyVersion: 1,
    });
    expect(site.productionUrl).not.toMatch(/\/$/);
    expect(site.expectedEvents.sort()).toEqual(
      eventsFor(1)!
        .map(event => event.name)
        .sort(),
    );
  });

  it.each([
    ["http://example.com", /https/],
    ["https://example.com/about", /root URL/],
    ["https://example.com/?utm=x", /root URL/],
    ["example.com", /full URL/],
  ])("rejects the URL %j", async (productionUrl, message) => {
    const slug = await newClient();
    const result = await createSite(slug, {
      productionUrl,
      framework: "astro",
      taxonomyVersion: "1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors["productionUrl"]).toMatch(message);
  });

  it("rejects an event list version the contract does not have, saving nothing", async () => {
    const slug = await newClient();
    const productionUrl = `https://${hex()}.example.com`;
    const result = await createSite(slug, {
      productionUrl,
      framework: "astro",
      taxonomyVersion: "9",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors["taxonomyVersion"]).toBe(
        "Choose an event list version that exists.",
      );
    }
    const saved = await getDb().select().from(sites).where(eq(sites.productionUrl, productionUrl));
    expect(saved).toEqual([]);
  });

  it("accepts versions 1 to 3", async () => {
    const slug = await newClient();
    for (const taxonomyVersion of ["1", "2", "3"]) {
      const result = await createSite(slug, {
        productionUrl: `https://${hex()}.example.com`,
        framework: "next",
        taxonomyVersion,
      });
      expect(result.ok).toBe(true);
    }
  });

  it("rejects a URL another site already uses, across clients", async () => {
    const url = `https://${hex()}.example.com`;
    await newSite(await newClient(), { productionUrl: url });
    const result = await createSite(await newClient(), {
      productionUrl: `${url}/`,
      framework: "next",
      taxonomyVersion: "1",
    });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { productionUrl: "Another site already uses this URL." },
    });
  });

  it.each(["London", "Mars/Olympus", "GMT+1"])("rejects the timezone %j", async timezone => {
    const slug = await newClient();
    const result = await createSite(slug, {
      productionUrl: `https://${hex()}.example.com`,
      framework: "astro",
      taxonomyVersion: "1",
      timezone,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors["timezone"]).toMatch(/IANA/);
  });

  it("does not save the site if its expected events cannot be saved", async () => {
    const slug = await newClient();
    const productionUrl = `https://${hex()}.example.com`;
    // A duplicate event violates the unique constraint inside the transaction.
    const duplicate = [
      { name: "cta_clicked", stage: "intent" as const, server: false },
      { name: "cta_clicked", stage: "intent" as const, server: false },
    ];
    await expect(
      createSite(
        slug,
        { productionUrl, framework: "astro", taxonomyVersion: "1" },
        { eventsFor: () => duplicate },
      ),
    ).rejects.toThrow();

    const rows = await getDb().select().from(sites).where(eq(sites.productionUrl, productionUrl));
    expect(rows).toHaveLength(0);
  });

  it("updates a site", async () => {
    const slug = await newClient();
    const siteId = await newSite(slug);
    const url = `https://${hex()}.example.com`;
    const result = await updateSite(siteId, {
      productionUrl: url,
      framework: "next",
      repository: "openwaters-digital/example",
      launchedOn: "2026-10-01",
      taxonomyVersion: "1",
      timezone: "Europe/Paris",
    });
    expect(result.ok).toBe(true);
    expect(await siteOf(slug, siteId)).toMatchObject({
      productionUrl: url,
      framework: "next",
      repository: "openwaters-digital/example",
      launchedOn: "2026-10-01",
      timezone: "Europe/Paris",
    });
  });

  it("removes nothing without confirmation, and everything with it", async () => {
    const slug = await newClient();
    const siteId = await newSite(slug);
    await addSiteChange(siteId, { occurredOn: "2026-10-03", kind: "launch", title: "Launch" });

    expect((await removeSite(siteId, {})).ok).toBe(false);
    expect((await removeSite(siteId, { confirm: "no" })).ok).toBe(false);
    expect(await getDb().select().from(sites).where(eq(sites.id, siteId))).toHaveLength(1);

    expect((await removeSite(siteId, { confirm: "yes" })).ok).toBe(true);
    expect(await getDb().select().from(sites).where(eq(sites.id, siteId))).toHaveLength(0);
    expect(
      await getDb().select().from(siteExpectedEvents).where(eq(siteExpectedEvents.siteId, siteId)),
    ).toHaveLength(0);
    expect(
      await getDb().select().from(siteChanges).where(eq(siteChanges.siteId, siteId)),
    ).toHaveLength(0);
  });

  it("counts sites in the client list", async () => {
    const slug = await newClient();
    await newSite(slug);
    await newSite(slug);
    const summary = (await listClients()).find(client => client.slug === slug);
    expect(summary).toMatchObject({ siteCount: 2, connectedSiteCount: 0 });
  });
});

describe("report recipients", () => {
  it("adds, rejects a case-insensitive duplicate, and removes", async () => {
    const slug = await newClient();
    expect(
      (await addRecipient(slug, { name: "Jane Smith", email: "Jane@RadaraHealth.com" })).ok,
    ).toBe(true);
    expect(
      await addRecipient(slug, { name: "Jane again", email: "jane@radarahealth.com " }),
    ).toEqual({
      ok: false,
      fieldErrors: { email: "That address is already a recipient for this client." },
    });

    const detail = await getClientDetail(slug);
    expect(detail!.recipients).toEqual([
      { id: expect.any(String), name: "Jane Smith", email: "jane@radarahealth.com" },
    ]);

    await removeRecipient(slug, detail!.recipients[0]!.id);
    expect((await getClientDetail(slug))!.recipients).toEqual([]);
  });

  it.each(["", "jane", "jane@", "@radarahealth.com"])("rejects the email %j", async email => {
    const slug = await newClient();
    const result = await addRecipient(slug, { name: "Jane", email });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors["email"]).toBeDefined();
  });

  it("allows the same address for two different clients", async () => {
    const email = `shared-${hex()}@example.com`;
    expect((await addRecipient(await newClient(), { name: "A", email })).ok).toBe(true);
    expect((await addRecipient(await newClient(), { name: "B", email })).ok).toBe(true);
  });
});

describe("search console property", () => {
  it.each([
    "sc-domain:radarahealth.com",
    "https://radarahealth.com/",
    "https://www.example.co.uk/blog/",
  ])("accepts %j", async property => {
    const slug = await newClient();
    const siteId = await newSite(slug);
    expect((await saveSearchConsoleProperty(siteId, { property })).ok).toBe(true);
    expect((await siteOf(slug, siteId)).searchConsoleProperty).toBe(property);
  });

  it.each([
    "radarahealth.com",
    "https://radarahealth.com",
    "http://radarahealth.com/",
    "sc-domain:",
    "sc-domain:not a host",
  ])("rejects %j", async property => {
    const siteId = await newSite(await newClient());
    const result = await saveSearchConsoleProperty(siteId, { property });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors["property"]).toMatch(/sc-domain:example\.com/);
  });

  it("replaces an existing property", async () => {
    const slug = await newClient();
    const siteId = await newSite(slug);
    await saveSearchConsoleProperty(siteId, { property: "sc-domain:one.com" });
    await saveSearchConsoleProperty(siteId, { property: "sc-domain:two.com" });
    expect((await siteOf(slug, siteId)).searchConsoleProperty).toBe("sc-domain:two.com");
  });
});

describe("expected events", () => {
  it("replaces the set, so an unticked event is no longer expected", async () => {
    const slug = await newClient();
    const siteId = await newSite(slug);
    const allButDownloads = eventsFor(1)!
      .map(event => event.name)
      .filter(name => name !== "file_downloaded");

    expect((await setExpectedEvents(siteId, { events: allButDownloads })).ok).toBe(true);
    const expected = (await siteOf(slug, siteId)).expectedEvents;
    expect(expected).not.toContain("file_downloaded");
    expect(expected.sort()).toEqual([...allButDownloads].sort());
  });

  it("rejects a name that is not on the event list, changing nothing", async () => {
    const slug = await newClient();
    const siteId = await newSite(slug);
    const result = await setExpectedEvents(siteId, { events: ["cta_clicked", "page_liked"] });
    expect(result.ok).toBe(false);
    expect((await siteOf(slug, siteId)).expectedEvents).toHaveLength(eventsFor(1)!.length);
  });
});

describe("measurement tier and the consent banner", () => {
  const v2Names = () => eventsFor(2)!.map(event => event.name);
  const siteInput = (productionUrl: string, measurementTier?: string) => ({
    productionUrl,
    framework: "next",
    taxonomyVersion: "2",
    ...(measurementTier === undefined ? {} : { measurementTier }),
  });

  it("a new v2 site is Essentials, with no banner, and expects every v2 event but consent_updated", async () => {
    const slug = await newClient();
    const siteId = await newSite(slug, { taxonomyVersion: "2" });
    const site = await siteOf(slug, siteId);
    expect(site.measurementTier).toBe("essentials");
    expect(site.hasConsentBanner).toBe(false);
    expect(site.expectedEvents.sort()).toEqual(
      v2Names()
        .filter(name => name !== "consent_updated")
        .sort(),
    );
  });

  it("an Insights site has a banner and expects consent_updated too", async () => {
    const slug = await newClient();
    const siteId = await newSite(slug, { taxonomyVersion: "2", measurementTier: "insights" });
    const site = await siteOf(slug, siteId);
    expect(site.hasConsentBanner).toBe(true);
    expect(site.expectedEvents.sort()).toEqual(v2Names().sort());
  });

  it("moving between tiers moves only consent_updated, and a hand-removed event stays removed", async () => {
    const slug = await newClient();
    const productionUrl = `https://${hex()}.example.com`;
    const siteId = await newSite(slug, { productionUrl, taxonomyVersion: "2" });
    const withoutDownloads = (await siteOf(slug, siteId)).expectedEvents.filter(
      name => name !== "file_downloaded",
    );
    expect((await setExpectedEvents(siteId, { events: withoutDownloads })).ok).toBe(true);

    expect((await updateSite(siteId, siteInput(productionUrl, "insights"))).ok).toBe(true);
    const insights = (await siteOf(slug, siteId)).expectedEvents;
    expect(insights.sort()).toEqual([...withoutDownloads, "consent_updated"].sort());

    expect((await updateSite(siteId, siteInput(productionUrl, "growth"))).ok).toBe(true);
    const growth = await siteOf(slug, siteId);
    expect(growth.hasConsentBanner).toBe(true);
    expect(growth.expectedEvents.sort()).toEqual([...withoutDownloads, "consent_updated"].sort());

    expect((await updateSite(siteId, siteInput(productionUrl, "essentials"))).ok).toBe(true);
    const off = await siteOf(slug, siteId);
    expect(off.hasConsentBanner).toBe(false);
    expect(off.expectedEvents.sort()).toEqual([...withoutDownloads].sort());
  });

  it("a change of tier clears the confirmation, and the same tier keeps it", async () => {
    const slug = await newClient();
    const productionUrl = `https://${hex()}.example.com`;
    const siteId = await newSite(slug, {
      productionUrl,
      taxonomyVersion: "2",
      measurementTier: "insights",
    });
    await getDb()
      .update(sites)
      .set({ tierConfirmedFor: "insights", tierConfirmedAt: new Date() })
      .where(eq(sites.id, siteId));

    expect((await updateSite(siteId, siteInput(productionUrl, "insights"))).ok).toBe(true);
    expect((await siteOf(slug, siteId)).tierConfirmation?.tier).toBe("insights");

    expect((await updateSite(siteId, siteInput(productionUrl, "growth"))).ok).toBe(true);
    expect((await siteOf(slug, siteId)).tierConfirmation).toBeNull();
  });

  it("rejects a tier that does not exist", async () => {
    const slug = await newClient();
    const productionUrl = `https://${hex()}.example.com`;
    const siteId = await newSite(slug, { productionUrl });
    const result = await updateSite(siteId, siteInput(productionUrl, "platinum"));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fieldErrors["measurementTier"]).toBeTruthy();
  });

  it("stores the heatmaps choice", async () => {
    const slug = await newClient();
    const siteId = await newSite(slug, { usesHeatmaps: "on" });
    expect((await siteOf(slug, siteId)).usesHeatmaps).toBe(true);
  });

  it("a higher tier on a v1 site adds nothing, since v1 has no consent_updated", async () => {
    const slug = await newClient();
    const productionUrl = `https://${hex()}.example.com`;
    const siteId = await newSite(slug, { productionUrl });
    const before = (await siteOf(slug, siteId)).expectedEvents.sort();
    const result = await updateSite(siteId, {
      productionUrl,
      framework: "astro",
      taxonomyVersion: "1",
      measurementTier: "insights",
    });
    expect(result.ok).toBe(true);
    expect((await siteOf(slug, siteId)).expectedEvents.sort()).toEqual(before);
  });

  it("rejects a signed-out caller without writing", async () => {
    const slug = await newClient();
    const productionUrl = `https://${hex()}.example.com`;
    const siteId = await newSite(slug, { productionUrl, taxonomyVersion: "2" });
    testSession.signedIn = false;
    try {
      await expect(updateSite(siteId, siteInput(productionUrl, "insights"))).rejects.toBeInstanceOf(
        UnauthorisedError,
      );
    } finally {
      testSession.signedIn = true;
    }
    const site = await siteOf(slug, siteId);
    expect(site.hasConsentBanner).toBe(false);
    expect(site.expectedEvents).not.toContain("consent_updated");
  });
});

describe("commercial context", () => {
  it("stores an estimate in minor units", async () => {
    const slug = await newClient();
    const siteId = await newSite(slug);
    const result = await saveCommercialContext(siteId, {
      leadValue: "2,500",
      currency: "GBP",
      leadToCustomerRate: "0.2",
      source: "open_waters_estimate",
    });
    expect(result.ok).toBe(true);
    expect((await siteOf(slug, siteId)).commercial).toEqual({
      leadValueMinor: 250000,
      currency: "GBP",
      leadToCustomerRate: "0.2000",
      source: "open_waters_estimate",
    });
  });

  it("requires a source once a figure is entered", async () => {
    const siteId = await newSite(await newClient());
    const result = await saveCommercialContext(siteId, { leadValue: "2500", currency: "GBP" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors["source"]).toBeDefined();
  });

  it("requires a currency with a lead value", async () => {
    const siteId = await newSite(await newClient());
    const result = await saveCommercialContext(siteId, {
      leadValue: "2500",
      source: "client_confirmed",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors["currency"]).toBeDefined();
  });

  it.each(["1.5", "-0.1", "20%", "abc"])("rejects the rate %j", async leadToCustomerRate => {
    const siteId = await newSite(await newClient());
    const result = await saveCommercialContext(siteId, {
      leadToCustomerRate,
      source: "client_confirmed",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors["leadToCustomerRate"]).toMatch(/between 0 and 1/);
  });

  it("accepts rates 0 and 1, and clearing everything", async () => {
    const slug = await newClient();
    const siteId = await newSite(slug);
    expect(
      (await saveCommercialContext(siteId, { leadToCustomerRate: "0", source: "client_confirmed" }))
        .ok,
    ).toBe(true);
    expect(
      (await saveCommercialContext(siteId, { leadToCustomerRate: "1", source: "client_confirmed" }))
        .ok,
    ).toBe(true);
    expect((await saveCommercialContext(siteId, {})).ok).toBe(true);
    expect((await siteOf(slug, siteId)).commercial).toMatchObject({
      leadValueMinor: null,
      leadToCustomerRate: null,
    });
  });

  it.each([
    ["2500", 250000],
    ["2,500", 250000],
    ["2,500.5", 250050],
    ["2500.05", 250005],
    ["0", 0],
    ["1,234,567.89", 123456789],
  ])("converts %j to %i minor units", (input, minor) => {
    expect(toMinorUnits(input)).toBe(minor);
  });

  it.each(["-5", "2,50", "25.555", "£2500", ""])("does not convert %j", input => {
    expect(toMinorUnits(input)).toBeNull();
  });
});

describe("learning log", () => {
  it("adds, lists newest first, edits and deletes entries", async () => {
    const slug = await newClient();
    const siteId = await newSite(slug);
    await addSiteChange(siteId, { occurredOn: "2026-09-01", kind: "launch", title: "Launch" });
    await addSiteChange(siteId, {
      occurredOn: "2026-10-03",
      kind: "content",
      title: "New hero proposition on Report page",
      expectedEffect: "More Report CTA clicks",
    });

    let changes = (await siteOf(slug, siteId)).changes;
    expect(changes.map(change => change.title)).toEqual([
      "New hero proposition on Report page",
      "Launch",
    ]);
    expect(changes[0]!.expectedEffect).toBe("More Report CTA clicks");

    const launch = changes[1]!;
    expect(
      (
        await updateSiteChange(siteId, launch.id, {
          occurredOn: "2026-09-02",
          kind: "launch",
          title: "Site launch",
        })
      ).ok,
    ).toBe(true);
    await deleteSiteChange(siteId, changes[0]!.id);

    changes = (await siteOf(slug, siteId)).changes;
    expect(changes).toMatchObject([
      { title: "Site launch", occurredOn: "2026-09-02", detail: null },
    ]);
  });

  it("rejects a title over 120 characters", async () => {
    const siteId = await newSite(await newClient());
    const result = await addSiteChange(siteId, {
      occurredOn: "2026-10-03",
      kind: "content",
      title: "x".repeat(121),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors["title"]).toMatch(/120/);
  });

  it.each(["03/10/2026", "2026-02-30", ""])("rejects the date %j", async occurredOn => {
    const siteId = await newSite(await newClient());
    const result = await addSiteChange(siteId, { occurredOn, kind: "content", title: "X" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors["occurredOn"]).toBeDefined();
  });
});
