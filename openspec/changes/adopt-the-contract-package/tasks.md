## 1. Installing the package

- [x] 1.1 Add the `.npmrc` scope line and `@open-waters-digital/analytics` at `^1.2.0`. Verify with a frozen install locally, using a `read:packages` token.
  - `.npmrc` gets the scope, and `^1.2.0` is installed with a `read:packages` token. pnpm refused 1.2.0 on its release day under the one-day rule, and quietly wrote its own exemption. That was replaced with a deliberate one for our own scope, `@open-waters-digital/*`, plus `minimumReleaseAgeStrict: true`. Proved by removing the pattern, which makes the frozen install fail. pnpm 11 also installed the optional posthog peers; there is no runtime cost, since `/contract` imports neither, and `core-js: false` is added.
- [ ] 1.2 Add `NODE_AUTH_TOKEN` to the CI workflow's install step from a repository secret, and hand setting the secret to Alex. Verify with a green CI run on the branch.
  - Written: the install step and the Docker build both read `secrets.NODE_AUTH_TOKEN`. Waiting on Alex to set the repository secret and on a green CI run.
- [x] 1.3 Update the Dockerfile per design D4, and list `NODE_AUTH_TOKEN` with `preserve()` in `.railway/railway.ts`. Verify that `docker history --no-trunc` and a filesystem grep of the runtime image find no token. Also verify that `railway config plan` shows no deletion; hand the apply to Alex.
  - The Dockerfile has `ARG NODE_AUTH_TOKEN` in the `deps` stage only. A real image built with the real token showed it 0 times in `docker history --no-trunc`, 0 in `docker image inspect`, and 0 files in the filesystem. Both services list it with `preserve()`. `railway config plan` shows 1 to add, 0 to change and 0 to destroy; the one addition is `analytics-jobs`, from the unpushed nightly-snapshot work, not this change. Apply is Alex's.
- [x] 1.4 Add `renovate.json` extending `github>Open-Waters-Digital/renovate-config` then `github>Open-Waters-Digital/analytics-contract//renovate/default`. Verify with `renovate-config-validator`.
  - Validated as repo config, run from outside the repo: the repo's `engine-strict` stops npx.

## 2. The contract adapter

- [x] 2.1 Rewrite `src/lib/event-list.ts` over `/contract` (design D1), with `consent` added to `EventStage`, and delete `event-list.test.ts`'s pinned copy. Verify that `pnpm run typecheck` passes with no caller changed, and that a new test asserts versions 1 to 3 are known.
  - Typecheck is clean with no caller changed. The stage is checked, not cast: an "attention" event would fail at import. `STAGE_LABELS` gains Consent. The new test covers versions 1 to 3, the default of 3, and the shape mapping.
- [x] 2.2 Test the registry's version validation. Verify that saving version 9 returns a field error and writes nothing.
  - Version 9 gets the field error "Choose an event list version that exists." and writes nothing. Versions 1 to 3 are accepted.

## 3. Consent banner

- [x] 3.1 Add `has_consent_banner` to `sites` in `src/db/registry-schema.ts`. Run `pnpm db:generate`, and review and commit the SQL. Verify that it is additive only, and that `node dist/migrate.mjs` applies it to a fresh database.
  - `0003_site_consent_banner.sql` is a single `ADD COLUMN ... DEFAULT false NOT NULL`, additive only. `node dist/migrate.mjs` applied all 4 migrations to a fresh database, and the drift check finds nothing to generate.
- [x] 3.2 Make the expected-event defaults and the banner toggle behave as design D2 describes. Verify with integration tests against the compose database:
  - a v2 site without a banner
  - with a banner
  - a banner toggled on and then off, with a hand-removed event staying removed
  - a signed-out call rejected
  - Five integration tests: a v2 site without a banner, a v2 site with one, a toggle on then off with a hand-removed event staying removed, a banner on v1 adding nothing, and a signed-out call rejected without writing. `SiteDetail` gains `hasConsentBanner`.
- [x] 3.3 Add the checkbox to the site form. Verify at 375px, and confirm that a saved value survives a failed validation on another field.
  - The checkbox is in, and the form re-checks it from the submitted values after a failed validation (existing registry-form behaviour). Accepted without a browser check on 2026-09-24 (Alex): an internal tool, low risk, to be fixed if it looks wrong in use.

## 4. Metrics

- [x] 4.1 Add `consent_updated`, `page_views_by_ad_consent`, `leads_by_channel` and `leads_by_heard_about` to `snapshot-metrics.ts`, with their queries in `posthog-queries.ts` and `NOT_RECORDED_DIMENSION_VALUE` (design D3). Verify that the "every listed event has a metric" test passes for versions 1 to 3, and fails when a metric is removed.
  - Four metrics, and a `consent` query group. Per design D3 the choice between (not recorded) and (none) was to use the site's version; it uses each event's own `taxonomy_version` instead, in the query, which also handles a mid-week upgrade. `page_views_by_ad_consent` carries no `event`, like the other page-view metrics. Removing the `consent_updated` metric fails the coverage test, naming it.
- [x] 4.2 Test the collector against recorded query responses. Verify each of these:
  - v2 leads land in `(not recorded)`
  - v3 leads split by channel
  - an empty v3 `heard_about` is `(none)`
  - over-long values are truncated
  - a failing query for one metric fails that site's run without partial rows
  - Five collector tests: (not recorded), a channel split with an empty heard_about as (none), consent choices, truncation, and one failing group failing the site with nothing stored.
- [x] 4.3 Show the new metrics on the client page's panel. Verify at 375px with seeded rows.
  - Seven-day breakdown totals are in the reader, with a test, and shown as lines under the daily table using existing primitives only. Accepted without a browser check on 2026-09-24 (Alex): an internal tool, low risk, to be fixed if it looks wrong in use.

## 5. Documents

- [x] 5.1 Sweep AGENTS.md and CONTEXT.md. Verify by rereading them against the code.
  - The event list now comes from the package.
  - Add the `has_consent_banner` term.
  - Add the new metrics.
  - Add the token to the secrets list.
  - Refresh the repo tree.
  - AGENTS.md covers the package, the banner rule, the new metrics, `NODE_AUTH_TOKEN`, the repo tree and the 5433 clash with luxury-gardens. CONTEXT.md gains Consent banner and (not recorded). `.env.example` gains the token.

## 6. The gate

- [x] 6.1 Run `pnpm run ci:quality` and report its real output. Verify that it passes, with no task ticked on a failing run.

  - 2026-09-24: lint clean, typecheck clean, 21 files and 315 tests passed, Prettier clean, build done. Test files now run one at a time (`fileParallelism: false`). A shared-database race between collect.test.ts and read.test.ts, older than this change but made more frequent by its collector tests, failed one run in three. Five consecutive runs then passed, at about 4.5 seconds each.
