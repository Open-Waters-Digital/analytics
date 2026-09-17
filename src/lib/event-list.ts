/**
 * The shared Open Waters event list, mirrored from the openwaters-analytics
 * skill: ~/.agents/skills/openwaters-analytics/references/events.md.
 *
 * A copy by necessity (the skill lives outside this repo). Change the skill
 * first, as a new version, then mirror it here as a new entry; never edit a
 * published version in place, because sites record which version they send.
 * PostHog's own $pageview and $pageleave are sent by every site and are not
 * listed.
 */

export type EventStage = "intent" | "action" | "revenue";

export interface ListedEvent {
  name: string;
  stage: EventStage;
  /** Sent by the site's server rather than the browser. */
  server: boolean;
}

const VERSION_1: readonly ListedEvent[] = [
  { name: "cta_clicked", stage: "intent", server: false },
  { name: "contact_link_clicked", stage: "intent", server: false },
  { name: "file_downloaded", stage: "intent", server: false },
  { name: "outbound_link_clicked", stage: "intent", server: false },
  { name: "scroll_depth_reached", stage: "intent", server: false },
  { name: "video_played", stage: "intent", server: false },
  { name: "form_started", stage: "action", server: false },
  { name: "form_error_shown", stage: "action", server: false },
  { name: "form_abandoned", stage: "action", server: false },
  { name: "form_submitted", stage: "action", server: false },
  { name: "lead_submitted", stage: "action", server: true },
  { name: "lead_qualified", stage: "revenue", server: true },
  { name: "deal_won", stage: "revenue", server: true },
];

export const EVENT_LISTS: Readonly<Record<number, readonly ListedEvent[]>> = { 1: VERSION_1 };

export const EVENT_LIST_VERSION = 1;

export function eventsFor(version: number): readonly ListedEvent[] | undefined {
  return EVENT_LISTS[version];
}

export function isKnownVersion(version: number): boolean {
  return eventsFor(version) !== undefined;
}
