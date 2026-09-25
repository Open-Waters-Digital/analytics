<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Open Waters Analytics: AGENTS.md

The single source of truth for AI assistants and humans working on this repo.
Read it before proposing, designing or implementing anything. Vocabulary is in
[`CONTEXT.md`](CONTEXT.md); decisions are in [`docs/adr/`](docs/adr/).

**Spec-driven development is mandatory for any feature, screen or behaviour
change.** See [Working with OpenSpec](#working-with-openspec).

---

## Implementation status legend

| Mark | Meaning                                                                     |
| ---- | --------------------------------------------------------------------------- |
| ✅   | Implemented and shipped                                                     |
| 🟡   | Planned for v1: the first deploy people rely on                             |
| 🔵   | Later: explicitly out of scope for now                                      |
| 🧪   | To be confirmed: a decision is needed before build                          |
| 🧱   | Before first deploy: must exist before the app is reachable on the internet |

---

## Product context

Open Waters is a two-person agency building performant, measurable websites.
Its pitch, the **Digital Dividend**, is that a website should tell the business
about its customers. Every client site sends the same events to its own PostHog
project (see the `openwaters-analytics` skill).

**This app** is where Open Waters sees all of that in one place:

- a **client registry**: every client, site and data connection;
- a **nightly pull** of aggregate numbers from PostHog, Search Console and
  PageSpeed;
- a **drift check** that flags tracking that broke or drifted from the event
  list;
- an **overview** across all clients;
- later, **monthly client reports**: numbers computed in code, a draft
  narrative, human review.

**What it is not:** not client-facing (clients receive a reviewed report, not a
login), not a copy of PostHog (raw events stay there), and not a place any
client's visitor-level data is stored.

**Users:** the two Open Waters partners. Nobody else has an account.

---

## Feature scope

### Foundation

- ✅ **Toolchain and gate**: Next.js 16, strict TypeScript, ESLint, Prettier,
  Vitest, `pnpm run ci:quality`, GitHub Actions with a real Postgres.
- ✅ **Design tokens and primitives**: Button, Badge, StatusDot, Field, Panel,
  Table, all on `/design-system`.
- ✅ **Database plumbing**: Drizzle client, bundled migration script, local
  Postgres via `compose.yaml`.
- ✅ **Container and deploy config**: standalone Dockerfile, `.railway/railway.ts` with
  pre-deploy migrations and a health check.

### Access

- ✅ **Magic-link sign-in** (`add-magic-link-auth`, spec `access-control`).
  Better Auth; links emailed via Resend, single use, 15 minutes; 30-day rolling
  sessions. The allowlist (`AUTH_ALLOWED_EMAILS`) is checked before sending,
  before creating a user and on every request, so removing an address revokes
  access at once. Rate limit 5 link requests per 10 minutes per IP.
  - **Every data read and write calls `requireSession()`** from
    `src/server/session.ts` first. Pages inside `src/app/(app)/` are protected by
    that group's layout (`requirePageSession()`), but a layout does not protect
    server actions: actions and data functions check again.
  - `src/proxy.ts` only redirects visitors with no session cookie. It never
    grants access.
  - Public routes: `/sign-in`, `/sign-in/check-email`, `/api/auth/*`,
    `/api/health`. The list lives in `src/lib/proxy-policy.ts`.

### Client registry

- ✅ **Clients, sites and connections** (`add-client-registry`, specs
  `client-registry` and `data-connections`). Clients (slug fixed at creation,
  never hard deleted), sites, report recipients, expected events, commercial
  context and the learning log, all on `/clients` and `/clients/[slug]`.
  - **PostHog connections** are stored only after a live query check passes.
    Keys are AES-256-GCM encrypted with the connection id as associated data
    (`src/server/crypto.ts`); the UI shows the last four characters. A blank key
    when replacing reuses the stored one.
  - **Search properties** (`add-search-console`): a Google Search Console
    property and a Bing Webmaster Tools site per site, each checked when saved
    and on demand. "No access" covers both "never shared with the Open Waters
    account" and "not a property", because neither engine tells them apart.
  - **Replaces an existing site** and **brand terms** are site settings. The
    first decides whether the first search pull backfills the older site's
    history; the second marks branded queries, applied when the report is read.
  - **Expected events** default to the whole event list for the site's version,
    less `consent_updated` unless the site has a consent banner. Changing a
    site's version does not change them: adopting a new version is a deliberate
    step. Gaining or losing the banner adds or removes exactly
    `consent_updated`, and nothing else.
  - **Each site has a measurement tier**, Essentials, Insights or Growth
    (`add-provisioning`), and the tier decides the consent banner: Insights and
    Growth have one. The banner is never set on its own. Aggregate heatmaps are
    a separate choice, allowed at every tier.
  - **The event list comes from the contract package**,
    `@open-waters-digital/analytics/contract` (`adopt-the-contract-package`).
    `src/lib/event-list.ts` only maps its shape onto this app's; no event list
    is defined here, and the package pins every published version. A new
    taxonomy version arrives as a Renovate pull request, and fails this app's
    tests until every listed event has a snapshot metric.
  - Every registry function lives in `src/server/registry/`, checks the session
    first and returns field errors as values. Forms are all
    `src/components/registry/registry-form.tsx` driven by field lists in
    `src/app/(app)/clients/fields.ts`.

### Provisioning

- ✅ **PostHog project provisioning** (`add-provisioning`, spec
  `project-provisioning`). The site's "PostHog project" panel checks the project
  against the contract and the registry, and applies the differences:
  cookieless server hash mode, the timezone, IP discarding, session recording
  by tier, heatmaps, the authorised URL, any internal-traffic condition that
  hides the production site, and the baseline dashboard with its insights. A
  second apply changes nothing.
  - **The key is used once.** A partner pastes a personal key with project,
    dashboard and insight write and organisation read; it goes to PostHog for
    that request and is never stored, logged or returned.
  - **Objects are matched by recorded id**, in `posthog_provisioned_objects`,
    with an `ow:<key>` marker in each PostHog description as the fallback.
    PostHog's tags are a paid feature client organisations will not have.
  - **The tier guard.** At Insights and Growth, recording is held off until a
    partner confirms, for that tier, that the banner is live and the privacy
    page names the new tools. Changing the tier clears the confirmation.
  - **Every run is recorded** in `posthog_provisioning_runs`: who, when, check
    or apply, how many differences, the outcome, the event list version. No
    values and no key.
  - The PostHog fields and values it relies on were confirmed against Open
    Waters' own project on 25 September 2026; see
    `src/server/provisioning/posthog-fields.ts`. The recording masking config's
    shape is confirmed by the first Insights-tier apply.
  - Not done here: the organisation, billing, the processing agreement, the
    proxy's DNS and the read-only key. The panel lists them.

### Data pulls

- ✅ **Nightly PostHog snapshot** (`add-nightly-snapshot`, spec `daily-snapshots`).
  Per site with a working connection, the day's aggregates for the baseline
  dashboard metrics, pulled with HogQL through the stored Query Read key.
  - **Seven queries per site**, all returning `day, metric, dimension, value,
value_minor, currency`, stored in `site_daily_metrics`. The metric list is
    `src/lib/snapshot-metrics.ts`, pinned by a test against every published
    event list.
  - **v2 and v3 breakdowns** (`adopt-the-contract-package`): `consent_updated` by
    `advertising`, page views by `ad_consent`, and leads by `channel` and by
    `heard_about`. A property newer than the event that should carry it reads
    `(not recorded)`, decided per event from its own `taxonomy_version`, so it
    is distinct from `(none)` ("measured, and empty") and right across a
    mid-week upgrade. The client page sums them over the last seven days.
  - **Seven days re-pulled every night, thirty on a site's first pull**, in one
    transaction per site, so a re-run replaces rather than doubles and a failure
    leaves the previous values alone. Days with nothing on them are stored as
    zeroes, so a missing row means "not pulled".
  - **Breakdown values come from a client's site**: paths only (no query
    strings), truncated to 200 characters, the top 50 per metric per day.
  - **`daily_visitors` is never summed across days.** Cookieless PostHog gives
    each visitor a hash that changes daily, so seven daily figures do not make a
    weekly one.
  - **These numbers can differ from the client's PostHog UI**, because
    "Filter out internal and test users" is a view-level filter the query API
    ignores, and because days here are the site's own timezone.
  - `src/server/snapshots/collect.ts` is the **only module under `src/server`
    with no session check**: it runs as the system, from the cron service, and
    an ESLint rule stops anything in `src/app` importing it. The app reads
    through `src/server/snapshots/read.ts`.
- 🟡 **Drift check**: unknown event names and expected events that stopped
  arriving, per site, surfaced on the client page and the overview.
- ✅ **Search pulls** (`add-search-console`, spec `search-performance`). Google
  Search Console through one Open Waters service account
  (`analytics-app@open-waters-analytics.iam.gserviceaccount.com`) and Bing
  Webmaster Tools through one Open Waters account (`analytics@openwaters.digital`),
  in the nightly job after the PostHog snapshot, into `site_search_daily`.
  - **Ten days re-pulled every night**, because both engines revise recent
    figures. A site marked as replacing an existing one backfills once: 16
    months of Google, about six of Bing, recorded by `backfilled_at` so it never
    repeats.
  - **Zeros only inside an engine's coverage.** A day with no data is a zero
    from the first day the engine has any, and nothing before it, so an engine
    an old site never used shows "history begins" rather than a cliff.
  - **Up to 1,000 queries and pages a day**, page addresses without their query
    strings. Position is stored multiplied by impressions, so averages weight
    correctly; Bing's site totals carry no position, so Bing's reads "Not
    reported".
  - **A weekly indexing pass on Mondays**: the submitted sitemaps, one index
    level deep, and up to 500 pages a site inspected, never-inspected first.
  - **The report** on the client page: the last 28 days against the 28 before
    for each engine and both, branded and non-branded clicks with the share of
    clicks they cover, the top queries and pages, organic clicks beside organic
    sessions and enquiries, and the pages Google has not indexed. Google's days
    are Pacific Time, and the report says so.
  - Confirmed against the live APIs on 25 September 2026 with nothing shared:
    tokens, empty site lists, and the refusals for an unshared property. The
    shape of real search data is confirmed when the first client shares a
    property (task 9.1).
- 🟡 **PageSpeed and Core Web Vitals** (`add-page-experience`, proposed): the
  Chrome UX Report nightly and PageSpeed Insights weekly, with one API key in
  the same Google Cloud project.
- 🟡 **Overview**: every client's health and headline trends on one screen.

### Reports

- 🔵 **Monthly report drafts**. Deliberately after the first report is written by
  hand from real Radara data, so the template comes from a report that worked
  rather than a guess.

---

## Delivery order

Locked. Revisit only if a dependency changes.

1. ✅ Bootstrap: toolchain, tokens, primitives, showcase, database plumbing,
   container, CI, OpenSpec.
2. ✅ `add-magic-link-auth`.
3. ✅ `add-client-registry`. Still to do: connect a real PostHog project (task 6.5).
4. ✅ Live at `analytics.openwaters.digital` (17 September 2026). Two 🧱 items remain: CSP and error tracking.
5. ✅ `add-nightly-snapshot`. The `analytics-jobs` cron service is declared in
   `.railway/railway.ts` and starts running when `railway config apply` creates
   it.
   5a. ✅ `add-provisioning`, with the measurement tier and its guard. Added 25
   September 2026 at Alex's request, outside the locked order: it is what the
   client onboarding checklist needs first.
6. ✅ `add-search-console`, Google and Bing. Moved ahead of the drift check on
   25 September 2026 at Alex's request, because the onboarding checklist asks
   for both on every site.
7. 🟡 `add-page-experience`: PageSpeed and Core Web Vitals.
8. 🟡 Drift check.
9. 🟡 Overview screen.
10. 🔵 Report drafts.

---

## Repo overview

```
.
├── AGENTS.md              This file
├── CONTEXT.md             Project vocabulary. Specs and code use these terms
├── docs/adr/              Architecture decisions, including what was rejected
├── openspec/              Specs and change proposals (config.yaml for rules)
├── src/
│   ├── app/               Routes. Server components by default
│   │   ├── (app)/         Everything behind sign-in: layout checks the session
│   │   │   └── design-system/  Showcase of every primitive, variant and state
│   │   ├── sign-in/       Public sign-in and check-email pages
│   │   └── api/           auth/[...all] (Better Auth), health/ (liveness)
│   ├── components/
│   │   ├── ui/            Primitives. variants.ts holds every style recipe
│   │   ├── registry/      RegistryForm, the form for registry screens, and ProvisioningPanel
│   │   └── showcase/      Section / Row / Entry for /design-system
│   ├── db/                Drizzle schema and client. auth-schema.ts is generated
│   ├── server/            Env, auth, session gate, crypto, PostHog queries. Server only
│   │   ├── registry/      Data access layer for the registry: session check, validation, writes
│   │   ├── provisioning/  Desired state, diff, the PostHog client, check/apply and the tier guard
│   │   ├── search-console.ts, bing-webmaster.ts
│   │   │                  The two engines' clients: fixed messages, never the key
│   │   └── snapshots/     collect.ts and search.ts run as the system (the job);
│   │                      read.ts and search-read.ts check the session
│   ├── proxy.ts           Optimistic signed-out redirect (Next 16's middleware)
│   ├── styles/tokens.css  Start here for anything visual
│   ├── lib/               Framework-free helpers safe for any module
│   └── test/              Test database setup (global-setup.ts) and session stand-in
├── scripts/               Node entry points bundled to dist/
│   └── jobs/              nightly-snapshot.ts: the cron service's command
├── drizzle/               Generated migrations. Reviewed, committed, never edited
├── compose.yaml           Local Postgres on port 5433 (luxury-gardens uses 5433 too: run one at a time)
├── .npmrc                 The @open-waters-digital scope on GitHub Packages, token from NODE_AUTH_TOKEN
├── renovate.json          Organisation settings (renovate-config), then the contract package's rules
├── Dockerfile             Multi-stage, standalone runtime, non-root
├── .railway/railway.ts    Railway service config: pre-deploy migrations, health check. Applied by CLI
```

---

## Tech stack

| Concern        | Choice                                                | Status                 |
| -------------- | ----------------------------------------------------- | ---------------------- |
| Framework      | Next.js 16 App Router, `output: "standalone"`         | ✅                     |
| Language       | TypeScript strict, `noUncheckedIndexedAccess`         | ✅                     |
| Styling        | Tailwind CSS v4, tokens in `src/styles/tokens.css`    | ✅                     |
| Font           | Inter Variable, self-hosted via Fontsource            | ✅                     |
| Database       | Postgres 17 (Railway), Drizzle ORM 0.45, drizzle-kit  | ✅                     |
| Validation     | Zod 4                                                 | ✅                     |
| Tests          | Vitest                                                | ✅                     |
| Auth           | Better Auth 1.7, magic link via Resend                | ✅                     |
| Email          | Resend                                                | ✅                     |
| Nightly jobs   | Railway cron service, bundled script, same image      | ✅                     |
| Error tracking | PostHog error tracking in an Open Waters organisation | 🧪                     |
| Hosting        | Railway, Docker                                       | ✅ config, 🟡 deployed |

Full reasoning and rejected alternatives:
[ADR 0001](docs/adr/0001-stack-and-hosting.md).

**Why scripts are bundled with esbuild.** The runtime image contains only the
files Next traced for the web server. The migration script and nightly jobs run
outside Next, so `scripts/build-scripts.mjs` bundles each into a self-contained
`dist/*.mjs`. Importing a package from a script is fine; running a script with
`tsx` in production is not, because `tsx` is not in the image.

---

## Schema and data-layer conventions

- **Schema** lives in `src/db/schema.ts`, one file until it hurts. Column names
  are snake_case in Postgres, camelCase in TypeScript (`casing: "snake_case"`).
- **Primary keys** are `uuid` generated in Postgres. The client **slug** is a
  unique, human-readable key, not the primary key.
- **Better Auth's tables** (`users`, `sessions`, `accounts`, `verifications`,
  `rate_limits`) are generated into `src/db/auth-schema.ts` by `pnpm auth:schema`
  and never edited by hand. After changing `src/server/auth-config.ts`,
  regenerate, then `pnpm db:generate`. They use Better Auth's column types,
  including `timestamp` without time zone: an accepted exception to the rule
  below.
- **Timestamps** are `timestamptz`. Every table has `created_at` and
  `updated_at`.
- **Money** is an integer in minor units plus an ISO 4217 currency column. Never
  a float.
- **Enums** are Postgres enums mirrored as TypeScript unions via Drizzle.
- **Index every foreign key** and every column a list screen filters on.
- **Migrations:** change the schema, run `pnpm db:generate`, read the SQL,
  commit both. Never edit a generated migration after it has been applied
  anywhere. CI fails if the schema and the committed migrations disagree.
- **Expand then contract.** A column rename is add, backfill, switch readers,
  then drop in a later deploy. Migrations run before new code serves traffic, so
  the old code must survive the new schema.
- **Data access** goes through functions in `src/server/`, which check the
  session first. Pages and actions call those functions; they never import
  `@/db/client` directly.

---

## Engineering standards

- **Types.** No `any` (lint error). No non-null assertions on external data.
  Parse external data (env, form input, PostHog responses) with Zod at the
  boundary and trust the types inside.
- **Server components by default.** A `"use client"` file needs a reason in the
  proposal: state that genuinely lives in the browser.
- **The browser never reaches the database or secrets.** `src/components/**`
  cannot import `@/db/*` or `@/server/*` (lint error). Server modules that must
  never be bundled for the client import `server-only`.
- **Every mutation is a boundary.** Re-validate input with Zod, check the session
  in the data access layer, return field errors, never echo secrets.
- **Every outbound call has a timeout** (`AbortSignal.timeout`), and the user
  sees a plain explanation when it fails, not a stack trace.
- **Fail closed.** If the session cannot be verified, the request is rejected.
- **Logging.** `console.info`/`warn`/`error` only (lint enforces). Log event
  types, client slugs and IDs. **Never log** API keys, session tokens, magic
  links, email addresses or anything decrypted.
- **Independent awaits** run under `Promise.all`.
- **Tests** cover failure modes, not only the happy path: bad input, expired or
  missing sessions, a rejected key, an upstream timeout.
- **Dependencies.** Every addition needs a reason. The lockfile is committed; CI
  installs frozen.

---

## Design system and UI standards

- **Ethos.** Same company as the marketing site: monochrome surfaces, near-black
  ink as the only action colour, Inter, hairline separation, semantic colour
  only for meaning. Denser than the marketing site, because this screen is for
  work.
- **Tokens only.** Feature code uses the utilities generated from
  `src/styles/tokens.css`. ESLint rejects literal hex colours outside the token
  file and the showcase. No arbitrary-value colours.
- **Colour never carries meaning alone.** A status dot always has a text label.
- **Primitives** live in `src/components/ui`; every style recipe lives in
  `variants.ts` and is defined once. Class strings stay literal.
- **Showcase rule.** A component is not done until it is on `/design-system`
  with every variant, size and state, in the same change that introduced it.
- **Mobile first.** Base styles are the phone, `md:`/`lg:` upward only. Tables
  scroll horizontally inside their wrapper rather than collapsing.
- **Copy.** British English, sentence case, plain words. Error messages say what
  happened and what to do next.
- **Charts** follow the `dataviz` skill when the first chart is built.

---

## Working with OpenSpec

- `/opsx:propose <idea>` creates `openspec/changes/<name>/` with proposal,
  design, specs and tasks. Planning only.
- Review the proposal. Applying is a **separate turn**: `/opsx:apply <name>`.
- `/opsx:archive <name>` once shipped, then sweep this file.
- **No proposal needed** for bug fixes, typos, dependency bumps, or tests for
  existing behaviour.
- Project context and per-artifact rules are in `openspec/config.yaml`.

---

## Definition of done

1. `pnpm run ci:quality` passes, and the real output is reported. Its tests need
   Postgres: run `pnpm db:up` first locally.
2. New boundaries are exercised against a running build: signed-out request
   rejected, invalid input returns field errors.
3. New screens checked at 375px before wider.
4. New or changed primitives are on `/design-system`, every variant and state.
5. No literal colours or magic values; tokens only.
6. The keyboard path works: every action reachable and visibly focused.
7. New logic has tests, including failure modes.
8. Schema changes have a reviewed, committed migration.
9. OpenSpec tasks ticked, change archived, this file swept.

---

## Privacy and security

**What this app stores:** client and site details, the names and work emails of
report recipients, encrypted PostHog API keys, **aggregate** daily numbers per
site, and a record of each provisioning run and of the PostHog dashboard and
insights it created (ids and contract keys, never setting values). From search:
clicks, impressions and position per day, by device, and for each engine's top
queries and pages; search queries exactly as the engines report them, which
are their own anonymised aggregates with rare queries withheld; page addresses
with their query strings removed; and each sitemap page's index verdict.

**Never stored here:** individual visitor data, session recordings, enquiry
contents, IP addresses of client-site visitors. The nightly snapshot asks
PostHog for counts only; no query it sends selects or groups by a distinct id, a
session id or a page address with its query string, and a test asserts that.

**Rules:**

- **Client PostHog keys** are encrypted with AES-256-GCM before they are
  written, using `CREDENTIALS_ENCRYPTION_KEY` from Railway. The key version is
  stored beside each ciphertext so the master key can rotate. Only server code
  that queries PostHog decrypts. The UI shows the last four characters.
- **Keys are scoped** to one PostHog project with Query Read only. A key with
  wider access is a mistake to fix, not a convenience.
- **Provisioning's write-capable key is never stored.** It arrives with one
  check or apply, goes to PostHog, and is gone when the request ends. A
  PostHog project response also carries the project's own secret tokens, so
  provisioning keeps only the settings it names from it.
- **Accounts** exist only for allowlisted addresses. There is no sign-up.
- **Search engines:** `noindex` in metadata and an `X-Robots-Tag` header on every
  response.

---

## Deploy

Railway builds from the GitHub repository. The order on every deploy is
**build → pre-deploy → start → health check → traffic switch**. The service's
settings live in `.railway/railway.ts` (Railway Infrastructure as Code).

| Step         | What runs                                                                                                                            | Set in `.railway/railway.ts` |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| Build        | The `Dockerfile`. **No database access.**                                                                                            | `build`                      |
| Pre-deploy   | `node dist/migrate.mjs`: applies pending Drizzle migrations. A non-zero exit stops the deploy and the previous version keeps serving | `preDeploy`                  |
| Start        | `node server.js` (Next standalone server)                                                                                            | `start`                      |
| Health check | `GET /api/health` must return 200 within 60 seconds                                                                                  | `healthcheck`                |

### The `analytics-jobs` cron service

A second Railway service, built from the same repository and the same
`Dockerfile`, declared in the same `.railway/railway.ts`:

| Setting | Value                                                                 |
| ------- | --------------------------------------------------------------------- |
| Start   | `node dist/jobs/nightly-snapshot.mjs`                                 |
| Cron    | `20 3 * * *` (03:20 UTC)                                              |
| Health  | None: the container runs once and exits                               |
| Deploy  | No pre-deploy. Migrations belong to the web service                   |
| Vars    | `DATABASE_URL`, `CREDENTIALS_ENCRYPTION_KEY`, and the two search keys |

`CREDENTIALS_ENCRYPTION_KEY` must be **the same value** as the web service, or
stored client keys cannot be decrypted. `GOOGLE_SERVICE_ACCOUNT_KEY` (the
service account's JSON key, base64) and `BING_WEBMASTER_API_KEY` are set on
both services too: the web service checks properties, the job pulls them.
Unset, each engine is dormant. The job reads `databaseEnv()` and
`credentialsKey()` only, never `env()`, so a missing auth or email variable
cannot stop the pull.

Exit codes are what Railway's run history shows: **0** when the run completed,
even with failed sites (a failed site is data, shown on the client page), and
**1** only when the run could not run at all.

```bash
railway logs --service analytics-jobs   # one JSON line per site, one summary
```

**Not `railway.json`.** Railway ignores `railway.json` for services created
after Config as Code was deprecated, without any warning in the deploy. This
service was one: its first deploys ran with no migration step and no health
check, and still reported success. Older services stop reading it on 1 December 2026. See the `railway` skill.

**Changing Railway config is not applied by a push.** After editing
`.railway/railway.ts`:

1. `railway config plan`: read-only. Read every line. Anything the file does not
   declare is removed on apply, so a plan that deletes a variable or changes
   `source` means the file is missing something.
2. `railway config apply`: changes the live project. Only on a plan with
   nothing unexpected.

`export const partial = "analytics"` limits the file to what it declares. Without
it Railway treats the file as the whole project and would delete the Postgres
service. Every service variable is listed with `preserve()`, which keeps the
value set in the dashboard; **a variable missing from that list is deleted on
the next apply**, so add new variables there in the same change as
`src/server/env.ts` and `.env.example`.

**Check a deploy really migrated:**

```bash
railway deployment list --json   # meta.serviceManifest.deploy.preDeployCommand must not be null
railway logs --deployment <id>   # look for "migrate: applied N" or "migrate: up to date"
```

**The build must never need the database.** This is the rule that keeps
migrations simple here, unlike luxury-gardens, where Payload prerenders pages
from the CMS so `next build` reads Postgres and migrations have to run inside
the build too. Railway runs the pre-deploy step _after_ the build, and its
private network does not exist during a build. So:

- The database connection is created on first use (`getDb()`), never at import.
  `src/db/client.test.ts` fails if importing it needs `DATABASE_URL`.
- Pages that read data are dynamic: they check the session, which reads request
  headers, so Next never prerenders them. Do not add `generateStaticParams` or
  build-time data fetching to a page that reads the database.
- CI's Docker job builds the image with no `DATABASE_URL`, so a change that makes
  the build touch the database fails there first.

**Migrations run before the new code serves traffic, while the old container is
still serving.** Every migration must work with the previous release's code:
add columns and tables freely; rename or drop only in two releases (expand, then
contract). See [Schema and data-layer conventions](#schema-and-data-layer-conventions).

**Pre-deploy calls `node` directly, not `pnpm`.** The runtime image has no pnpm
and no lockfile. The migration script is bundled with its dependencies into
`dist/migrate.mjs`, and the SQL files are copied to `/app/drizzle`.

**Railway service variables** (every one is documented in `.env.example`):

| Variable                     | Value on Railway                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | `${{Postgres.DATABASE_URL}}` (private address; pre-deploy has the service's network)                                             |
| `BETTER_AUTH_SECRET`         | `openssl rand -base64 32`                                                                                                        |
| `BETTER_AUTH_URL`            | The public `https://` URL, e.g. the Railway domain now, `https://analytics.openwaters.digital` later. Links and redirects use it |
| `RESEND_API_KEY`             | Required in production                                                                                                           |
| `AUTH_EMAIL_FROM`            | `Open Waters Analytics <noreply@analytics.openwaters.digital>`                                                                   |
| `CREDENTIALS_ENCRYPTION_KEY` | `openssl rand -base64 32`. Keep a copy in the password manager                                                                   |
| `AUTH_ALLOWED_EMAILS`        | Comma-separated partner addresses                                                                                                |
| `NODE_AUTH_TOKEN`            | Build argument: a classic GitHub token with `read:packages` only, to install `@open-waters-digital/analytics`. Also a CI secret  |

The migration step reads only `DATABASE_URL`. The web server refuses to serve
authenticated pages until the rest are valid.

**Verified locally (17 September 2026)** with a throwaway migration: the image
built with no `DATABASE_URL`; `node dist/migrate.mjs` from the image created the
table on a fresh database; a second run was a no-op; wrong credentials exited 1
with `migrate: failed`; the server then started and `/api/health` returned 200.
On Railway, the first deploys did not migrate because `railway.json` was ignored
(see above). After `railway config apply` (17 September 2026) the redeploy's
manifest showed the pre-deploy command and health check, and the pre-deploy step
ran before the container started.

---

## Before first deploy 🧱

- ✅ **Auth live** (`add-magic-link-auth`), with sign-in confirmed on the live
  URL.
- ✅ **Client IP header on Railway.** No "could not determine a client IP"
  warning in the logs after the first live sign-ins. Recheck if Railway's edge
  changes. If the warning appears, the rate limit is shared by every visitor;
  set `trustedProxies` or the right header in `src/server/auth-config.ts`.
  Original check: after the first sign-in, look for Better Auth's warning. If it appears, the
  rate limit is shared by every visitor; set `trustedProxies` or the right
  header in `src/server/auth-config.ts`.
- ✅ **Resend sending domain verified** for `analytics.openwaters.digital`.
  `AUTH_EMAIL_FROM` must use that subdomain: an `@openwaters.digital` sender is
  rejected with a 403 and no email is sent.
- ✅ **`CREDENTIALS_ENCRYPTION_KEY` generated and stored**
  (`openssl rand -base64 32`) as a Railway variable and in the Open Waters
  password manager. It is already listed with `preserve()` in
  `.railway/railway.ts`. Until it is set, the app runs but PostHog connections
  report that they are unavailable. Losing it makes every stored client key
  unreadable; they would need entering again.
- ✅ **Postgres backups** included on the Railway plan in use.
- 🧱 **Content-Security-Policy** added once the pages and their script needs are
  known.
- 🧱 **Error tracking** decided and wired (🧪 PostHog error tracking).
- ✅ **DNS:** `analytics.openwaters.digital` at Porkbun points to Railway, serves
  HTTPS, and `BETTER_AUTH_URL` uses it.

---

## Open questions

- 🧪 **Error tracking vendor.** PostHog error tracking in an Open Waters
  organisation is the lean; confirm once the Open Waters PostHog organisation
  exists.
- 🧪 **Report recipients.** Storing client contacts' names and work emails is
  ordinary B2B processing, but mention it in Open Waters' own privacy notice.

---

## Maintaining this document

This file is the source of truth and must be swept after every shipped change:
statuses flipped, delivery order updated, repo tree refreshed, resolved
questions removed. Drift is a bug. A document describing a system that no longer
exists is worse than none, because it is trusted.
