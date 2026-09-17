# Proposal

## Why

Every later feature (nightly snapshots, the drift check, the overview, reports)
needs to know which clients exist, which sites they run, and how to reach each
site's data. Right now that knowledge lives in people's heads and the
`openwaters-analytics` skill's setup checklist. The registry makes it the app's
first real data, and proves a PostHog key works the moment it is entered rather
than when the first nightly run fails.

## What Changes

- **Clients**: create, view, edit and change status (onboarding, active, paused,
  offboarded). Slug is fixed at creation because it must match `SITE_SLUG` in
  the client's site code. No hard delete; offboarding keeps history.
- **Sites** per client: production URL, framework, repository, launch date,
  event list version and timezone.
- **Analytics ownership** per client (`open_waters` or `client_owned`) and a
  `regulated` flag.
- **Report recipients** per client: name and work email.
- **PostHog connection** per site: region, project ID and an API key. Saving
  runs a live check against PostHog and only stores the key if the check passes.
  Keys are encrypted at rest, never shown again beyond their last four
  characters, never sent to the browser and never logged. A **Test connection**
  button re-runs the check.
- **Search Console property** per site, stored for the later pull. Not checked
  in this change.
- **Expected events** per site: which events from the shared event list the
  site should send, all ticked by default.
- **Commercial context** per site: average lead value, lead-to-customer rate and
  whether the figures are client-confirmed or an Open Waters estimate.
- **Learning log** per site: dated entries for launches, design and content
  changes, campaigns, experiments and tracking changes.
- **Screens**: clients list, new client, client detail (sites, connections,
  expected events, commercial context, learning log, recipients) and the forms
  those need.
- **Adds tables**: clients, sites, report recipients, PostHog connections,
  Search Console properties, expected events, commercial context and site
  changes.
- **Adds a secret**: `CREDENTIALS_ENCRYPTION_KEY`, the master key for client API
  keys.
- **Adds an outbound call**: PostHog's query API, read-only, with a 10-second
  timeout.

## Capabilities

### New Capabilities

- `client-registry`: clients, sites, report recipients, expected events,
  commercial context and the learning log: what can be recorded, the rules on
  each field, and how it is listed and changed.
- `data-connections`: storing and checking access to a site's external data
  sources (PostHog now, Search Console stored for later): encryption, what is
  shown, what a check does and how failures appear.

### Modified Capabilities

None. `access-control` (from `add-magic-link-auth`) applies to every screen and
action here unchanged.

## Impact

- **Depends on** `add-magic-link-auth`: every registry read and write goes
  through `requireSession()`.
- **Database:** eight new tables and Postgres enums, one migration.
- **Environment:** `CREDENTIALS_ENCRYPTION_KEY` (32 random bytes, base64).
  Losing it makes stored keys unreadable; they would need re-entering. Listed
  as a first-deploy item in AGENTS.md.
- **Outbound:** `https://eu.posthog.com` or `https://us.posthog.com`,
  `POST /api/projects/:id/query/`.
- **Code:** `src/db/schema.ts`, `src/server/registry/*`, `src/server/crypto.ts`,
  `src/server/posthog.ts`, `src/lib/event-list.ts`, routes under
  `src/app/(app)/clients/`.
- **New primitives** (each on `/design-system` with every state): `Select`,
  `Textarea`, `Checkbox`, `Alert` (tones: info, success, warning, danger) and
  `DescriptionList`. No new tokens.
- **375px:** forms are one column; the clients table scrolls horizontally inside
  its panel; client detail panels stack.
