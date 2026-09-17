# Tasks

## 1. Schema and event list

- [ ] 1.1 Add the enums and eight tables to `src/db/schema.ts` as specified in design.md, including unique constraints, foreign key indexes and check constraints; verify typecheck passes
- [ ] 1.2 Run `pnpm db:generate`, read the SQL, commit it; verify `node dist/migrate.mjs` applies cleanly to a fresh database and CI's drift check passes
- [ ] 1.3 Add `src/lib/event-list.ts` with version 1 events and stages copied from the skill's `references/events.md`; verify a unit test pins the exact names and stages

## 2. Encryption

- [ ] 2.1 Add `CREDENTIALS_ENCRYPTION_KEY` to `env()` (base64, exactly 32 bytes) and to `env.example`; verify tests for missing, wrong-length and non-base64 values
- [ ] 2.2 Implement `encryptApiKey(key, connectionId)` and `decryptApiKey(stored, connectionId)` with AES-256-GCM and the connection id as associated data; verify tests for round trip, wrong connection id, tampered ciphertext, tampered tag and wrong master key (all return `{ ok: false }`)

## 3. PostHog check

- [ ] 3.1 Implement `classifyCheckResponse` mapping status and body to `ok`, `unauthorised`, `project_not_found` or `error` with fixed messages; verify table-driven tests covering 200, 401, 403, 404, 429, 500 and an unparseable 200
- [ ] 3.2 Implement `checkPostHogConnection({ region, projectId, apiKey })` with the query, bearer header and 10-second timeout; verify tests with stubbed `fetch` for success, each failure status, network error and timeout, and that no key appears in any returned message

## 4. Data access layer

- [ ] 4.1 Implement clients functions (create, update, get by slug, list with the connection summary and the offboarded filter); verify integration tests against the compose database for duplicate slug, invalid slug, slug immutability and signed-out rejection
- [ ] 4.2 Implement sites functions (create with default expected events in one transaction, update, remove with confirmation); verify tests for https-only and unique URL, invalid timezone, rollback when expected-event insert fails, and removal cascade
- [ ] 4.3 Implement report recipients functions; verify tests for invalid email and case-insensitive duplicates
- [ ] 4.4 Implement PostHog connection functions (add or replace after a passing check, remove with confirmation, test on demand recording status); verify tests for failed replacement leaving the old row untouched, undecryptable key recording `error` without calling PostHog, and the database holding ciphertext only
- [ ] 4.5 Implement Search Console property, expected events, commercial context and learning log functions; verify tests for property formats, unknown event names, source required with figures, rate range, minor-unit conversion and title length

## 5. Primitives

- [ ] 5.1 Build `Select`, `Textarea`, `Checkbox`, `Alert` and `DescriptionList` with recipes in `variants.ts`; verify each is on `/design-system` with every variant and state, and keyboard focus is visible
- [ ] 5.2 Verify the new primitives at 375px on `/design-system`

## 6. Screens

- [ ] 6.1 Build `/clients` with the table, status badges, connection summary, offboarded toggle and empty state; verify at 375px and with zero, one and several clients
- [ ] 6.2 Build `/clients/new` and `/clients/[slug]/edit` with field errors kept on failure; verify by submitting invalid data with browser validation disabled
- [ ] 6.3 Build `/clients/[slug]` with sites, recipients and per-site panels; verify the client-owned site shows "Client-owned analytics"
- [ ] 6.4 Build site create/edit pages and the remove-site confirmation page; verify a direct POST without `confirm=yes` removes nothing
- [ ] 6.5 Build the PostHog connection form (password input, masked last four, Test connection, remove with confirmation); verify against a real PostHog project that a good key connects, a bad key is rejected, and the key never appears in page HTML or action responses
- [ ] 6.6 Build the Search Console, expected events, commercial context and learning log forms; verify each saves and shows its validation errors
- [ ] 6.7 Link Clients in the app header and make `/` redirect to `/clients`; verify navigation by keyboard

## 7. Finish

- [ ] 7.1 Run through adding Radara end to end locally: client, site, recipient, expected events without `file_downloaded`, commercial context estimate, a learning log entry, and a PostHog connection if a Radara project exists; record what was verified and what could not be
- [ ] 7.2 Grep application logs from that run for the API key and email addresses; verify none appear
- [ ] 7.3 Update AGENTS.md: flip the client registry to ✅, add the new files to the repo tree, add `CREDENTIALS_ENCRYPTION_KEY` to the first-deploy list; verify no stale "proposed" references
- [ ] 7.4 Run `pnpm run ci:quality` and report the real result
