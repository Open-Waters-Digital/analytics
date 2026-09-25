# Design: add Search Console and Bing Webmaster Tools

## Context

The registry stores one Search Console property per site in
`search_console_properties`, validated as `sc-domain:<host>` or an `https` URL
ending in `/`, and shows it as "Not checked". Nothing reads it.

The nightly snapshot (`add-nightly-snapshot`) already runs every site through
`runNightlySnapshot` in `src/server/snapshots/collect.ts`, from the
`analytics-jobs` Railway cron service at 03:20 UTC, with
`mapWithConcurrency` at three sites at a time. It writes long-format integer
rows to `site_daily_metrics`, one transaction per site, and records a
`site_snapshot_results` row per site per run.

Google's Search Console API has three features that shape this design.

- **Service accounts are first-class users.** A property owner can add a
  service account's email address as a restricted user, and the account can
  then read the property's performance data with the `webmasters.readonly`
  scope. No OAuth consent screen and no per-client token.
- **Search Analytics data is late and revised.** The final figures for a day
  settle two to three days later. The API keeps about 16 months.
- **Days are in Pacific Time.** The API's `date` dimension is always
  America/Los_Angeles, whatever the property's audience. It cannot be converted
  into the site's timezone, because the API does not return hours for past
  data.

Bing's Webmaster API is plain JSON over HTTPS, authenticated by an API key that
belongs to one Bing account and can act on every site shared with that account.
Its query and page statistics cover about six months. Two things about it are
not settled from its documentation, and task 1.2 confirms them before any code
is written: the granularity of its query and page statistics, which may be
weekly rather than daily, and the timezone of its dates.

## Goals / Non-Goals

**Goals**

- Every onboarded site's search clicks, impressions and position, by day,
  device, query and page, in the app's own database.
- A check that tells a user in words whether the client has shared the
  property, before the first nightly run.
- One line on the client page from search to enquiry.

**Non-Goals**

- Core Web Vitals. Neither API has them; `add-page-experience` covers them.
- Page indexing status. The URL Inspection API works one URL at a time under a
  daily quota, which does not suit a nightly pull across every client.
- Writing to Search Console, such as submitting sitemaps. Read-only scope.

## Decisions

### D1. One service account, not OAuth per client

The app authenticates as one Open Waters service account and every client adds
its email address to their property. The onboarding checklist in the contract
package, and the skill's setup step 2, already ask for it.

- **Rejected: OAuth as each client.** A refresh token per client to encrypt,
  rotate and re-consent, and a Google OAuth app that needs verification for a
  sensitive scope. All to reach data the client can grant with one email
  address.
- **Rejected: OAuth as an Open Waters user.** Ties every client's data to one
  person's Google account, which breaks when that person leaves.

### D2. `google-auth-library` for the token, `fetch` for the calls

`google-auth-library`'s `JWT` client signs the token request and caches the
token until it expires. The two API calls go through `fetch` with
`AbortSignal.timeout`, parsed with Zod, in `src/server/search-console.ts`,
which imports `server-only`.

- **Rejected: the `googleapis` package.** Generated clients for every Google
  API, tens of megabytes installed, for two endpoints.
- **Rejected: signing the JWT by hand with `node:crypto`.** Possible in about 40
  lines, but token caching and clock-skew handling are what the library exists
  for, and getting them subtly wrong fails at 03:20 with nobody watching.

### D3. The key as one base64 environment variable

`GOOGLE_SERVICE_ACCOUNT_KEY` holds the JSON key file, base64-encoded so it
survives Railway's variable editor. `src/server/env.ts` decodes and parses it
lazily with Zod, like `CREDENTIALS_ENCRYPTION_KEY`: the `client_email` and
`private_key` fields are required. Unset means "not configured". Set but
unparseable is a configuration error, never "not configured", so a typo cannot
quietly switch the feature off.

- **Rejected: storing the key in the database, encrypted.** It is one key for
  the whole app, not per client, and the environment is where the app's other
  single secrets live.

### D4. A table of its own: `site_search_daily`

```
site_search_daily
  id              uuid pk
  site_id         uuid fk sites, cascade, indexed with day
  engine          search_engine enum: google | bing
  day             date            the engine's own day
  breakdown       search_breakdown enum: total | device | query | page
  value           text            '' for total, else the device, query or page, max 200
  clicks          integer >= 0
  impressions     integer >= 0
  position_sum    double precision >= 0   position × impressions
  created_at, updated_at
  unique (site_id, engine, day, breakdown, value)
```

Average position over any set of rows is `sum(position_sum) / sum(impressions)`,
which is what the "Averaging position" scenario asks for. Click-through rate is
`sum(clicks) / sum(impressions)`, computed when read, never stored.

- **Rejected: rows in `site_daily_metrics`.** Its `value` is a non-negative
  integer, so position would need a made-up scale, and one Google row would
  become three rows whose metrics can drift apart. It would also put
  Pacific-Time days beside days in the site's own timezone in one table, where a
  join by day would be wrong without anything saying so.
- **Rejected: a table per engine.** The report reads both engines the same way
  and combines them. An `engine` column keeps that one query.

### D5. The pull: four queries, a 10-day window, a first-pull backfill

Per site, four Search Analytics queries to Google:

| Query   | Dimensions     | Rows                                |
| ------- | -------------- | ----------------------------------- |
| Totals  | `date`         | One per day                         |
| Devices | `date, device` | Up to three per day                 |
| Queries | `date, query`  | Up to 1,000 per day, by impressions |
| Pages   | `date, page`   | Up to 1,000 per day, by impressions |

The 1,000 cut is applied after the call, per day: the API returns rows ordered
by clicks across the whole range, not per day, so the query and page calls page
through results with `rowLimit` 25,000 and `startRow`, up to a cap of 10 pages,
and each day's top 1,000 by impressions is kept. For a site of Luxury Gardens'
size that is every row Google returns; the cap only bites on a large site. The cap bounds a
large site's pull; a site that reaches it logs a warning with its slug.

The window is the 10 days up to yesterday. Stopping three days short, where
Google's figures settle, was considered and rejected: provisional figures are
more useful than none, and each night replaces them until they settle.

On a site's first pull, meaning no `site_search_daily` rows exist for it for
that engine, a site marked `replaces_existing_site` starts 16 months back, split
into 90-day chunks so no single call runs long. A site not so marked pulls the
normal 10 days: a new domain has nothing further back to fetch, and a new site
on an old domain has nothing of its own there. Marking a site later deletes
nothing; the next run sees the flag and fills the gap before its earliest row.

Reports split a replacement site's data at `sites.launched_on`: before it is
"Previous site". A site with no launch date is "Not launched yet", and its
figures are shown as pre-launch.

Zeros fill gaps only inside an engine's coverage. A backfill finds the first day
each engine returns any data for, and writes zero totals for empty days from
that day on, so absence still means "not pulled". Before it, nothing is written.
A site whose old owner never set up Bing, or whose Google property only holds a
few months, would otherwise show a cliff of zero clicks that never happened.
The report reads each engine's earliest row and says "history begins" on that
date, and a before-and-after comparison uses only the engines with data on both
sides of the launch date.

A migration that also changes domain is out of scope. The old domain's history
sits in a different property, and joining two properties into one series is its
own piece of work.

Everything for one site and engine is written in one transaction: delete the
window's rows for that engine, insert the new ones.

- **Rejected: 100 rows a day.** The first draft kept 100. It cut the branded
  split's coverage for no saving that matters: 1,000 rows a day for 30 clients
  is under 25 million rows a year, which Postgres holds without effort.

### D5a. Bing

Three Webmaster API calls per site: site traffic totals, query statistics and
page statistics, each for the site URL recorded in `bing_webmaster_sites`. The
same 10-day window, the same 1,000 cut, and on a first pull as far back as Bing
returns. Bing reports no device split, so Bing rows have no `device`
breakdown, and the report shows the device split for Google only.

If task 1.2 finds Bing's query and page statistics are weekly, each week's
figures are stored on the week's last day, the report sums them only over whole
weeks inside the period, and it says so. Totals stay daily either way.

### D5b. The weekly indexing pass

On Mondays, after the search pulls, for each readable Google property:

1. `GET sitemaps` for the property, which lists the sitemaps submitted in Search
   Console.
2. Fetch each sitemap from the client's site, with a 10-second timeout and a
   5 MB limit, following one level of sitemap index. Parse the `<loc>` entries,
   drop query strings and fragments, and keep addresses on the property's host.
3. Inspect up to 500 addresses with `urlInspection.index.inspect`, never
   inspected first, then oldest inspection first, one at a time with a
   200-millisecond gap. Google allows 2,000 a day and 600 a minute per property,
   so 500 a week leaves room for a partner using the inspection tool by hand.
4. Upsert each result into `site_index_status`, and delete rows for addresses no
   longer in any sitemap.

```
site_index_status
  id               uuid pk
  site_id          uuid fk sites, cascade
  address          text        max 500, no query string
  verdict          index_verdict enum: indexed | not_indexed | unknown
  coverage_state   text        Google's own label, such as "Page with redirect"
  last_crawl_at    timestamptz, nullable
  inspected_at     timestamptz
  created_at, updated_at
  unique (site_id, address)
```

`coverage_state` is the one place Google's own words are stored and shown,
because it is data about the client's page rather than an error, and there is
no better description of it.

- **Rejected: inspecting from the report's top pages instead of the sitemap.**
  A page with no search traffic is exactly the one most likely to be missing
  from the index.
- **Rejected: daily.** Indexing changes over days, and weekly keeps the quota
  free for anyone inspecting by hand.

### D6. Where it runs in the nightly job

After the PostHog snapshot, in the same process and the same run, with the same
concurrency of three: Google, then Bing, per site. The run's
`site_snapshot_results` gains a `source` column (`posthog`, `google_search` or
`bing_search`), and its unique key widens to run, site and source.

- **Rejected: a second cron service.** A second container to configure and
  preserve variables on, for work that takes seconds per site.
- **Rejected: running search and PostHog for a site concurrently.** The two
  have independent failure modes and different quotas, and interleaving them
  makes a failed run harder to read. Sequential per source is simpler and fast
  enough.

Each source runs even when another failed or was skipped. A client-owned
analytics site has no PostHog connection but can still share its search
properties.

### D7. The check, and what the status means for the pull

The check calls `GET sites/{siteUrl}` and reads `permissionLevel`. A readable
level is `siteOwner`, `siteFullUser` or `siteRestrictedUser`.
`siteUnverifiedUser` counts as "No access": the property exists but the account
cannot read its data.

| Google says                       | Stored status  | Nightly pull                                      |
| --------------------------------- | -------------- | ------------------------------------------------- |
| A readable permission level       | `readable`     | Pulled                                            |
| 403, 404, or `siteUnverifiedUser` | `no_access`    | Skipped until a check passes                      |
| Timeout, 5xx, network error       | `check_failed` | Pulled, since an outage says nothing about access |
| Not yet checked                   | null           | Pulled, and the pull sets the status              |

A pull that gets a 403 sets the property to `no_access`, so a client removing
access stops the nightly attempts without anyone editing the registry.

**There is no "not found" status.** The first draft had one for a 404. Checked
on 25 September 2026, `GET sites/{siteUrl}` answers 404, "not a verified Search
Console site in this account", for a property that exists but was never
shared, so a 404 cannot mean "does not exist". Both engines report the two
cases the same way, so the app reports them as one: "No access", worded as not
shared with the Open Waters account, or not a property. The line of guidance
covers both: check the property name, and add the account.

Bing's check asks for the sites the Open Waters account can see
(`GetUserSites`, `{"d": [...]}`) and looks for the recorded URL. A statistics
call for a site the account cannot see answers HTTP 400 with `ErrorCode` 14,
"NotAuthorized", which the pull reads as `no_access`. Listed means `readable`; not listed means `no_access`, since
Bing's API cannot tell "not shared" from "does not exist". An invalid key is a
configuration error for every Bing site, not `no_access` for each.

### D8. Timeouts, and what the user sees

- Token request: 10 seconds.
- The check: 10 seconds, matching `CHECK_TIMEOUT_MS` for PostHog.
- Each Search Analytics call: 30 seconds, matching `QUERY_TIMEOUT_MS`. One
  retry on a 429 or 5xx after a two-second wait, then the site fails for the
  night with the reason "Google did not answer".
- Bing: the same 10 seconds for the check and 30 for each statistics call, with
  the same single retry and the reason "Bing did not answer".

A user never sees either engine's error text. They see one of the fixed statuses and a
line of guidance. For `no_access` that line includes the service account's
email address, or the Open Waters Bing account's, which is not a secret and is
exactly what the client needs to be sent.

### D9. Brand terms, applied when read

`sites.brand_terms` is a `text[]`, up to 20 entries of up to 50 characters,
trimmed and lowercased on save. It sits on the site rather than on either
property because both engines use it. The report tests each stored
query against them with a case-insensitive `position(term in query) > 0` in the
read query. Applying them when reading, not when pulling, means a new term
recalculates history, which the "Terms changed later" scenario requires.

Branded and non-branded clicks come from the query rows, and the query rows
never add up to the total: both engines withhold rare queries, which on a small
site can be a third or more of clicks, and a large site may pass the 1,000 cut.
The report shows the share of total clicks the query rows cover beside the
split, so nobody reads a partial split as the whole.

### D10. The search-to-enquiry line

For the same 28 days, the report places:

- organic search clicks, from `site_search_daily` totals
- sessions whose channel type is `Organic Search`, from `site_daily_metrics`
  `sessions_by_channel`. The snapshot keeps sessions by channel, not page
  views by channel, and a session is the closer match to a click anyway
- `lead_submitted` with channel `organic_search`, from `site_daily_metrics`

Google's days are Pacific Time and the other two are in the site's timezone. A
Google day runs from 08:00 to 08:00 in the UK, so over 28 days the periods differ
by eight hours at each end, about one per cent. The line says so in a note
rather than pretending the three are joined by day.

- **Rejected: converting.** Google gives whole-day totals for past data, so
  there is nothing to convert. Moving PostHog's figures to Pacific Time instead
  would misalign every other report to straighten this one line.

## Risks / Trade-offs

- **A large site's pull is capped.** Ten pages of 25,000 rows per query per
  chunk is more than any current client produces. The warning makes the first
  site that reaches it visible.
- **Query lists are a sample.** Queries an engine withholds, and any past a
  day's 1,000, are only in the totals. The report states coverage (D9) rather
  than hiding it.
- **The engines revise and withhold.** Figures for the last few days change,
  and rare queries never appear. Both are the engines' behaviour, and the report
  says so.
- **Bing's granularity is unconfirmed.** Task 1.2 settles it before any code,
  and D5a covers both answers.
- **One key for every client.** If it leaked, it would read every shared
  property's performance data, and nothing else, since the scope is read-only
  and the account owns nothing. Rotating it is a new key in Google Cloud and in
  Railway, and no client has to do anything, because clients share the property
  with the account's email address rather than with a key. The Bing key is the
  same shape: it can act only as a read-only user on sites shared with it, and a
  new one is generated in Bing's settings.

## Migration Plan

1. The migration adds `site_search_daily`, `bing_webmaster_sites`, the four
   enums, three columns on `search_console_properties`, `brand_terms` on
   `sites`, and `source` on `site_snapshot_results` with its wider unique key.
   All additive: old code ignores the new columns, and every existing result row
   is PostHog's.
2. Deploy with both keys unset. Every property shows its engine as not
   configured, and nothing calls Google or Bing.
3. Set up Open Waters' accounts (see Open Questions), then set both keys on both
   Railway services.
4. Add the accounts to one real client's property and Bing site, run the checks,
   and let one nightly run pull them.

**Rollback:** unset either key. That engine goes dormant and its stored data
stays.

## Open Questions

- **Open Waters' accounts do not exist yet.** They are needed before task 1:
  a Google account on the Open Waters domain that both partners can reach,
  owning a Google Cloud project with the Search Console API enabled and the
  service account in it; and a Microsoft account on the same shared address for
  Bing Webmaster Tools, with an API key. The same Google Cloud project will hold
  `add-page-experience`'s API key.
- **Radara's property.** The first real client. Confirm it is a domain property
  and who at Radara can add the service account.
