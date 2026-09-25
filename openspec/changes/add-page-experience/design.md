# Design: add page experience

## Context

Google publishes two views of a page's performance, through two APIs that take
the same kind of API key.

- **The Chrome UX Report API** returns field data: what real Chrome users
  experienced, as the 75th percentile and the good, needs improvement and poor
  split, over the trailing 28 days, updated daily. It answers per origin or per
  URL, per form factor. It returns 404 when Chrome has too few visitors for the
  thing asked about, which is normal for a small site. Its **History** endpoint
  returns up to 25 weekly collection periods, about six months.
- **The PageSpeed Insights API** runs Lighthouse on Google's servers against a
  public URL and returns a lab result: a performance score and simulated timings
  on a mid-range phone with a throttled connection. Each call takes 15 to 40
  seconds. The free quota is 25,000 calls a day, far more than this app needs.

Google's Core Web Vitals are LCP, INP and CLS. FCP and TTFB are diagnostics
worth keeping beside them. The "good" thresholds are LCP at most 2.5 s, INP at
most 200 ms and CLS at most 0.1, at the 75th percentile. Luxury Gardens' own
budget is stricter: LCP under 2.0 s and CLS under 0.05.

The nightly run in `src/server/snapshots/collect.ts` already handles sites with
bounded concurrency and records a result per site per source, once
`add-search-console` adds the `source` column. This change adds a third kind of
source to it.

## Goals / Non-Goals

**Goals**

- Every client site's Core Web Vitals, phone and desktop, with a verdict a
  partner can read in a second.
- A weekly lab result for small sites that Chrome cannot yet report on.
- For a site that replaces an older one, the old site's history, so a
  migration can be judged on speed.

**Non-Goals**

- A performance budget enforced in each site's CI. That belongs to the site.
- A chart. The overview screen will bring the first chart primitive, and this
  report can take it up then.
- Alerts. The overview will surface every source's problems in one place.

## Decisions

### D1. An API key, not the service account

Both APIs read public data and accept an API key, so this change needs no OAuth
at all. The key lives in the same Open Waters Google Cloud project as
`add-search-console`'s service account, restricted in Google Cloud to these two
APIs so it cannot be used for anything else.

- **Rejected: calling without a key.** PageSpeed Insights allows a few anonymous
  calls, then refuses. The Chrome UX Report requires a key.

### D2. One table, with the source as a column

```
site_page_experience
  id               uuid pk
  site_id          uuid fk sites, cascade, indexed with day
  day              date             the day of the pull, UTC
  source           pe_source enum: field | field_history | lab
  scope            pe_scope enum: origin | page
  path             text             '' for origin, else the tracked path
  form_factor      pe_form_factor enum: phone | desktop
  status           pe_status enum: ok | not_enough_data | failed
  lcp_ms, inp_ms, fcp_ms, ttfb_ms, tbt_ms, speed_index_ms   integer, nullable
  cls              numeric(6,4), nullable
  lab_score        smallint 0..100, nullable
  good_share, ni_share, poor_share   jsonb, nullable   per metric, field only
  period_end       date, nullable   field_history only: the collection period's last day
  reason           text, nullable   fixed message when failed
  created_at, updated_at
  unique (site_id, day, source, scope, path, form_factor)
```

A field row describes the 28 days ending on its day. A history row keeps its
collection period's end in `period_end`, and its `day` is that date, so history
and nightly rows read as one series.

- **Rejected: rows in `site_daily_metrics`.** Integer values only, and one
  measurement would become a dozen rows. The same reasoning as
  `site_search_daily`.
- **Rejected: a table per source.** The report reads field and lab side by side,
  and the verdict falls back from one to the other.

### D3. What runs when

| Work                      | When                               | Calls per site                       |
| ------------------------- | ---------------------------------- | ------------------------------------ |
| Field, origin and pages   | Every night                        | Up to 22: 11 scopes × 2 form factors |
| Field history             | First pull, replacement sites only | Up to 22                             |
| Lab, tracked pages, phone | Mondays, and Run now               | Up to 10                             |

A 404 from the Chrome UX Report is stored as `not_enough_data`, not as a
failure, and does not fail the site. A site's page experience result is `ok`
when every call either returned data or returned `not_enough_data`.

Lab runs are phone only. The phone is where client sites are slowest and where
most of their visitors are, and a desktop run doubles the slowest calls in the
job for little new information. Field data covers desktops.

### D4. Run now

A button on the client page starts a lab run for one site as a server action,
which checks the session, then records a `pe_lab_runs` row as `running` and
works through the tracked pages. Each result is written as it arrives, so the
page shows progress on reload. A `running` row older than 10 minutes counts as
abandoned, so a crashed run cannot block the button for ever.

The action runs inside the web service's request, one page at a time, within a
maximum of 10 × 90 seconds. That is long for a request, so the action returns
at once after recording the run, and the work continues with `after()` from
`next/server`.

- **Rejected: a queue.** One more service and one more moving part, for a button
  two people press a few times a month.

### D5. Timeouts, and what the user sees

- Chrome UX Report calls: 10 seconds each, with one retry on 429 or 5xx.
- PageSpeed Insights calls: 90 seconds each, no retry, because a run that slow
  has usually failed on the site's side and a retry doubles the wait.
- A user sees fixed reasons only: "Google did not answer", "The page did not
  load", "Not enough Chrome traffic". Never Google's error text, and never the
  request URL, which carries the key.

### D6. Verdicts

For each form factor, from the latest field row for the origin:

- **Passing** when LCP, INP and CLS are all within the site's budget, or
  Google's threshold where the site has no target for that metric.
- **Failing** when any one is outside it, naming which.
- **Not enough Chrome traffic to report yet** when the origin's latest status
  is `not_enough_data`, with the lab results shown beneath.

INP can be missing from field data for a site with few interactions while LCP
and CLS are present. The verdict then judges the two it has and says INP is not
yet reported, rather than failing or passing on a gap.

### D7. Tracked pages and budgets in the registry

`site_tracked_pages` holds up to ten paths per site, one of them `/`, which
cannot be removed. The field is a list in the site form, reusing the pattern
`site_expected_events` already uses. `site_performance_budgets` holds one row
per site with four nullable targets, edited in the same form. Page URLs for the
APIs are built from the site's `production_url` and the path, so a tracked page
follows the site if its domain changes.

## Risks / Trade-offs

- **A small site shows little field data for months.** That is the truth about a
  small site, and the lab results carry the report meanwhile. The report says so
  rather than filling the space.
- **Lab results vary run to run.** Lighthouse scores move a few points between
  runs. The report marks a lab score below its target, labelled as one run on
  its date, but the Core Web Vitals verdict comes from field data wherever
  there is any, so one noisy run cannot turn a site's verdict red.
- **Before cutover, a site's production URL is a Railway hostname** that Chrome
  has no data for, and that serves `noindex`. Lab runs still work there, which is
  useful: a new site has lab results before launch.

## Migration Plan

1. The migration adds the three tables, `pe_lab_runs`, the enums, and
   `page_experience` to `snapshot_source`. Every existing site gets a tracked
   page of `/`. All additive.
2. Deploy with `GOOGLE_API_KEY` unset. The section says it is not configured.
3. In the Open Waters Google Cloud project, enable the Chrome UX Report and
   PageSpeed Insights APIs, create the key, restrict it to those two APIs, and
   set it on both Railway services.
4. Press Run now on one site, then let one nightly run pull field data.

**Rollback:** unset the key. The section goes dormant and stored data stays.

## Open Questions

- **The Open Waters Google account and Cloud project**, shared with
  `add-search-console`. Needed before task 1.
