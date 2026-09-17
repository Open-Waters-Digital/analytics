import { describe, expect, it } from "vitest";
import { EVENT_LIST_VERSION, eventsFor, isKnownVersion } from "./event-list";

describe("event list", () => {
  // Pins version 1 exactly. If this fails, the copy has drifted from the
  // openwaters-analytics skill's events.md, or a published version was edited.
  it("matches version 1 of the openwaters-analytics skill", () => {
    expect(eventsFor(1)?.map(event => [event.name, event.stage, event.server])).toEqual([
      ["cta_clicked", "intent", false],
      ["contact_link_clicked", "intent", false],
      ["file_downloaded", "intent", false],
      ["outbound_link_clicked", "intent", false],
      ["scroll_depth_reached", "intent", false],
      ["video_played", "intent", false],
      ["form_started", "action", false],
      ["form_error_shown", "action", false],
      ["form_abandoned", "action", false],
      ["form_submitted", "action", false],
      ["lead_submitted", "action", true],
      ["lead_qualified", "revenue", true],
      ["deal_won", "revenue", true],
    ]);
  });

  it("has the current version", () => {
    expect(EVENT_LIST_VERSION).toBe(1);
    expect(isKnownVersion(EVENT_LIST_VERSION)).toBe(true);
    expect(isKnownVersion(2)).toBe(false);
  });
});
