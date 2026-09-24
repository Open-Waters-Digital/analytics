## 1. Confirming PostHog's API

- [ ] 1.1 Against Open Waters' own project, and read-only, confirm the endpoint, field names and allowed values:
  - `/api/projects/:id/`, and the values of `cookieless_server_hash_mode`, `anonymize_ips`, `session_recording_opt_in`, the heatmaps setting, `app_urls`, `test_account_filters` and `timezone`
  - the dashboard and insight endpoints
  - tags on insights
  - the proxy record endpoint
  - the key scopes each needs

  Verify by recording the findings, with the date, in `src/server/provisioning/posthog-fields.ts`'s header.

- [ ] 1.2 Establish whether an `$ip` internal-traffic filter matches anything with IP discarding on. Verify by recording the answer in design.md's finding, and proposing the skill correction as its own commit in `~/.agents`.

## 2. Data

- [ ] 2.1 Add `posthog_provisioning_runs` (design D5), and `uses_heatmaps` (boolean, default false) on `sites`, to the schema. Run `pnpm db:generate`, and review and commit the SQL. Verify that it is additive, and that `node dist/migrate.mjs` applies it to a fresh database.

## 3. Desired state and diff

- [ ] 3.1 Implement `desiredProject(site)` and `desiredInsights(version)` from the registry and `BASELINE_DASHBOARDS`. Verify with unit tests for v2 and v3, with the v3 insights present only at v3, and with heatmaps required on only for a site marked `uses_heatmaps`.
- [ ] 3.1a Add the "Uses aggregate heatmaps" checkbox to the site form. Verify at 375px, and that the saved value survives a failed validation on another field.
- [ ] 3.2 Implement `diff` (design D3). Verify with unit tests for each of these:
  - a fresh project
  - an already-matching project, with no differences
  - a filter that excludes the production host, flagged
  - a filter with other conditions, kept
  - authorised URLs in a different order, not a difference
  - an insight differing only in PostHog's defaults, not a difference
  - a hand-added insight, ignored

## 4. PostHog client

- [ ] 4.1 Add project, dashboard and insight read and write calls to `src/server/posthog.ts`'s pattern: region host, 10-second timeout, fixed messages, and a single message naming the required scopes for 401 and 403. Verify with tests against a local stub server for each of these:
  - success
  - 401, 403 and 404
  - 500
  - a timeout
  - a malformed body
  - no key in any thrown error or log

## 5. Actions

- [ ] 5.1 Implement `checkProvisioning` and `applyProvisioning` (design D1, D2, D6). Each checks the session first, reads the project id from the stored connection, records a run, and returns differences with no key. Verify with integration tests against the compose database and the stub:
  - a signed-out call is rejected with no outbound request
  - a check makes no write
  - an apply then a second apply, where the second makes no write
  - a timeout after the settings step records `partial`, and the next check lists only the rest
  - the run rows hold no values

## 6. Panel

- [ ] 6.1 Build the "PostHog project" panel on the client page:
  - the latest run
  - the project id and region
  - the key field with its scopes
  - Check and Apply
  - the difference table
  - the manual steps with a link to the skill
  - the proxy status

  Use existing primitives only. Verify at 375px first, then wide, with a failing key, a fresh project and a matched project.

## 7. Real run

- [ ] 7.1 Check and apply against Open Waters' own project, using a key made for the purpose, and then delete the key. Verify by recording the first run's differences, the second apply's "nothing to change", and the dashboard's insights, in the task note.

## 8. Documents and skill

- [ ] 8.1 Edit the skill's setup steps 3 to 5 to "run provisioning from the analytics app", with the remaining manual list, and the internal-traffic correction from 1.2. Verify the diff in `~/.agents`, and commit there.
- [ ] 8.2 Sweep AGENTS.md (the feature line, the provisioning table, the repo tree) and add the provisioning terms to CONTEXT.md. Verify by rereading them against the code.

## 9. The gate

- [ ] 9.1 Run `pnpm run ci:quality` and report its real output. Verify that it passes, with no task ticked on a failing run.
