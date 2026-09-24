# Design: adopt the contract package

## Context

- `src/lib/event-list.ts` is imported by five modules:
  - the site registry and its schemas
  - the client page
  - `fields.ts`
  - `snapshot-metrics.ts`
- `snapshot-metrics.test.ts` fails when a listed event has no metric. That rule
  stays, and is what forces this change to add the v2 and v3 metrics.
- The package's `/contract` entry point exports:
  - `EVENT_LISTS`, per version, with each event's stage and origin
  - `TAXONOMY_VERSION`
  - `PAGE_TYPES`
  - `CHANNELS`
  - `classifyChannel`
  - `BASELINE_DASHBOARDS`

  It imports nothing at runtime. It is published privately on GitHub Packages
  (see that repo's `create-the-package`, D6).

## Goals / Non-Goals

**Goals:**

- No event list is defined in this repository.
- v2 and v3 sites can be registered and snapshotted correctly.

**Non-Goals:**

- The drift check, which is still planned. It will read the same adapter.
- Provisioning, which is `add-provisioning`.
- Re-pulling history for the new metrics beyond the normal window.

## Decisions

### D1. Keep `event-list.ts` as an adapter

The module keeps its exports and becomes a mapping from the package's shape to
the existing `ListedEvent`, whose stage gains `consent`. Callers do not change,
and the diff stays small.

- **Rejected: importing the package everywhere.** It spreads the package's
  shape across five modules for no gain.

### D2. `has_consent_banner` on sites

It is a boolean column, default false, not null. Expected-event defaults read
it. Toggling it adds or removes exactly one expected event, `consent_updated`,
in the same transaction as the update.

- **Rejected: inferring the banner from `consent_updated` arriving.** A banner
  that breaks would then stop being expected, which hides the very failure the
  drift check exists to find.
- **Rejected: a free list of "optional events" per version.** It is more
  general than the one case that exists.

### D3. `(not recorded)` beside `(none)`

A new constant, `NOT_RECORDED_DIMENSION_VALUE`, goes next to
`NO_DIMENSION_VALUE`. The v3 metric queries pick between them by the site's
taxonomy version, which the collector already has:

- below v3, a missing property is `(not recorded)`
- at v3 and above, a missing optional property is `(none)`

`channel` is required at v3, so a v3 lead without one is a site bug. It shows
as `(none)`, which the drift check will later flag.

The queries are added to `posthog-queries.ts` in the same form as the
existing breakdowns. They use the same 200-character truncation and top-50
limit.

### D4. The token in the image build

The app's Dockerfile installs in a `deps` stage. The token is supplied in
whichever of the package README's two patterns Railway supports. If it is a
BuildKit secret, it is mounted on the install. Otherwise it is an `ARG`
confined to `deps`, and the standalone runtime stage copies only what it
needs. Either way `docker history --no-trunc` and a filesystem search of the
runtime image must not find it.

The app's standalone output means the runtime stage never contains
`node_modules` from `deps` wholesale. That already narrows the exposure.

## Risks / Trade-offs

- **[A release adds an event, and the metric test fails on the Renovate pull
  request.]** → That is intended. The pull request cannot merge until the
  metric exists, so the app is never silently behind the contract. Minor
  releases are review-only in the preset anyway.
- **[Build depends on GitHub Packages.]** → The frozen lockfile and Railway's
  layer cache mean an outage fails a deploy rather than breaking the running
  app.

## Migration Plan

1. `pnpm db:generate` for `has_consent_banner`. It is additive, and applied by
   the pre-deploy step.
2. Deploy.
3. Open Waters' own site is at v1 and stays so until its own adoption. Nothing
   changes in its data.
4. After a site moves to v2 or v3, a partner updates its version in the
   registry, and marks the banner if there is one.

**Rollback:** the column is additive and the metrics are additive rows. Revert
the deploy.
