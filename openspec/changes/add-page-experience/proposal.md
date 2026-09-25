# Add page experience

## Why

Speed is part of what Open Waters sells. Luxury Gardens was rebuilt because the
old homepage shipped 3.4 MB of HTML and 88 scripts, and every client site carries
a performance budget. None of that is visible after launch. Nobody measures
whether a site is still fast a month later, or whether an editor's 8 MB hero
image has undone it.

Google measures it anyway, from real Chrome visitors, and uses the result in
ranking. The app should hold the same numbers, beside the search data they
affect, so a slow month shows up in the report before it shows up in the
rankings.

This is the PageSpeed half of delivery step 7, split out of
`add-search-console` on 25 September 2026.

## What Changes

- **Two Google sources, one API key.**
  - **Field data from the Chrome UX Report**, meaning how the site performs for
    real Chrome visitors: the 75th percentile of Largest Contentful Paint,
    Interaction to Next Paint, Cumulative Layout Shift, First Contentful Paint
    and Time to First Byte, over a rolling 28 days, for phones and desktops,
    for the whole site and for each tracked page.
  - **Lab data from PageSpeed Insights**, meaning a fresh Lighthouse run on
    Google's servers: the performance score and the same timings measured in a
    simulated mid-range phone, for each tracked page.
  - Field data is what Google ranks on. Lab data is what a site gets when
    Chrome has too few visitors to report, which is true of most small client
    sites for their first months, and it catches a regression the day it ships
    rather than weeks later.
- **Tracked pages per site.** The home page by default, plus up to nine more
  chosen in the registry: the pages that carry enquiries and the landing pages
  that carry search traffic.
- **A performance budget per site**, optional: target values for LCP, INP, CLS
  and the lab performance score. A site with a budget shows pass or fail
  against it; a site without one is judged against Google's own "good"
  thresholds.
- **A nightly pull in `analytics-jobs`**, after the search pull:
  - Chrome UX Report field data for the site and each tracked page, both form
    factors, every night, because it moves daily.
  - On the first pull of a site marked "Replaces an existing site", the Chrome
    UX Report history, which goes back about six months in weekly steps, so a
    migration has the old site's speed to compare against. A new site has no
    history to fetch and skips it. Reports label data from before launch as
    "Previous site", or as pre-launch for a new site's Railway-hostname lab
    runs, using the setting `add-search-console` adds.
  - PageSpeed Insights lab runs for each tracked page on a phone, once a week,
    on Mondays, and on demand from the client page.
- **A new table, `site_page_experience`**, one row per site, day, source, page
  and form factor, with each metric's value and, for field data, the share of
  visits rated good, needs improvement and poor.
- **A Page experience section on the client page**:
  - a pass or fail for Core Web Vitals on phones and desktops, from field data
    where Chrome has enough visitors, and a plain "not enough Chrome traffic to
    report yet" where it does not
  - each metric's value against the budget or Google's thresholds, with its
    trend over the last three months
  - the latest lab score per tracked page, and a Run now button
  - a note that field data is a rolling 28 days, so a fix takes up to four
    weeks to show in full

## Capabilities

### New Capabilities

- `page-experience`: measuring how fast and stable a client site is for real
  visitors and in the lab, with tracked pages, an optional budget, the nightly
  and weekly pulls, and the report on the client page.

### Modified Capabilities

None.

## Impact

- **Depends on:** `add-nightly-snapshot` for the run, and `add-search-console`
  for `sites.replaces_existing_site` and the run's `source` column. It shares
  the Open Waters Google Cloud project with `add-search-console`, but uses an
  API key, not the service account.
- **Tables:**
  - `site_page_experience`, new. Aggregates only: the Chrome UX Report is
    already aggregated and anonymised by Google, and a Lighthouse run loads a
    public page as a robot.
  - `site_tracked_pages`, new: up to ten paths per site.
  - `site_performance_budgets`, new: optional targets per site.
  - `pe_lab_runs`, new: one row per lab run, so only one runs per site at a
    time and the page can show one in progress.
  - `site_snapshot_results.source` gains `page_experience`.
- **Secrets:** one, `GOOGLE_API_KEY`, on both Railway services, restricted in
  Google Cloud to the Chrome UX Report and PageSpeed Insights APIs. It reads
  public data about public pages, so a leak costs quota, not privacy. Still
  parsed with Zod, read only by server code, never logged, and listed with
  `preserve()` in `.railway/railway.ts` and in `.env.example`.
- **Outbound calls:** `chromeuxreport.googleapis.com` for field data and its
  history, and `pagespeedonline.googleapis.com` for lab runs. PageSpeed
  Insights runs are slow, often 15 to 40 seconds, and each gets 90 seconds
  before it counts as failed.
- **Dependencies:** none. Both APIs take an API key on a plain HTTPS request.
- **UI:** no new design token and no new primitive. The section composes Panel,
  Table, Badge, StatusDot and Button. Trends are shown as a table of monthly
  values, not a chart, until a chart primitive exists for the overview screen.
  At 375px the phone and desktop verdicts stack, each metric is one row of name,
  value and verdict, and the lab table shows the page and its score only; the
  timings appear from `md`.
- **Documents:** AGENTS.md's Data pulls, delivery order, repo tree and deploy
  variables. The contract package's tiers document and onboarding checklist,
  which list Core Web Vitals under Search Console today, are corrected to name
  this report.
- **Out of scope:** a CI performance budget on client sites, which belongs in
  each site's own pipeline; real-user monitoring from PostHog, which the
  cookieless baseline does not collect; and alerting, which the overview screen
  will handle for every source at once.
