## 0. Open Waters' accounts

- [x] 0.1 With Alex, set up the accounts in design's Open Questions: the shared Google account, the Google Cloud project with the Search Console API enabled, the service account and its JSON key, and the Microsoft account in Bing Webmaster Tools with its API key. Verify by listing, in the task note, the project id, the service account's email address and the Bing account's address. No key values.
      Done 25 September 2026: Google account `analytics@openwaters.digital`, Cloud project `open-waters-analytics` with no organisation and no billing, the three APIs enabled, service account `analytics-app@open-waters-analytics.iam.gserviceaccount.com` with a JSON key, the `page-experience` API key restricted to the Chrome UX Report and PageSpeed Insights APIs, and a Microsoft account on the same address with a Bing Webmaster API key. Both partners are Owners on the project. All keys are in the password manager.

## 1. Confirming the APIs

- [ ] 1.1 With the service account added to one real property as a restricted user, confirm:
  - the `permissionLevel` values `GET sites/{siteUrl}` returns, and what it returns for an account not added
  - the Search Analytics response shape for `date`, `date,device`, `date,query` and `date,page`
  - the row ordering, `rowLimit` and `startRow` paging
  - the earliest date the API returns for the property, and whether a newly verified property shows data from before its verification
  - the status codes for no access, not found and quota
  - that a restricted user can call `urlInspection.index.inspect` and `GET sitemaps`, and the inspection result's fields

  Verify by recording the findings, with the date, in `src/server/search-console.ts`'s header.

- [ ] 1.2 With the Open Waters Bing account added to one real site as a read-only user, confirm:
  - the call that lists the account's sites, and how an unshared site appears
  - the calls for site traffic totals, query statistics and page statistics, and their response shapes
  - whether query and page statistics are daily or weekly, and the timezone of their dates
  - how far back each returns, and whether a site newly added to Bing shows data from before it was added
  - the status codes for a bad key and a quota

  Verify by recording the findings, with the date, in `src/server/bing-webmaster.ts`'s header, and choosing the branch of design D5a that applies.

## 2. Configuration

- [x] 2.1 Add `GOOGLE_SERVICE_ACCOUNT_KEY` and `BING_WEBMASTER_API_KEY` to `src/server/env.ts`, each parsed lazily with Zod (design D3), and to `.env.example` and `.railway/railway.ts` with `preserve()` on both services. Verify with unit tests: unset reads as not configured, a malformed Google key is a configuration error, an empty Bing key is not configured, and no error message contains any part of either value.
- [x] 2.2 Add `google-auth-library` as a dependency, with its reason in the commit message. Verify that no client bundle contains it, by checking the build output.

## 3. Data

- [x] 3.1 Add `site_search_daily` with its `engine` column, `bing_webmaster_sites`, the `search_engine`, `search_breakdown`, `search_check_status` and `snapshot_source` enums, the three check columns on `search_console_properties`, `brand_terms` on `sites`, and `source` on `site_snapshot_results` with its unique key widened (design D4, D6). Run `pnpm db:generate`, and review and commit the SQL. Verify that it is additive, that existing result rows read as `posthog`, and that `node dist/migrate.mjs` applies it to a fresh database.

## 4. The engine clients

- [x] 4.1 Implement `src/server/search-console.ts`, importing `server-only`: the token from `google-auth-library`'s JWT client, `checkProperty` and `querySearchAnalytics` through `fetch`, with the timeouts and single retry in design D8, Zod-parsed responses and fixed messages. Verify with tests against a local stub server for each of these:
  - success, for each readable permission level
  - `siteUnverifiedUser`, 403 and 404
  - 429 then success, and 500 twice
  - a timeout on the token request and on a query
  - a malformed body
  - no key, token or Google error text in any thrown error or log line
- [x] 4.2 Implement `src/server/bing-webmaster.ts` the same way: `checkSite` and the three statistics calls, with the key sent as Bing requires and never in a logged URL. Verify with tests against the stub for success, an unshared site, a bad key, a quota response, a timeout, a malformed body, and no key or Bing error text in any error or log line.

## 5. The checks

- [x] 5.1 Add the Bing site field to the site's registry form beside the Search Console property, validated as in the spec. Verify at 375px, with a field error for a bare hostname, and that the value survives a failed validation on another field.
- [x] 5.2 Check each property on save, and add a Check action for each (design D7). Both check the session first. Verify with integration tests against the compose database and the stub:
  - a signed-out check is rejected with no call to either engine
  - each engine answer stores the status the D7 table gives
  - a failed check keeps the property and does not present the last success as current
  - with a key unset, that engine's property reads not configured and no call is made

## 6. The pull

- [x] 6.1 Implement the per-site Google pull (design D5): the four queries, the per-day 1,000 cut by impressions, the 200-character cut, zero totals for empty days, the 10-day window, the first-pull backfill in 90-day chunks, and the page cap with its warning. Verify with unit tests on the shaping, including the averaging example in the spec and a day with no data.
- [x] 6.2 Implement the per-site Bing pull (design D5a), on the branch task 1.2 chose. Verify with unit tests on the shaping, including weekly figures if that branch applies.
- [x] 6.3 Run both from `runNightlySnapshot` after the PostHog pass, with a result row per site per source (design D6). Verify with integration tests:
  - a readable site stores rows for each engine, and a re-run replaces rather than doubles
  - a first pull for a replacement site reaches back to the stub's earliest date, and for a new site covers 10 days only
  - no zero rows are written before an engine's earliest returned day, and gaps after it are zero-filled
  - marking a site as a replacement after its first pull backfills it on the next run
  - a 403 mid-run sets that property to `no_access` and keeps earlier rows
  - `no_access` properties are skipped without a call
  - a Bing failure beside PostHog and Google successes gives three results for the site
  - an offboarded client is not pulled
  - a client-owned analytics site with properties is pulled

- [x] 6.4 Implement the weekly indexing pass (design D5b): the sitemap fetch with its limits, the 500 cap in the stated order, the gap between calls, and removing addresses no longer listed. Verify with integration tests against the stub for a 30-page sitemap, a sitemap index, a property with no sitemap, an unreachable sitemap, a 700-page sitemap over two weeks, and an off-host address being ignored.

## 7. Brand terms

- [x] 7.0 Add "Replaces an existing site" to the site's registry form. Verify at 375px and that it survives a failed validation on another field.
- [x] 7.1 Add brand terms to the site's registry form, trimmed, lowercased, at most 20 of 50 characters. Verify at 375px, with field errors for 21 terms and for a 51-character term, and that the values survive a failed validation on another field.

## 8. The report

- [x] 8.1 Add the read functions to a session-checked module (design D9, D10): headline figures per engine and combined for 28 days against the 28 before, the branded split with its coverage, top queries and pages by clicks, the search-to-enquiry line, the "Previous site" split at the launch date, and the indexing summary with its not-indexed pages. Verify with integration tests on seeded rows, including a brand term added after the data, the position average across engines, and the coverage example in the spec.
- [x] 8.2 Build the report in the Search section of the client page, from Panel, Table, Badge and StatusDot only, with the empty states the spec lists and the timezone note. Verify at 375px first: figures two to a row, the engine as a row label, top lists at 10 rows with three columns, no page-level horizontal scroll. Then check it wide, with data from both engines, with one engine only, with no data and with no access.

## 9. Real run

- [ ] 9.1 Set both keys on the web service, check one real client's property and Bing site, run the job once, and read the report. Verify by recording both check results, the rows stored for each backfill, and one headline figure per engine checked against that engine's own screen for the same period, in the task note.

## 10. Documents

- [x] 10.1 Sweep AGENTS.md: the Data pulls line, the delivery order with search ahead of the drift check and PageSpeed moved to `add-page-experience`, the repo tree, the privacy section on what search data is stored, and the deploy variables. Add the terms to CONTEXT.md. Verify by rereading each section against the code.
- [x] 10.2 Update the requirement in `add-client-registry`'s `data-connections` spec that says the property shows "Not checked" until a later change, to point at `search-performance`. Verify with `openspec validate`.
- [x] 10.3 In `~/.agents`, update the skill's search step and the contract package's onboarding checklist to name the Open Waters Bing account and its read-only role. Verify by rereading both, and commit each in its own repository.

## 11. The gate

- [x] 11.1 Run `pnpm run ci:quality` and report its real output. Verify that it passes, with no task ticked on a failing run.
