## 1. Confirming PostHog's API

- [x] 1.1 Against Open Waters' own project, and read-only, confirm the endpoint, field names and allowed values:
  - `/api/projects/:id/`, and the values of `cookieless_server_hash_mode`, `anonymize_ips`, `session_recording_opt_in`, the heatmaps setting, `app_urls`, `test_account_filters` and `timezone`
  - the project fields for masking every input in recordings, and for recording retention, if the API exposes them
  - the dashboard and insight endpoints
  - whether tags on insights and dashboards are available on the organisation's plan
  - the proxy record endpoint
  - the key scopes each needs

  Verify by recording the findings, with the date, in `src/server/provisioning/posthog-fields.ts`'s header.

- [x] 1.2 Establish whether an `$ip` internal-traffic filter matches anything with IP discarding on. Verify by recording the answer in design.md's finding, and proposing the skill correction as its own commit in `~/.agents`.

## 2. Data

- [x] 2.1 Add `posthog_provisioning_runs` (design D5), `posthog_provisioned_objects` (design D2), `uses_heatmaps` (boolean, default false), and `measurement_tier` with the three `tier_confirmed_*` columns (design D5a) on `sites`, to the schema, with the backfill from `has_consent_banner`. Run `pnpm db:generate`, and review and commit the SQL. Verify that it is additive, and that `node dist/migrate.mjs` applies it to a fresh database.

## 3. Desired state and diff

- [x] 3.1 Implement `desiredProject(site)` and `desiredInsights(version)` from the registry and `BASELINE_DASHBOARDS`. Verify with unit tests for v2 and v3, with the v3 insights present only at v3, and with heatmaps required on only for a site marked `uses_heatmaps`.
- [x] 3.1a Add the "Uses aggregate heatmaps" checkbox to the site form. Verify at 375px, and that the saved value survives a failed validation on another field.
- [x] 3.1b Replace the "Has a consent banner" checkbox with the measurement tier (design D5a): the banner written from the tier, the expected events following it, and the confirmation cleared when the tier changes. Verify with integration tests for Essentials to Insights, Insights to Growth, Growth to Essentials, and the expected events after each, and at 375px.
- [x] 3.1c Make `desiredProject` tier-aware, with recording held until the tier is confirmed. Verify with unit tests for each tier, confirmed and not, and for a confirmation made for a different tier.
- [x] 3.2 Implement `diff` (design D3). Verify with unit tests for each of these:
  - a fresh project
  - an already-matching project, with no differences
  - a filter that excludes the production host, flagged
  - a filter with other conditions, kept
  - authorised URLs in a different order, not a difference
  - an insight differing only in PostHog's defaults, not a difference
  - a hand-added insight, ignored
  - a recorded insight deleted in PostHog, reported missing
  - no recorded row but a description marker, adopted and not duplicated
  - a recorded row for another project id, ignored
  - a cohort condition in the internal-traffic filter, not a difference

## 4. PostHog client

- [x] 4.1 Add project, dashboard and insight read and write calls to `src/server/posthog.ts`'s pattern: region host, 10-second timeout, fixed messages, and a single message naming the required scopes for 401 and 403. Verify with tests against a local stub server for each of these:
  - success
  - 401, 403 and 404
  - 500
  - a timeout
  - a malformed body
  - no key in any thrown error or log

## 5. Actions

- [x] 5.1 Implement `checkProvisioning` and `applyProvisioning` (design D1, D2, D6). Each checks the session first, reads the project id from the stored connection, records a run, and returns differences with no key. Verify with integration tests against the compose database and the stub:
  - a signed-out call is rejected with no outbound request
  - a check makes no write
  - an apply then a second apply, where the second makes no write
  - a timeout after the settings step records `partial`, and the next check lists only the rest
  - the run rows hold no values

- [x] 5.2 Implement the tier confirmation action (design D5a): the session check, both conditions required, and who, when and which tier recorded. Verify with integration tests for a signed-out call, a missing condition, and an apply before and after confirming, where only the second allows recording.

## 6. Panel

- [x] 6.1 Build the "PostHog project" panel on the client page:
  - the latest run
  - the project id and region
  - the key field with its scopes
  - Check and Apply
  - the difference table
  - the manual steps with a link to the skill
  - the site's tier, whether it is confirmed and by whom, the confirm form, and the site-side work the tier needs
  - the proxy status

  Use existing primitives only. Verify at 375px first, then wide, with a failing key, a fresh project and a matched project.

  Accepted by Alex on 25 September 2026 without a signed-in browser check, as with the registry's earlier 375px checks: an internal tool for two people, and a layout problem is fixed in use.

## 7. Real run

- [x] 7.1 Check and apply against Open Waters' own project, using a key made for the purpose, and then delete the key. Verify by recording the first run's differences, the second apply's "nothing to change", and the dashboard's insights, in the task note.
      Run on 25 September 2026 against project 277423 (EU), through `checkProvisioning` and `applyProvisioning` with the registry entry reproduced on a throwaway database, since the production registry is not reachable from a developer machine.
  - First check: timezone UTC → Europe/London, authorised URLs empty → the Railway origin, session recording on → off, the baseline dashboard and all 19 v3 insights missing. Cookieless mode, IP discarding and heatmaps already matched; the default cohort filter was correctly not flagged.
  - First apply: 21 steps, outcome `applied`. Second apply: `matched`, no write.
  - Read back from PostHog: the settings as required, the "Digital Dividend baseline" dashboard (974959), 19 insights marked `ow:`. Three run through the query API without error: the session breakdown, the ratio formula and the funnel.
  - Not yet confirmed: the masking config's shape, which only an Insights-tier apply writes. The personal key is Alex's to delete.

## 8. Documents and skill

- [x] 8.1 Edit the skill's setup steps 3 to 5 to "run provisioning from the analytics app", with the remaining manual list, and the internal-traffic correction from 1.2. Verify the diff in `~/.agents`, and commit there.
- [x] 8.2 Sweep AGENTS.md (the feature line, the provisioning table, the repo tree) and add the provisioning terms to CONTEXT.md. Verify by rereading them against the code.

## 9. The gate

- [x] 9.1 Run `pnpm run ci:quality` and report its real output. Verify that it passes, with no task ticked on a failing run.
