import { describe, expect, it } from "vitest";
import { EVENT_LIST_VERSION, eventsFor, isKnownVersion } from "./event-list";

// The package pins every published version itself; these check that the
// adapter exposes them, not what they contain.
describe("event list", () => {
  it("knows versions 1 to 3, and not a version that does not exist", () => {
    expect([1, 2, 3].every(isKnownVersion)).toBe(true);
    expect(isKnownVersion(9)).toBe(false);
    expect(eventsFor(9)).toBeUndefined();
  });

  it("defaults new sites to the newest version the package knows", () => {
    expect(EVENT_LIST_VERSION).toBe(3);
  });

  it("maps the contract's shape: consent from v2, server events flagged", () => {
    expect(eventsFor(1)?.some(event => event.name === "consent_updated")).toBe(false);
    expect(eventsFor(2)?.find(event => event.name === "consent_updated")?.stage).toBe("consent");
    expect(eventsFor(3)?.find(event => event.name === "lead_submitted")).toEqual({
      name: "lead_submitted",
      stage: "action",
      server: true,
    });
  });
});
