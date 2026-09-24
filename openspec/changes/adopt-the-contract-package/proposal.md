# Adopt the contract package

## Why

This app keeps its own copy of the shared event list, in
`src/lib/event-list.ts`, pinned to the skill by a test. It is one of the three
copies that `@open-waters-digital/analytics` exists to replace. See that repo's
`create-the-package`, whose design records why.

The copy is also behind. It knows only taxonomy v1. v2 added
`consent_updated` and `ad_consent` on 22 September 2026. v3 (`split-leads-by-channel`)
adds a channel to every lead. A site on either version would be registered
against a list that does not have its events.

## What Changes

- **The contract comes from the package.**
  - `src/lib/event-list.ts` keeps its API (`eventsFor`, `isKnownVersion`,
    `EVENT_LIST_VERSION`) but reads `@open-waters-digital/analytics/contract`,
    so no caller changes.
  - Its pinning test is deleted, because the package pins its own versions.
  - Versions 1 to 3 are known.
- **Expected events respect a consent banner.**
  - Sites gain `has_consent_banner` (boolean, default false).
  - `consent_updated` is expected only on a site with a banner.
  - Every other default is unchanged: the whole list for the site's version,
    edited per site as before.
- **New snapshot metrics**, following the rule that every listed event has a
  metric:
  - `consent_updated` by `advertising`, and `page_views_by_ad_consent`, from v2
  - `leads_by_channel` and `leads_by_heard_about`, from v3
  - A v1 or v2 site's leads are stored under the dimension `(not recorded)`,
    not `(none)`, so a report can tell "the site does not send it" apart from
    "the property was empty".
- **Installing the private package.**
  - `.npmrc` gets the scope line.
  - CI gets a `read:packages` secret.
  - The Docker build installs with the token kept out of the final image,
    following the package README's pattern.
  - `.railway/railway.ts` lists `NODE_AUTH_TOKEN` with `preserve()`.
- **Renovate:** `renovate.json` extends the organisation's settings (`renovate-config`) and then the package's own rules.

## Capabilities

### New Capabilities

- `contract-adoption`: how this app reads the shared contract, which events a
  site is expected to send, and the metrics that come from the v2 and v3
  events.

### Modified Capabilities

None in `openspec/specs/`. The affected behaviour belongs to the unarchived
`add-client-registry` and `add-nightly-snapshot` changes, so it is stated here
as a new capability, not as deltas against specs that do not exist yet.

## Impact

- **Depends on:** `@open-waters-digital/analytics` 1.2.0 being published
  (`create-the-package`, then `split-leads-by-channel`).
- **Tables:**
  - One column added to `sites`, with a migration.
  - No new table.
  - `site_daily_metrics` gains rows for four new metric names, and no new
    columns.
- **Secrets:** `NODE_AUTH_TOKEN`, a GitHub token limited to `read:packages`.
  - It sits in CI secrets and as a Railway build variable.
  - It is never in the runtime image, never logged, and never reaches the
    browser.
  - It grants reading private packages only.
- **Outbound calls:**
  - The nightly queries gain four metrics, on the existing HogQL call with its
    existing timeout.
  - The only other new network access is the install from GitHub Packages at
    build time.
- **UI:**
  - The site form gains a "Has a consent banner" checkbox, using the existing
    `Field` primitive.
  - The client page's metrics panel lists the new metrics.
  - No new primitive or token. The site form's existing 375px layout is
    unchanged by one more checkbox.
