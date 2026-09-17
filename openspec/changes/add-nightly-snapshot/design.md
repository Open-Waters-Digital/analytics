# Design

## Context

The registry holds clients, sites and PostHog connections, and
`src/server/posthog.ts` already proves a key can query a project with a HogQL
`POST /api/projects/:id/query/`. Keys are encrypted with the connection id as
associated data (`src/server/crypto.ts`). The app is a single Railway service
built from `Dockerfile`, configured in `.railway/railway.ts`, with migrations in
its pre-deploy step. `scripts/build-scripts.mjs` bundles Node entry points that
run outside Next into `dist/`, which is how `dist/migrate.mjs` reaches the
runtime image.

Open Waters' own site sends the version 1 event list today
(`src/lib/event-list.ts` mirrors it), so this change has one real project to pull
from. Motivation is in proposal.md; the metric list is in the spec.

Two facts learned on 17 September 2026 that shape this:

- **PostHog's "Filter out internal and test users" is a view-level filter.** It
  applies to insights, dashboards and Activity, and is ignored by the query API.
  Snapshots therefore count what was ingested, which can differ from what the
  PostHog UI shows.
- **PostHog drops events it believes came from a bot**, including headless
  browsers, at ingestion. Nothing here can recover those.

## Goals / Non-Goals

**Goals:**

- Aggregate numbers per site per day, owned by this app, correct within a day.
- A pull that survives a broken connection, a bad key, and a missed night.
- Visible evidence in the app that it ran, and what it found.

**Non-Goals:**

- Visitor-level data of any kind. This is the one rule the whole design serves.
- Drift detection (unknown or missing events). Next change; it reuses this job's
  plumbing but asks a different question.
- Search Console and PageSpeed. Two changes away.
- Reading these numbers in any way but a panel on the client page. The overview
  screen and reports come later.
- Backfilling a site's whole history. Seven days each night, thirty on the first
  pull, and nothing older.

## Decisions

### One long table: `site_daily_metrics`

```
site_id, day (date, in the site's timezone), metric, dimension, value,
value_minor, currency
unique (site_id, day, metric, dimension)
```

`metric` is a name from `src/lib/snapshot-metrics.ts`; `dimension` is the
breakdown value (`cta_id`, channel, page type, form id, landing path) or `''`
when the metric has none, so the unique constraint works without a nullable
column. `value` is a count. `value_minor` and `currency` are set only for
`deal_won_value`, following the money rule in AGENTS.md.

Long rather than wide because the metric set will keep growing (drift, Search
Console, PageSpeed) and every addition would otherwise be a migration and a
column nobody backfills. The cost is that reads aggregate in SQL rather than
selecting columns, which at two users and a few thousand rows a month is
nothing.

**Guards, because dimension values come from a client's site:** at most 50 rows
per metric per day (the top 50 by count; the tail is dropped, not bucketed, and
the screen says so), each dimension truncated to 200 characters. Landing pages
are stored as the **path only**: query strings and fragments are removed before
the value is written, because a query string can carry an email address or a
token.

Alternative: **a row per site-day with a JSONB blob** — rejected: no
constraints, no indexes, every reader re-parses.

### `snapshot_runs` and `site_snapshot_results`

`snapshot_runs`: `id`, `started_at`, `finished_at`, and the counts of sites
succeeded, failed and skipped. `site_snapshot_results`: `run_id`, `site_id`,
`outcome` (`ok` / `failed` / `skipped`), `reason` (a fixed message, never
PostHog's text), `days_written`, `duration_ms`.

Both are needed. Per-site rows alone cannot record a run that died before it
reached a site, which is exactly the silence the app must be able to show.

Rows are kept for 90 days; each run deletes older ones. A job log is not
evidence anybody keeps.

### The window: seven days, thirty on the first pull

Every run re-pulls the last 7 complete days in the site's timezone and replaces
them. A site with no stored metrics at all pulls 30 days instead, so the first
run after connecting a site is immediately worth looking at. The queries are the
same; only the lower bound differs.

Seven days covers a weekend outage and any realistic ingestion lag without
making the nightly cost grow.

### Days come from ClickHouse, not from Node

Each query groups by `toDate(toTimeZone(timestamp, {timezone}))` and filters on
that same expression between `{from}` and `{to}`, with a coarse
`timestamp > now() - INTERVAL 45 DAY` so ClickHouse can skip partitions. The
site's IANA timezone (already validated on the site record) is passed as a
placeholder value.

Doing the conversion in HogQL avoids writing a DST-correct "start of day in
Europe/London" helper in Node, which is the kind of code that is wrong twice a
year.

### One request per metric group, five groups per site

| Group      | Query returns                                                           |
| ---------- | ----------------------------------------------------------------------- |
| Traffic    | page views, sessions, daily visitors                                    |
| Breakdowns | page views by page type, sessions by channel, landing page views        |
| Intent     | `cta_clicked`, `contact_link_clicked`, `file_downloaded`,               |
|            | `outbound_link_clicked`, `video_played`, sessions reaching 75% scroll   |
| Action     | `form_started`, `form_submitted`, `form_abandoned`, `form_error_shown`, |
|            | `lead_submitted`                                                        |
| Revenue    | `lead_qualified`, `deal_won`, `deal_won` value                          |

Every group returns the same four columns (`day`, `metric`, `dimension`,
`value`) by `UNION ALL`, so one parser and one Zod schema handle all of them,
and adding a metric is a line of SQL rather than a new code path.

Five requests per site per night is far inside PostHog's limits, and a group
that fails is identifiable in the logs.

Rejected: **one query per site** (a single typo loses everything, and the query
becomes unreadable); **one query per metric** (about twenty requests per site,
for no benefit).

### `daily_visitors` is a daily number and must never be summed

In cookieless mode PostHog's `distinct_id` is a hash that rotates daily, so
`uniq(distinct_id)` for one day is a fair daily-unique count, and adding seven
of them is not a weekly-unique count. The metric is named `daily_visitors` to
make misuse harder, and the rule is a comment on the metric list and a line in
AGENTS.md.

Sessions come from `uniq($session_id)`, which cookieless server hash mode
provides.

### A shared query function, reusing the existing classifier

`src/server/posthog.ts` grows `runHogQlQuery(connection, query, values)`, which
`checkPostHogConnection` is then written in terms of, so there is one place that
knows the host, the auth header, the timeout and how to read a failure.
`classifyCheckResponse` is unchanged and still maps a status to the four
connection states with fixed messages.

**Timeout 30 seconds per query** (the check's 10 is for a person waiting; these
aggregate over up to thirty days). On 429 or 5xx the job retries once after five
seconds, then gives up on that site. What a person sees is on the client page:
"Last pull failed: PostHog could not be reached", never PostHog's own text.

When PostHog answers 401, 403 or 404, the job writes the result to the
connection's `last_check_*` columns, so the registry screen shows a broken key
without anyone running the check by hand.

### Per site: read, query, then one transaction

For each site the job decrypts the key, runs the five queries, and only then
opens a transaction that deletes the window's rows for that site and inserts the
new ones, plus explicit zero rows for `page_views`, `sessions`, `daily_visitors`
and `lead_submitted` on every day in the window. A failure before the
transaction leaves the previous values exactly as they were, and a re-run
replaces rather than doubles.

The zero rows are what make a missing row mean "not pulled" rather than "quiet
day".

Sites are processed with a concurrency of three, so one slow project does not
hold up the rest and nothing depends on how many clients there are.

### The job has no session, and says so

`requireSession()` cannot apply: there is no request and no user. So the module
split is explicit:

- `src/server/snapshots/collect.ts` — the job's own path. No session check, only
  reachable from `scripts/jobs/nightly-snapshot.ts`, `import "server-only"` at
  the top, and a comment saying it runs as the system.
- `src/server/snapshots/read.ts` — everything the app reads, each function
  calling `requireSession()` first, as AGENTS.md requires.

An ESLint `no-restricted-imports` rule stops anything under `src/app/` importing
`collect.ts`.

The job reads `databaseEnv()` and `credentialsKey()` only, never `env()`: it has
no use for auth or email variables and must not fail because one is missing.

### A second Railway service, same repo, same image

```ts
const jobs = service("analytics-jobs", {
  source: github("Open-Waters-Digital/analytics", { branch: "main" }),
  build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
  start: "node dist/jobs/nightly-snapshot.mjs",
  deploy: { cronSchedule: "20 3 * * *" },
  replicas: 1,
  env: {
    DATABASE_URL: preserve(),
    CREDENTIALS_ENCRYPTION_KEY: preserve(),
  },
});
```

added to the existing `partial = "analytics"` file and returned in the same
`project()`.

- **No `preDeploy`.** Migrations belong to one service. Two services migrating
  the same database on the same push is a race for no gain.
- **No healthcheck.** The container runs once and exits.
- **03:20 UTC**, after any ingestion lag and outside UK working hours.
- `DATABASE_URL` is Railway's `${{Postgres.DATABASE_URL}}` reference and
  `CREDENTIALS_ENCRYPTION_KEY` is the same value as the web service. Both are set
  on the new service in the dashboard and then held by `preserve()`. Whether a
  cross-service reference (`${{analytics.CREDENTIALS_ENCRYPTION_KEY}}`) is
  resolved by an IaC apply is **checked in the plan before applying**, not
  assumed; if it is not, the value is set on the service directly.
- Railway's default restart policy is left alone. Setting `restartPolicyType`
  here produced a permanent diff last time, because Railway stores the default as
  null.

A cron service is not free: Railway builds the image a second time on every
push. Accepted, because the alternatives are worse.

Rejected: **an in-process scheduler in the web service** (a deploy or restart in
the wrong minute skips the night, and it ties the pull to the web server's
lifetime); **a GitHub Actions schedule calling an endpoint on the app** (a new
public route and a shared secret, to avoid a service Railway already provides);
**a separate slim Dockerfile for jobs** (a second build definition to keep in
step, saving build minutes nobody is paying for).

### `scripts/jobs/nightly-snapshot.ts`

Bundled by `scripts/build-scripts.mjs` as a second entry point,
`"jobs/nightly-snapshot"`, producing `dist/jobs/nightly-snapshot.mjs`, alongside
the existing migrate entry. It logs one JSON line per site
(`{ event, site, outcome, days, ms }`) and one summary line, exits 0 when the run
completed (even with failed sites, which are data, not a crash) and 1 only when
the run itself could not start or the summary could not be written, so Railway's
run history shows a genuine failure rather than every bad key.

A `job:snapshot` package script runs the same file with `tsx` against the local
environment file, for local work.

### What the app shows

- **`/clients/[slug]`**, per site: a panel with the last pull's time and outcome,
  and a table of the last seven days — day, page views, sessions, leads. Built
  from `Panel`, `Table` and `StatusDot`, which all exist; no new primitive.
  At 375px the table scrolls inside its wrapper, as the other tables do.
- **`/clients`**: one line above the list, "Snapshot last ran <relative time>",
  in the warning tone when the last run finished more than 48 hours ago or never
  ran at all.
- A site never pulled says "Not pulled yet", and a site with no connection says
  nothing new, because it already says it has no connection.

## Risks / Trade-offs

- [A HogQL query is subtly wrong and stores a plausible but false number] →
  tasks 1.1 and 8.2 compare every metric for one real day against the same
  number read in the PostHog UI, with the internal-users filter off, before the
  job is trusted.
- [PostHog changes HogQL or a property name] → responses are parsed with Zod at
  the boundary; a shape change fails the site loudly rather than writing
  nonsense, and the failure is on the client page.
- [Dimension values from a client's site are hostile or enormous] → truncated,
  capped at 50 rows, paths stripped of query strings, and stored as values,
  never rendered as HTML.
- [The window replace deletes rows and the insert then fails] → both happen in
  one transaction.
- [The cron service silently stops running] → the 48-hour line on `/clients`; it
  is the only reason that line exists.
- [Cost of a second Railway service] → a short-lived container once a day and a
  second image build per push. Negligible on the current plan; revisit if a
  third service appears.
- [Numbers here will not match the client's PostHog UI] → because of the
  view-level internal-users filter and any date range in a different timezone.
  Documented in AGENTS.md and in the `openwaters-analytics` skill, so it is
  explained once rather than rediscovered in a client meeting.

## Migration Plan

1. Merge and deploy the code. The new tables migrate in the web service's
   pre-deploy step; nothing reads them yet.
2. Run the job locally against production data once and check the numbers
   against the PostHog UI.
3. Railway: create the `analytics-jobs` service, set its two variables,
   `railway config plan` (expect only the new service and no change to the web
   service), then `railway config apply`.
4. Trigger the job once from Railway, read the logs, confirm the client page
   shows the run.
5. Rollback: remove the cron schedule in the dashboard. The tables can stay; they
   are additive and nothing else depends on them.
