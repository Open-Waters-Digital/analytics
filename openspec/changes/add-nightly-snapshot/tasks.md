# Tasks

## 1. Unknowns first, against the real project

- [ ] 1.1 Against the live `open-waters` PostHog project, confirm with a dry run: that the `sessions` table is populated under cookieless mode and carries `$channel_type` and `$entry_pathname`; that `uniq(distinct_id)` and `uniq(properties.$session_id)` return sensible numbers; and that each of the six query groups parses. Record the working query text and the response shape in design.md, and correct any decision the answers contradict
- [x] 1.2 Confirm the `deploy.cronSchedule` field in the installed `railway` package's types is what Railway's cron schedule maps to, and that a service with a cron schedule needs no health check; note anything the types show that design.md assumes

## 2. Schema

- [x] 2.1 Add `site_daily_metrics`, `snapshot_runs` and `site_snapshot_results` to `src/db/schema.ts` per design.md, with the `(site_id, day, metric, dimension)` unique constraint, `timestamptz` timestamps, indexes on every foreign key and on `(site_id, day)`, and check constraints that `value >= 0` and that `value_minor` requires a currency
- [x] 2.2 Run `pnpm db:generate`, read the SQL, commit the migration; verify it applies to a fresh database and that a second run is a no-op

## 3. The metric list

- [x] 3.1 Add `src/lib/snapshot-metrics.ts`: the metric names, their stage, whether they carry a dimension and what it is, and the comment that `daily_visitors` is never summed across days; verify a test pinning it against `src/lib/event-list.ts`, so an event in the list with no metric is a failure

## 4. Querying PostHog

- [x] 4.1 Extract `runHogQlQuery(connection, query, values, timeoutMs)` in `src/server/posthog.ts`, rewrite `checkPostHogConnection` in terms of it, and keep `classifyCheckResponse` unchanged; verify the existing connection tests still pass untouched
- [x] 4.2 Add `src/server/posthog-queries.ts`: the six query groups from design.md, each returning `day, metric, dimension, value`, with a Zod parser for the response; verify tests that a well-formed response parses, an unexpected shape is rejected rather than coerced, and the dimension guards apply (path only, 200 characters, top 50 per metric per day)
- [x] 4.3 Add the retry: one retry after five seconds on 429 or 5xx, then fail the site; verify tests for retry-then-success, retry-then-fail, timeout and an immediate 401 with no retry

## 5. The pull

- [x] 5.1 Add `src/server/snapshots/collect.ts`: select the sites to pull and the reason each other site is skipped; verify tests for a working connection, a client-owned client with no connection, an offboarded client, and a connection whose last check failed
- [x] 5.2 Implement the per-site pull: window selection (7 days, 30 on a first pull), decrypt, the six queries, then one transaction that replaces the window and writes zero rows for the headline metrics; verify tests that a re-run replaces rather than doubles, a quiet day stores zeros, and a failure mid-way leaves the previous values unchanged
- [x] 5.3 Write the run records, update a connection's `last_check_*` columns when PostHog rejects the key, and delete run records older than 90 days; verify tests including a run that fails for one site and succeeds for two
- [x] 5.4 Add the ESLint rule stopping anything under `src/app/` importing `collect.ts`; verify the rule fires on a deliberate import

## 6. The job entry point

- [x] 6.1 Add `scripts/jobs/nightly-snapshot.ts` (concurrency of three, one JSON log line per site and one summary, exit 0 on a completed run with failures, exit 1 only when the run could not complete), add the entry point to `scripts/build-scripts.mjs` and a `job:snapshot` package script; verify `pnpm run build` produces `dist/jobs/nightly-snapshot.mjs` and that running it needs no auth or email variables
- [x] 6.2 Verify no key, decrypted value or query parameter appears in the job's output, by running it against a site whose key has been revoked and reading every line

## 7. What the app shows

- [x] 7.1 Add `src/server/snapshots/read.ts` with session-checked reads for the last run, a site's last pull and its last seven days; verify tests that each rejects without a session
- [x] 7.2 Add the per-site snapshot panel to `/clients/[slug]` (last pull time and outcome, seven-day table of page views, sessions and leads, "Not pulled yet" when it has never run); verify at 375px first
- [x] 7.3 Add the "Snapshot last ran …" line to `/clients`, in the warning tone past 48 hours or when it has never run; verify both states

## 8. Deploy and prove it

- [x] 8.1 Add the `analytics-jobs` service to `.railway/railway.ts` per design.md; run `railway config plan` and verify it shows only the new service and no change to the web service (do not apply without the user). Plan on 18 September 2026: "1 to add, 0 to change, 0 to destroy — Create service analytics-jobs". Not applied: that is the user's call
- [ ] 8.2 Run the job locally against the production PostHog project and compare every metric for one real day with the same number in the PostHog UI, with "Filter out internal and test users" off; record any discrepancy and its cause before trusting the job
- [ ] 8.3 After the user applies the Railway config: trigger the job once, read the logs, and confirm the client page shows the run and the numbers
- [x] 8.4 Update AGENTS.md: flip the nightly snapshot to ✅, add the jobs service to the deploy section and the repo tree, document the metric table, the `daily_visitors` rule and why these numbers can differ from the PostHog UI
- [x] 8.5 Run `pnpm run ci:quality` and report the real result
