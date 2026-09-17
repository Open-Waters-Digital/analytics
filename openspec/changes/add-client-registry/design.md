# Design

## Context

Builds on `add-magic-link-auth`: `requireSession()` in `src/server/session.ts`,
the `(app)` route group with the signed-in shell, and the env module. The
schema conventions (uuid keys, `timestamptz`, snake_case, money in minor units,
index every foreign key) are in AGENTS.md. The shared event list is defined by
the `openwaters-analytics` skill (`references/events.md`, version 1). Motivation
is in proposal.md; behaviour is in the two spec files.

## Goals / Non-Goals

**Goals:**

- One module per concern in `src/server/registry/`, each function checking the
  session, validating with a Zod schema shared with the form, and running its
  writes in a transaction.
- A PostHog key is decryptable only by server code, only for the row it belongs
  to.
- The PostHog check is the same function the nightly job will call later.

**Non-Goals:**

- Master key rotation tooling. The key version is stored now so rotation can be
  added without a data migration; the rotation command is a later change.
- Checking Search Console properties (arrives with the Search Console pull).
- Nightly snapshots, the drift check and the overview.
- Audit history of who changed what. Two users; `updated_at` is enough for now.

## Decisions

### Schema

All tables have `id uuid primary key default gen_random_uuid()`, `created_at`
and `updated_at timestamptz not null default now()`.

| Table                       | Columns (beyond the common ones)                                                                                                                                                                                                                     | Constraints and indexes                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `clients`                   | `slug text`, `name text`, `status client_status`, `analytics_ownership analytics_ownership`, `regulated boolean`                                                                                                                                     | unique `slug`; index `status`                                                                                                                 |
| `sites`                     | `client_id → clients`, `production_url text`, `framework site_framework`, `repository text null`, `launched_on date null`, `taxonomy_version int`, `timezone text`                                                                                   | unique `production_url`; index `client_id`                                                                                                    |
| `report_recipients`         | `client_id → clients`, `name text`, `email text` (stored lower-cased)                                                                                                                                                                                | unique `(client_id, email)`; index `client_id`                                                                                                |
| `posthog_connections`       | `site_id → sites` (cascade), `region posthog_region`, `project_id int`, `api_key_ciphertext text`, `key_version int`, `key_last4 text`, `last_check_at timestamptz null`, `last_check_status connection_status null`, `last_check_message text null` | unique `site_id`                                                                                                                              |
| `search_console_properties` | `site_id → sites` (cascade), `property text`                                                                                                                                                                                                         | unique `site_id`                                                                                                                              |
| `site_expected_events`      | `site_id → sites` (cascade), `event text`                                                                                                                                                                                                            | unique `(site_id, event)`                                                                                                                     |
| `site_commercial_context`   | `site_id → sites` (cascade), `lead_value_minor int null`, `currency currency null`, `lead_to_customer_rate numeric(5,4) null`, `source figure_source null`                                                                                           | unique `site_id`; check: source not null when either figure is set; check: rate between 0 and 1; check: currency not null when lead value set |
| `site_changes`              | `site_id → sites` (cascade), `occurred_on date`, `kind site_change_kind`, `title varchar(120)`, `detail text null`, `expected_effect text null`                                                                                                      | index `(site_id, occurred_on desc)`                                                                                                           |

Enums: `client_status`, `analytics_ownership`, `site_framework`,
`posthog_region`, `connection_status` (`ok`, `unauthorised`,
`project_not_found`, `error`), `currency` (`GBP`, `EUR`, `USD`),
`figure_source`, `site_change_kind`.

`clients` has no cascade from anywhere and no delete action (spec: never hard
deleted). Sites cascade their dependants because removing a site is an explicit,
confirmed action.

Expected events are stored as **ticked rows** rather than exclusions. A site
created at version 1 gets a row per version 1 event in the same transaction.
Alternative: store only exclusions. Rejected: when the event list grows to
version 2, silently expecting new events on old sites would raise false drift
alerts; explicit rows make adoption of a new version a deliberate step.

Database constraints duplicate the Zod rules for ranges and required pairs, so
bad data cannot arrive by any path, including a future job.

### Event list mirror

`src/lib/event-list.ts` exports `EVENT_LIST_VERSION = 1` and the version 1 event
names with their Attention / Intent / Action / Revenue stage, copied from the
skill's `references/events.md`. It is a copy by necessity (the skill lives
outside the repo), so the file header names its source and a unit test pins the
exact list; changing it means a new event list version in the skill first.
Only browser and server events are included, not PostHog's `$pageview` and
`$pageleave`, which every site sends.

### Encryption of API keys

`src/server/crypto.ts` (imports `server-only`):

- AES-256-GCM via `node:crypto`, 12-byte random IV, 16-byte tag.
- Master key from `CREDENTIALS_ENCRYPTION_KEY`: base64 that must decode to
  exactly 32 bytes, validated by `env()`.
- **Associated data** is the connection's id. The id is generated in the
  application before insert so it is known at encryption time. A ciphertext
  copied to another row fails authentication (spec scenario).
- Stored format: `base64(iv).base64(tag).base64(ciphertext)` in one text column
  plus `key_version = 1`.
- `decryptApiKey()` returns a discriminated result (`{ ok: true, key }` or
  `{ ok: false }`) rather than throwing, so callers must handle the
  undecryptable case the spec describes.

Alternatives: **pgcrypto** (the key would be sent to Postgres in queries and
could appear in database logs); **Railway sealed variables per client**
(rejected in ADR 0001); **libsodium** (a dependency for what `node:crypto`
already does).

### PostHog check

`src/server/posthog.ts`:

- Host by region: `https://eu.posthog.com` or `https://us.posthog.com`.
- `POST /api/projects/{projectId}/query/` with
  `{"query":{"kind":"HogQLQuery","query":"SELECT count() FROM events WHERE timestamp > now() - INTERVAL 1 DAY"},"name":"openwaters_connection_check"}`
  and `Authorization: Bearer <key>`. Requires Query Read, the permission the
  skill tells people to grant. The count is discarded.
- `AbortSignal.timeout(10_000)`.
- Response mapping: 2xx with a body that parses (Zod) → `ok`; 401/403 →
  `unauthorised`; 404 → `project_not_found`; timeout, network error, other
  status or an unparseable body → `error` with a fixed message. PostHog's own
  error text is never shown or stored, since it could echo request details.
- Pure mapping function (`classifyCheckResponse`) unit tested with recorded
  response shapes; the fetch wrapper tested with a stubbed `fetch`.

Rate limits: PostHog allows 240 query requests a minute per project. A human
clicking Test cannot approach that; the nightly job will be designed against it
separately.

### Server actions and forms

- `src/server/registry/{clients,sites,recipients,connections,expected-events,commercial,site-changes}.ts`
  hold the data access functions. Each calls `requireSession()` first, parses
  input with the shared Zod schema, and wraps multi-statement writes in
  `db.transaction`.
- `src/app/(app)/clients/**/actions.ts` hold thin server actions returning
  `{ ok: true } | { ok: false, fieldErrors, formError }`. Forms use
  `useActionState` to show field errors while keeping entered values; this is
  the reason the form components are client components.
- Unique violations (Postgres code `23505`) map to the specific field error
  ("slug already in use", "URL already used by another site").
- The API key input is `type="password"`, `autocomplete="off"`, and the action
  never returns the submitted key in its state.

### Screens

- `/clients`: `Table` of clients; a "Show offboarded" toggle as a link with a
  query parameter (no client JS); empty state with a link to create.
- `/clients/new`: name, slug (with format hint), ownership `Select`, regulated
  `Checkbox`.
- `/clients/[slug]`: header with name, status `Badge` and Edit; then panels:
  **Sites** (each site a panel with its details, PostHog connection, Search
  Console property, expected events, commercial context and learning log),
  **Report recipients**. Each panel's form posts its own action.
- `/clients/[slug]/edit`, `/clients/[slug]/sites/new`,
  `/clients/[slug]/sites/[siteId]/edit`: dedicated form pages for the larger
  forms. Small forms (recipient, learning log entry, key replacement) sit inline
  in their panel.
- Destructive actions (remove site, remove connection) use a confirmation page
  rather than a JavaScript dialog: the action requires `confirm=yes` in the form
  body, which the spec's "remove without confirming" scenario tests.
- At 375px every form is one column, the clients table scrolls inside its
  panel, and panels stack.

### New primitives

`Select`, `Textarea` and `Checkbox` follow `Field`'s pattern (label, hint and
error wired with `aria-describedby`). `Alert` renders tone-coloured text on the
tone's subtle background with an icon-free leading label ("Error", "Note") so
colour is never the only signal. `DescriptionList` renders term and value pairs
in one column at 375px and two columns from `md:`. All go into `variants.ts` and
onto `/design-system` with every state.

### Implementation notes

Decisions made while applying, recorded so they are kept:

- **The master key is not in `env()`.** `credentialsKey()` in
  `src/server/env.ts` validates `CREDENTIALS_ENCRYPTION_KEY` where keys are
  encrypted or decrypted. In `env()` it would make every page fail on the first
  deploy of this change, before anyone has set the variable; this way only the
  connection forms report that connections are unavailable.
- **One form component.** `src/components/registry/registry-form.tsx` renders a
  serialisable field list and runs a server action with `useActionState`, so
  every registry form shares error display, kept values and the pending state.
  Submitted API keys are stripped from the state sent back to the browser.
- **Integration tests use a real database.** `src/test/global-setup.ts`
  recreates and migrates `analytics_test` on the same Postgres server as
  `DATABASE_URL` before each run; `src/test/mock-session.ts` stands in for the
  session. `pnpm test` therefore needs `pnpm db:up` locally, and CI's Postgres
  service provides it there.
- **Action errors log names only.** Drizzle's query errors include parameters,
  which can hold email addresses or ciphertext.
- **Blank key on replace reuses the stored key**, so a region or project ID
  correction does not require pasting the key again. The check still runs first.

## Risks / Trade-offs

- [`CREDENTIALS_ENCRYPTION_KEY` lost] → every stored key must be re-entered;
  keys are recoverable from PostHog, so this is inconvenience, not data loss. The
  key is stored in the password manager as a first-deploy item.
- [PostHog outage blocks adding a connection] → accepted; the form explains it.
  Saving an unchecked key would push the same failure to 2am.
- [PostHog changes the query API or error codes] → the classifier is the one
  place to update, and its tests hold the response shapes we rely on.
- [Event list copy drifts from the skill] → the pinning test and the file header
  make a change deliberate; a version bump is a registry change anyway.
- [`useActionState` forms need client components] → limited to form wrappers;
  pages and panels stay server components.

## Migration Plan

1. One Drizzle migration creating the enums and tables. Nothing exists to
   migrate.
2. Set `CREDENTIALS_ENCRYPTION_KEY` locally (`openssl rand -base64 32`) and in
   Railway before first deploy; store a copy in the password manager.
3. Rollback before first deploy is reverting the commit; after deploy, a
   follow-up migration, never an edit to this one.
