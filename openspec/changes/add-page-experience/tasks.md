## 1. Confirming the APIs

- [ ] 1.1 With the Open Waters API key, restricted to the two APIs, confirm against one site with Chrome data and one without:
  - the Chrome UX Report record and history request and response shapes, for an origin and a URL, per form factor
  - which metrics and percentiles come back, and how a missing INP appears
  - the 404 for too little data
  - the PageSpeed Insights response fields for the score and each lab timing, on a phone
  - how long a PageSpeed Insights call takes in practice, and its error for a page that does not load

  Verify by recording the findings, with the date, in `src/server/page-experience.ts`'s header.

## 2. Configuration

- [ ] 2.1 Add `GOOGLE_API_KEY` to `src/server/env.ts`, parsed lazily with Zod, and to `.env.example` and `.railway/railway.ts` with `preserve()` on both services. Verify with unit tests that unset reads as not configured and that no error message or logged URL contains the value.

## 3. Data

- [ ] 3.1 Add `site_page_experience`, `site_tracked_pages`, `site_performance_budgets`, `pe_lab_runs` and their enums, and `page_experience` to `snapshot_source` (design D2, D4, D7). Backfill a tracked page of `/` for every existing site in the migration. Run `pnpm db:generate`, and review and commit the SQL. Verify that it is additive and that `node dist/migrate.mjs` applies it to a fresh database with one site in it.

## 4. The client

- [ ] 4.1 Implement `src/server/page-experience.ts`, importing `server-only`: Chrome UX Report record and history calls and the PageSpeed Insights call, with the timeouts and retries in design D5, Zod-parsed responses and fixed reasons. Verify with tests against a local stub server for each of these:
  - field data for an origin and a URL
  - a 404 read as not enough data
  - field data with INP missing
  - 429 then success, and 500 twice
  - a lab run that succeeds, one that times out at 90 seconds, and one whose page fails to load
  - a malformed body
  - the key absent from every thrown error, log line and stored value

## 5. Registry

- [ ] 5.1 Add tracked pages and the performance budget to the site's registry form (design D7): `/` fixed, up to nine more paths, and four optional targets. Verify at 375px, with field errors for an eleventh path, a query string, a duplicate path and a negative target, and that values survive a failed validation on another field.

## 6. The pulls

- [ ] 6.1 Run field data from `runNightlySnapshot` after the search pull, and the history on a site's first pull, and lab runs on Mondays (design D3). Verify with integration tests:
  - a site with data stores rows for its origin and pages, both form factors
  - a 404 origin stores `not_enough_data` and the site's result is ok
  - a replacement site's first pull stores history rows with `period_end`, and a new site's requests none
  - a Monday run stores lab rows for each tracked page, and another day does not
  - one page failing to load stores that page as failed and the rest as ok
  - an offboarded client is not pulled
- [ ] 6.2 Implement Run now (design D4): the session check, one run per site, results written as they arrive, and a stale `running` row released after 10 minutes. Verify with integration tests for a signed-out request with no call made, a second press during a run, and a stale run.

## 7. The report

- [ ] 7.1 Add the read functions to a session-checked module: the verdicts (design D6), each metric's latest value and verdict against budget or threshold, monthly values for three months, and the latest lab result per page. Verify with unit tests on the verdict rules, including a stricter budget, a missing INP and not enough data, and integration tests on seeded rows.
- [ ] 7.2 Build the Page experience section on the client page, from Panel, Table, Badge, StatusDot and Button only, with the empty and not-enough-data states and the rolling-28-days note. Verify at 375px first: verdicts stacked, one row per metric, the lab table at two columns, no page-level horizontal scroll. Then wide, with data, with lab data only, while a run is in progress and with the key unset.

## 8. Real run

- [ ] 8.1 Set the key, press Run now on one real site, and let one nightly run pull field data. Verify by recording the lab score against PageSpeed Insights' own page for the same URL on the same day, and whether Chrome had field data for the site, in the task note.

## 9. Documents

- [ ] 9.1 Sweep AGENTS.md: the Data pulls line, the delivery order with PageSpeed as its own step, the repo tree, and the deploy variables. Add the terms to CONTEXT.md. Verify by rereading each section against the code.
- [ ] 9.2 In the contract package, correct the tiers document and the onboarding checklist, which list Core Web Vitals under Search Console, to name this report and add "Register tracked pages and a budget" to the checklist's registration step. Verify by rereading both, and commit in that repository.

## 10. The gate

- [ ] 10.1 Run `pnpm run ci:quality` and report its real output. Verify that it passes, with no task ticked on a failing run.
