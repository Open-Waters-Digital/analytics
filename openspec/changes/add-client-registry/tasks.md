# Tasks

## 1. Schema and event list

- [x] 1.1 Add the enums and eight tables to `src/db/schema.ts` as specified in design.md, including unique constraints, foreign key indexes and check constraints; verify typecheck passes
- [x] 1.2 Run `pnpm db:generate`, read the SQL, commit it; verify `node dist/migrate.mjs` applies cleanly to a fresh database and CI's drift check passes
- [x] 1.3 Add `src/lib/event-list.ts` with version 1 events and stages copied from the skill's `references/events.md`; verify a unit test pins the exact names and stages

## 2. Encryption

- [ ] 2.1 Add `CREDENTIALS_ENCRYPTION_KEY` to `env()` (base64, exactly 32 bytes) and to `.env.example`; verify tests for missing, wrong-length and non-base64 values
- [x] 2.2 Implement `encryptApiKey(key, connectionId)` and `decryptApiKey(stored, connectionId)` with AES-256-GCM and the connection id as associated data; verify tests for round trip, wrong connection id, tampered ciphertext, tampered tag and wrong master key (all return `{ ok: false }`)

## 3. PostHog check

- [x] 3.1 Implement `classifyCheckResponse` mapping status and body to `ok`, `unauthorised`, `project_not_found` or `error` with fixed messages; verify table-driven tests covering 200, 401, 403, 404, 429, 500 and an unparseable 200
- [x] 3.2 Implement `checkPostHogConnection({ region, projectId, apiKey })` with the query, bearer header and 10-second timeout; verify tests with stubbed `fetch` for success, each failure status, network error and timeout, and that no key appears in any returned message

## 4. Data access layer

- [x] 4.1 Implement clients functions (create, update, get by slug, list with the connection summary and the offboarded filter); verify integration tests against the compose database for duplicate slug, invalid slug, slug immutability and signed-out rejection
- [x] 4.2 Implement sites functions (create with default expected events in one transaction, update, remove with confirmation); verify tests for https-only and unique URL, invalid timezone, rollback when expected-event insert fails, and removal cascade
- [x] 4.3 Implement report recipients functions; verify tests for invalid email and case-insensitive duplicates
- [x] 4.4 Implement PostHog connection functions (add or replace after a passing check, remove with confirmation, test on demand recording status); verify tests for failed replacement leaving the old row untouched, undecryptable key recording `error` without calling PostHog, and the database holding ciphertext only
- [x] 4.5 Implement Search Console property, expected events, commercial context and learning log functions; verify tests for property formats, unknown event names, source required with figures, rate range, minor-unit conversion and title length

## 5. Primitives

- [x] 5.1 Build `Select`, `Textarea`, `Checkbox`, `Alert` and `DescriptionList` with recipes in `variants.ts`; verify each is on `/design-system` with every variant and state, and keyboard focus is visible
- [x] 5.2 Verify the new primitives at 375px on `/design-system`

## 6. Screens

- [x] 6.1 Build `/clients` with the table, status badges, connection summary, offboarded toggle and empty state; verify at 375px and with zero, one and several clients
- [x] 6.2 Build `/clients/new` and `/clients/[slug]/edit` with field errors kept on failure; verify by submitting invalid data with browser validation disabled
- [x] 6.3 Build `/clients/[slug]` with sites, recipients and per-site panels; verify the client-owned site shows "Client-owned analytics"
- [x] 6.4 Build site create/edit pages and the remove-site confirmation page; verify a direct POST without `confirm=yes` removes nothing
- [ ] 6.5 Build the PostHog connection form (password input, masked last four, Test connection, remove with confirmation); verify against a real PostHog project that a good key connects, a bad key is rejected, and the key never appears in page HTML or action responses
- [x] 6.6 Build the Search Console, expected events, commercial context and learning log forms; verify each saves and shows its validation errors
- [x] 6.7 Link Clients in the app header and make `/` redirect to `/clients`; verify navigation by keyboard

## 7. Finish

- [x] 7.1 Run through adding Radara end to end locally: client, site, recipient, expected events without `file_downloaded`, commercial context estimate, a learning log entry, and a PostHog connection if a Radara project exists; record what was verified and what could not be
- [x] 7.2 Grep application logs from that run for the API key and email addresses; verify none appear
- [x] 7.3 Update AGENTS.md: flip the client registry to ✅, add the new files to the repo tree, add `CREDENTIALS_ENCRYPTION_KEY` to the first-deploy list; verify no stale "proposed" references
- [x] 7.4 Run `pnpm run ci:quality` and report the real result

## Verification notes (17 September 2026)

Integration tests (87, against a freshly migrated `analytics_test` database)
cover every data rule in the two specs. End to end, against the production
build in Chromium at 375px with a fresh database:

- `/` redirects to `/clients`; the empty state links to adding a client.
- Add client with slug `Radara Health`: field error shown, name kept. With
  `radara` and Regulated ticked: lands on the client page.
- Add site with `http://…`: "must use https". With `https://radarahealth.com`:
  13 of 13 version 1 events expected.
- Recipient added; `file_downloaded` unticked (12 of 13); commercial context
  without a source shows the source error, then shows
  "£2,500 (Open Waters estimate)" and "20% (Open Waters estimate)"; Search
  Console `radarahealth.com` rejected, `sc-domain:radarahealth.com` saved as
  "Not checked"; learning log entry added with its expected effect.
- PostHog connection with a made-up key against the **real** EU PostHog API:
  "PostHog rejected the key…" shown on the key field, the key field comes back
  empty, the site still shows "Not connected", and `posthog_connections` is
  empty.
- A client-owned client's site shows "Client-owned analytics".
- Remove site → Cancel keeps the site.
- Keyboard: Tab from the top of the list reaches the client links.
- None of the 94 responses in the run contained the API key; the server log
  contained no key and no email address.
- Screenshots checked: clients list (empty and populated), new client with
  error, client detail at 375px and 1280px, `/design-system` new primitives.
  They caught tabular figures widening hyphens in table text and slugs
  wrapping; both fixed.

Not done:

- **2.1** The key is validated (`credentialsKey()`, tested), but in its own
  function rather than `env()`, so a missing key disables connections instead of
  failing every page on the deploy that introduces it (see design.md). The
  `.env.example` line is left to the user, whose file it is.
- **6.5** A **working** key has not been tried against a real PostHog project:
  none exists yet. The request format and the rejection path are verified
  against the real API; the success path is verified with a stubbed check.
  Tick after connecting Radara's project for real.
