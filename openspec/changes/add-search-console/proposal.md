# Add Search Console and Bing Webmaster Tools

## Why

PostHog sees a client's site from the click onwards. It cannot see the search
that came before it: the queries a site appeared for, how often it was shown,
where it ranked, and how often people passed it over. For most Open Waters
clients organic search is the largest channel, so a report without it explains
the smaller half of the traffic. The registry has stored a Search Console
property per site since `add-client-registry` and has shown it as "Not checked"
ever since, waiting for this change.

Bing comes in the same change. Its share of UK search is small, but its index
feeds the web search in several AI assistants, and AI assistants are already a
channel of their own in the enquiry data. Doing both at once means one table,
one report and one nightly pass, rather than a second round of each.

It moves ahead of the drift check in the delivery order at Alex's request, on
25 September 2026, because the client onboarding checklist in the contract
package now asks for both on every site, and they are worth nothing until the
app reads them. PageSpeed, which shared delivery step 7, becomes its own change,
`add-page-experience`.

## What Changes

- **One Open Waters account per engine reads every client.**
  - Google: a Google Cloud service account with the read-only
    `webmasters.readonly` scope. A client adds its email address to their
    property as a restricted user.
  - Bing: an Open Waters Bing Webmaster Tools account with an API key. A client
    adds that account to their site as a read-only user.
  - The onboarding checklist already asks for both. The app stores no search
    credentials per client.
- **Both get a check.** Saving a property or a Bing site, and a Check button
  beside each, asks the engine whether the Open Waters account can read it. The
  result is stored with a time, as PostHog connections store theirs. "Not
  checked" gives way to "Readable", "No access", "Not found" or "Check failed".
- **A Bing site field on each site**, beside the Search Console property,
  holding the site URL as Bing Webmaster Tools lists it.
- **A nightly pull, in the existing `analytics-jobs` run.** For every site with
  a readable property, after the PostHog snapshot:
  - Totals per day: clicks, impressions and position.
  - Google only: the same totals per day by device.
  - Queries and pages per day, up to 1,000 of each by impressions. That is
    every row Google or Bing returns for a small client, and a bounded sample
    for a large one.
  - The last 10 days every night, because both engines revise recent figures.
- **New sites and replacement sites are treated differently.** A new site
  setting, "Replaces an existing site", decides the first pull.
  - A replacement site, such as Luxury Gardens, backfills as far as each engine
    keeps data: 16 months for Google, about six for Bing. Everything before the
    launch date is the previous site's, and reports label it "Previous site", so
    before and after compare like for like.
  - A new site, such as Radara, has no history to fetch. Its first pull is the
    normal 10 days, and nothing before launch is presented as history.
- **A weekly indexing pass, Google only.** On Mondays the service account reads
  the property's submitted sitemaps and inspects each listed page with Google's
  URL Inspection API: indexed or not, and Google's reason if not. Up to 500 pages
  a site a week, least recently inspected first, well inside Google's 2,000
  inspections a day per property. A site of Luxury Gardens' size is covered in
  full every week. The report lists the pages Google has not indexed, which is
  the first thing to check after a migration.
- **A new table, `site_search_daily`**, holding clicks, impressions and a
  position total per site, engine, day and breakdown. The PostHog table's
  integer-only long format cannot hold position without inventing a scale for it.
- **The nightly run records each source's result per site**, PostHog, Google
  and Bing separately, so the run history shows which one failed.
- **Brand terms on the site.** A short list of words, such as the client's
  name, that mark a query as branded, used for both engines. The report splits
  branded from non-branded clicks, and says what share of clicks the split
  covers, since neither engine names every query.
- **The Search section on the client page becomes a report**: clicks,
  impressions, click-through rate and average position for the last 28 days
  against the 28 before, for Google, Bing and the two together; branded and
  non-branded clicks; the top queries and pages; and one line that puts organic
  search clicks beside PostHog's organic search page views and enquiries with
  channel `organic_search`.

## Capabilities

### New Capabilities

- `search-performance`: reading a site's Google Search Console property and
  Bing Webmaster Tools site with Open Waters' accounts. It covers the checks,
  the nightly pull and what it stores, brand terms, and the report on the client
  page.

### Modified Capabilities

None in `openspec/specs/`, which is still empty. The requirement this change
completes, "Search Console property" in `data-connections`, lives in the
unarchived `add-client-registry` change and says the property shows "Not
checked" "until a later change adds the check". This is that change. Its wording
is updated to point here (task 10.2).

## Impact

- **Depends on:** `add-nightly-snapshot`, whose run, concurrency helper and
  cron service this change extends. Independent of `add-provisioning`.
- **Tables:**
  - `site_search_daily`, new. Aggregates only: the engines return queries as
    anonymised aggregates and withhold rare ones. Unique on site, engine, day,
    breakdown and value, indexed on site and day.
  - `bing_webmaster_sites`, new, one per site: the site URL and its last check.
  - `search_console_properties` gains `last_check_at`, `last_check_status` and
    `last_check_message`.
  - `sites` gains `brand_terms`, a text array defaulting to empty, and
    `replaces_existing_site`, a boolean defaulting to false.
  - `site_index_status`, new: one row per inspected page, holding Google's
    verdict, its coverage reason, the last crawl time and when it was inspected.
    Public page addresses only, with no query strings.
  - `site_snapshot_results` gains `source`, defaulting to `posthog`, and its
    unique key widens to run, site and source. Every existing row is a PostHog
    result, so the migration only adds.
  - New enums: `search_engine`, `search_breakdown`, `search_check_status`,
    `snapshot_source`.
- **Secrets:** two, both on both Railway services, listed with `preserve()` in
  `.railway/railway.ts` and in `.env.example` in the same change, parsed with
  Zod when first used, read only by server code that imports `server-only`, and
  never logged or sent to the browser.
  - `GOOGLE_SERVICE_ACCOUNT_KEY`: the service account's JSON key, base64. It can
    read the properties clients chose to share and nothing else.
  - `BING_WEBMASTER_API_KEY`: the Open Waters Bing account's API key. It can act
    as that account on the sites shared with it, which the account only ever
    holds as a read-only user.
- **Outbound calls:** `oauth2.googleapis.com` for a Google token,
  `searchconsole.googleapis.com` for Google's property, sitemaps, Search
  Analytics and URL Inspection, `ssl.bing.com` for Bing's Webmaster API, and
  each client's own sitemap file, fetched from their site, once a week. Each has a timeout, and a
  failure stores a fixed message, never the engine's own error text.
- **Dependencies:** `google-auth-library`, for signing the service account's
  token request. Server only. Not the whole `googleapis` package, which is large
  and would be used for two endpoints. Bing's API is plain JSON over HTTPS and
  needs no library.
- **UI:** no new design token and no new primitive. The report composes Panel,
  Table, Badge and StatusDot. At 375px the four headline figures stack in two
  rows of two, the engine appears as a row label rather than a column, and the
  top lists show their first 10 rows with the query or page, clicks and
  impressions only. The other columns and rows appear from `md`.
- **Documents:** AGENTS.md's Data pulls, delivery order, repo tree, privacy
  section and deploy variables. The skill's search step names both accounts.
- **Out of scope:**
  - Core Web Vitals, which neither API exposes. `add-page-experience` covers
    them from the Chrome UX Report and PageSpeed Insights.
  - Indexing for Bing. Its API offers URL submission, not inspection.
