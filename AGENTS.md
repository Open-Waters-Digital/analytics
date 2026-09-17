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

- 🟡 **Clients, sites and connections** (proposed: `add-client-registry`).
  Clients, sites, PostHog connections with keys encrypted at rest, Search
  Console properties, expected events, commercial context and the learning log.
  Screens: clients list, client detail, add client. Saving a PostHog connection
  runs a live check.

### Data pulls

- 🟡 **Nightly PostHog snapshot**: per site with a working connection, the day's
  aggregates for the baseline dashboard metrics.
- 🟡 **Drift check**: unknown event names and expected events that stopped
  arriving, per site, surfaced on the client page and the overview.
- 🟡 **Search Console and PageSpeed pulls**: one Open Waters service account and
  one PageSpeed key for all clients.
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
3. 🟡 `add-client-registry`. Includes the PostHog connection check.
4. 🟡 First deploy to `analytics.openwaters.digital`, after the 🧱 list.
5. 🟡 Nightly PostHog snapshot, with the Railway cron service.
6. 🟡 Drift check.
7. 🟡 Search Console and PageSpeed pulls.
8. 🟡 Overview screen.
9. 🔵 Report drafts.

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
│   │   └── showcase/      Section / Row / Entry for /design-system
│   ├── db/                Drizzle schema and client. auth-schema.ts is generated
│   ├── server/            Data access layer, env, auth, session gate. Server only
│   ├── proxy.ts           Optimistic signed-out redirect (Next 16's middleware)
│   ├── styles/tokens.css  Start here for anything visual
│   ├── lib/               Framework-free helpers safe for any module
│   └── test/              Test-only stubs
├── scripts/               Node entry points bundled to dist/ (migrate, later jobs)
├── drizzle/               Generated migrations. Reviewed, committed, never edited
├── compose.yaml           Local Postgres on port 5433
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
| Nightly jobs   | Railway cron service, bundled script, same image      | 🟡                     |
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

1. `pnpm run ci:quality` passes, and the real output is reported.
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
report recipients, encrypted PostHog API keys, and **aggregate** daily numbers
per site.

**Never stored here:** individual visitor data, session recordings, enquiry
contents, IP addresses of client-site visitors.

**Rules:**

- **Client PostHog keys** are encrypted with AES-256-GCM before they are
  written, using `CREDENTIALS_ENCRYPTION_KEY` from Railway. The key version is
  stored beside each ciphertext so the master key can rotate. Only server code
  that queries PostHog decrypts. The UI shows the last four characters.
- **Keys are scoped** to one PostHog project with Query Read only. A key with
  wider access is a mistake to fix, not a convenience.
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

| Variable              | Value on Railway                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | `${{Postgres.DATABASE_URL}}` (private address; pre-deploy has the service's network)                                             |
| `BETTER_AUTH_SECRET`  | `openssl rand -base64 32`                                                                                                        |
| `BETTER_AUTH_URL`     | The public `https://` URL, e.g. the Railway domain now, `https://analytics.openwaters.digital` later. Links and redirects use it |
| `RESEND_API_KEY`      | Required in production                                                                                                           |
| `AUTH_EMAIL_FROM`     | `Open Waters Analytics <noreply@analytics.openwaters.digital>`                                                                   |
| `AUTH_ALLOWED_EMAILS` | Comma-separated partner addresses                                                                                                |

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

- ✅ **Auth live** (`add-magic-link-auth`). Still to do on Railway: set the auth
  variables above, sign in on the real URL, sign out, and confirm the old cookie
  is rejected.
- 🧱 **Client IP header on Railway.** After the first sign-in, check the logs for
  Better Auth's "could not determine a client IP" warning. If it appears, the
  rate limit is shared by every visitor; set `trustedProxies` or the right
  header in `src/server/auth-config.ts`.
- 🧱 **Resend sending domain verified** for `analytics.openwaters.digital` (SPF, DKIM,
  DMARC), or magic links land in spam and nobody can sign in.
- 🧱 **`CREDENTIALS_ENCRYPTION_KEY` generated and stored** in Railway and in the
  Open Waters password manager. Losing it makes every stored client key
  unreadable.
- 🧱 **Postgres backups** confirmed on the Railway plan in use.
- 🧱 **Content-Security-Policy** added once the pages and their script needs are
  known.
- 🧱 **Error tracking** decided and wired (🧪 PostHog error tracking).
- 🧱 **DNS:** CNAME `analytics` at Porkbun to the Railway domain; confirm HTTPS.

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
