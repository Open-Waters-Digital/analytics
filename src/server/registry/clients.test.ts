import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testSession } from "@/test/mock-session";
import { UnauthorisedError } from "@/server/session-policy";
import { createClient, getClientDetail, listClients, updateClient } from "./clients";

vi.mock("@/server/session", () => import("@/test/mock-session"));

function uniqueSlug(prefix = "client") {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

afterEach(() => {
  testSession.signedIn = true;
});

describe("createClient", () => {
  it("creates a client with status onboarding", async () => {
    const slug = uniqueSlug("radara");
    const result = await createClient({
      name: "Radara Health",
      slug,
      analyticsOwnership: "open_waters",
      regulated: "on",
    });
    expect(result).toEqual({ ok: true, value: { slug } });

    const detail = await getClientDetail(slug);
    expect(detail).toMatchObject({
      name: "Radara Health",
      status: "onboarding",
      analyticsOwnership: "open_waters",
      regulated: true,
      sites: [],
      recipients: [],
    });
  });

  it("rejects a duplicate slug with a field error", async () => {
    const slug = uniqueSlug();
    await createClient({ name: "First", slug, analyticsOwnership: "open_waters" });
    const result = await createClient({ name: "Second", slug, analyticsOwnership: "open_waters" });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { slug: "That slug is already in use by another client." },
    });
  });

  it.each([
    "Radara Health",
    "-radara",
    "radara--health",
    "radara-",
    "r",
    "1radara",
    "a".repeat(41),
  ])("rejects the slug %j", async slug => {
    const result = await createClient({ name: "X", slug, analyticsOwnership: "open_waters" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors["slug"]).toMatch(/lowercase letters/);
  });

  it("requires a name, reporting every invalid field at once", async () => {
    const result = await createClient({ name: "  ", slug: "", analyticsOwnership: "nobody" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors).sort()).toEqual([
        "analyticsOwnership",
        "name",
        "slug",
      ]);
    }
  });

  it("rejects a signed-out caller without writing", async () => {
    testSession.signedIn = false;
    const slug = uniqueSlug();
    await expect(
      createClient({ name: "X", slug, analyticsOwnership: "open_waters" }),
    ).rejects.toBeInstanceOf(UnauthorisedError);
    testSession.signedIn = true;
    expect(await getClientDetail(slug)).toBeNull();
  });
});

describe("updateClient", () => {
  it("changes name, status, ownership and regulated, but never the slug", async () => {
    const slug = uniqueSlug();
    await createClient({
      name: "Before",
      slug,
      analyticsOwnership: "open_waters",
      regulated: "on",
    });

    const result = await updateClient(slug, {
      name: "After",
      slug: "a-different-slug",
      status: "active",
      analyticsOwnership: "client_owned",
    });
    expect(result.ok).toBe(true);

    expect(await getClientDetail("a-different-slug")).toBeNull();
    expect(await getClientDetail(slug)).toMatchObject({
      slug,
      name: "After",
      status: "active",
      analyticsOwnership: "client_owned",
      regulated: false,
    });
  });

  it("rejects an unknown status", async () => {
    const slug = uniqueSlug();
    await createClient({ name: "X", slug, analyticsOwnership: "open_waters" });
    const result = await updateClient(slug, {
      name: "X",
      status: "deleted",
      analyticsOwnership: "open_waters",
    });
    expect(result.ok).toBe(false);
  });
});

describe("listClients", () => {
  it("hides offboarded clients unless asked, and sorts by name", async () => {
    const tag = randomBytes(3).toString("hex");
    const zed = uniqueSlug("zed");
    const alpha = uniqueSlug("alpha");
    const gone = uniqueSlug("gone");
    await createClient({ name: `Zed ${tag}`, slug: zed, analyticsOwnership: "open_waters" });
    await createClient({ name: `alpha ${tag}`, slug: alpha, analyticsOwnership: "open_waters" });
    await createClient({ name: `Gone ${tag}`, slug: gone, analyticsOwnership: "open_waters" });
    await updateClient(gone, {
      name: `Gone ${tag}`,
      status: "offboarded",
      analyticsOwnership: "open_waters",
    });

    const mine = (list: Awaited<ReturnType<typeof listClients>>) =>
      list.filter(client => client.name.endsWith(tag)).map(client => client.slug);

    expect(mine(await listClients())).toEqual([alpha, zed]);
    expect(mine(await listClients({ includeOffboarded: true }))).toEqual([alpha, gone, zed]);
  });

  it("rejects a signed-out caller", async () => {
    testSession.signedIn = false;
    await expect(listClients()).rejects.toBeInstanceOf(UnauthorisedError);
  });
});
