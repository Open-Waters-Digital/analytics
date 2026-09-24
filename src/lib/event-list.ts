/**
 * The shared Open Waters event list, read from the contract package,
 * @open-waters-digital/analytics (repo Open-Waters-Digital/analytics-contract).
 *
 * No event list is defined in this repository. The package keeps every
 * taxonomy version exactly as published, and pins them itself, so a new
 * version reaches this app as a Renovate pull request rather than an edit
 * here. This module only maps the package's shape onto the one the registry
 * and the snapshot were written against, so none of their code changes.
 * PostHog's own $pageview and $pageleave are sent by every site and are not
 * listed.
 */
import {
  CURRENT_VERSION,
  EVENT_LISTS as CONTRACT_EVENT_LISTS,
  VERSIONS,
} from "@open-waters-digital/analytics/contract";

export type EventStage = "intent" | "action" | "consent" | "revenue";

export interface ListedEvent {
  name: string;
  stage: EventStage;
  /** Sent by the site's server rather than the browser. */
  server: boolean;
}

/**
 * The contract's "attention" stage holds only PostHog's own events, which are
 * never listed. If a listed event ever carries it, the contract has changed in
 * a way this app does not handle, so it fails at import, loudly.
 */
function listedStage(name: string, stage: string): EventStage {
  if (stage === "intent" || stage === "action" || stage === "consent" || stage === "revenue") {
    return stage;
  }
  throw new Error(`event-list: ${name} has stage ${stage}, which this app does not list`);
}

export const EVENT_LISTS: Readonly<Record<number, readonly ListedEvent[]>> = Object.fromEntries(
  VERSIONS.map(version => [
    version,
    CONTRACT_EVENT_LISTS[version].map(event => ({
      name: event.name,
      stage: listedStage(event.name, event.stage),
      server: event.origin === "server",
    })),
  ]),
);

/** The newest version the installed package knows: new sites default to it. */
export const EVENT_LIST_VERSION: number = CURRENT_VERSION;

export function eventsFor(version: number): readonly ListedEvent[] | undefined {
  return EVENT_LISTS[version];
}

export function isKnownVersion(version: number): boolean {
  return eventsFor(version) !== undefined;
}
