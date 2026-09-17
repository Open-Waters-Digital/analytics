# Proposal

## Why

The registry knows which sites exist and can reach their PostHog projects, but
the app holds no numbers. Every report, trend and comparison would otherwise
re-query PostHog live, which is slow, rate limited, and impossible to compare
across clients whose projects are separate. A nightly snapshot turns the day's
behaviour into rows this app owns: the basis of the monthly report, the
cross-client overview, and the "compounding" story that needs history.

It also makes the connection worth having. Open Waters' own site is sending the
shared event list today, so there is real data to pull.

## What Changes

- **A nightly job** pulls yesterday's numbers for every site with a working
  PostHog connection and stores them as daily rows.
- **What is stored** covers the Digital Dividend ladder, from the event list:
  - **Attention:** page views, sessions, visitors; sessions by channel; page
    views by page type; top landing pages.
  - **Intent:** `cta_clicked` by `cta_id`; `contact_link_clicked` by channel;
    `file_downloaded`; `outbound_link_clicked`; sessions reaching 75% scroll.
  - **Action:** `form_started`, `form_submitted`, `form_abandoned` and
    `form_error_shown` by `form_id`; `lead_submitted` by `lead_type`.
  - **Revenue:** `lead_qualified` and `deal_won` counts and value, when a site
    sends them.
- **Aggregates only.** Counts by day and by dimension. No visitor-level data,
  no identifiers, nothing that could name a person.
- **Re-pulls a short window** (the last 7 days) each night, so late-arriving
  events and short outages correct themselves. A site's first pull covers 30
  days, so a newly connected site is worth reading the next morning.
- **Runs per site, isolated:** one site failing does not stop the others, and
  each failure is recorded against that site with its reason.
- **Records every run** (started, finished, sites succeeded and failed) so the
  app can show when it last worked, rather than going quiet.
- **Sites are skipped** when their client is not active, when analytics are
  client-owned with no connection, or when the connection's last check failed.
- **On the client page:** when the snapshot last ran for each site, and the last
  seven days of headline numbers, so the pull is visible before the overview
  screen exists.
- **A Railway cron service** runs the job daily from the same image as the app.

## Capabilities

### New Capabilities

- `daily-snapshots`: what is collected each night, for which sites, how it is
  stored and corrected, what happens when a pull fails, and what the app shows
  about it.

### Modified Capabilities

None. `client-registry` and `data-connections` are unchanged: the job reads the
registry and reuses the existing PostHog check and key decryption.

## Impact

- **Database:** three new tables (`site_daily_metrics`, `snapshot_runs`,
  `site_snapshot_results`) and one migration. No secret is stored; the existing
  encrypted keys are read, never copied.
- **Code:** `src/server/posthog-queries.ts` (HogQL queries and parsing),
  `src/server/snapshots/*` (the pull, per site), `scripts/jobs/nightly-snapshot.ts`
  bundled to `dist/jobs/nightly-snapshot.mjs`, plus a panel on the client page.
- **Deploy:** a second Railway service (`analytics-jobs`) declared in
  `.railway/railway.ts`, built from the same repo and image, with a cron
  schedule and no health check. It runs the job and exits.
- **Outbound:** PostHog's query API, once per metric group per site per night,
  within its published limits.
- **Environment:** none new. The job reads `DATABASE_URL` and
  `CREDENTIALS_ENCRYPTION_KEY`, which the service already has.
- **Cost:** PostHog's free tier covers this; the queries read aggregates, not
  events.
- **No new UI primitives or tokens.** The panel composes `Panel`, `Table` and
  `StatusDot`. At 375px it is a single column, the run summary reads as stacked
  lines, and the seven-day table scrolls horizontally inside its wrapper like
  every other table in the app.
- **Secrets:** none added. The job decrypts existing connection keys in memory
  to make its queries, and never logs or stores them.
