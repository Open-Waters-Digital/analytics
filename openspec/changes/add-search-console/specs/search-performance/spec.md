# Spec Delta

## Purpose

Reads each client site's Google Search Console property and Bing Webmaster
Tools site with Open Waters' own accounts, so the app can report the searches
that came before a visit: what a site appeared for, how often, where it ranked
and how often it was chosen.

## ADDED Requirements

### Requirement: One Open Waters account per engine

The system SHALL read Google Search Console with a single Open Waters service
account using a read-only scope, and Bing Webmaster Tools with a single Open
Waters account's API key. It SHALL NOT store search credentials per client. For
each engine, an unset credential SHALL mean that engine is not configured: no
check or pull is attempted for it and the client page says so. A credential that
is set but cannot be parsed SHALL fail every check and pull for that engine as a
configuration error, rather than being treated as unset.

#### Scenario: Engine not configured

- **WHEN** the Bing API key is unset and the Google key is set
- **THEN** every Bing site shows "Bing not configured", the nightly run records
  each site's Bing pull as skipped with that reason, and Google is checked and
  pulled as normal

#### Scenario: Malformed credential

- **WHEN** the Google service account key is set but is not a valid service
  account key
- **THEN** Google checks show "Check failed", the nightly run records each
  site's Google pull as failed with a configuration reason, and the log names the
  variable and never its value

### Requirement: Recording a Bing site

A user SHALL be able to record one Bing Webmaster Tools site per site, as an
`http` or `https` URL ending in `/`, beside the site's Search Console property.

#### Scenario: Valid Bing site

- **WHEN** a user enters `https://www.luxury-gardens.co.uk/`
- **THEN** it is stored and checked

#### Scenario: Invalid Bing site

- **WHEN** a user enters `luxury-gardens.co.uk`
- **THEN** nothing is stored and the field explains the accepted format

### Requirement: Checking a property

The system SHALL check a Search Console property or a Bing site when a user
saves it and when a user asks for a check, by asking the engine whether the
Open Waters account can read it. It SHALL store the outcome and the time, and
SHALL show one of: "Readable", "No access", "Not found" or "Check failed". A
property never checked SHALL show "Not checked". The message shown SHALL be the
app's own, never the engine's error text.

#### Scenario: Shared property

- **WHEN** the client has added the Open Waters account to the property and a
  user runs the check
- **THEN** the property shows "Readable" with the time of the check

#### Scenario: Not shared

- **WHEN** the property exists but the Open Waters account has not been added to
  it
- **THEN** the property shows "No access" with a line telling the user which
  account to add, and at what level

#### Scenario: Engine unreachable

- **WHEN** the engine does not answer within the timeout
- **THEN** the property shows "Check failed", the stored property is kept, and
  the previous successful check time is not presented as current

#### Scenario: Unauthenticated check

- **WHEN** a request to check a property arrives without a session
- **THEN** it is rejected and no call is made to either engine

### Requirement: A nightly search pull

Once a day, as part of the nightly run and after the PostHog snapshot, the
system SHALL pull each engine's data for every site whose client is
`onboarding`, `active` or `paused` and whose property for that engine is not in
state "No access" or "Not found". It SHALL re-pull the last 10 days on every
run. Each site's pull from each engine SHALL be written in one
transaction, so a re-run replaces rather than doubles and a failure leaves the
previous values in place. The run SHALL record each site's result per source:
PostHog, Google and Bing.

#### Scenario: A readable property

- **WHEN** the nightly run reaches a site whose Google property is readable
- **THEN** the last 10 days of Google search data are stored for it, and the run
  records the site's Google pull as ok

#### Scenario: First pull

- **WHEN** a site's Google property is pulled for the first time
- **THEN** the first pull covers what the "New and replacement sites"
  requirement says for that site

#### Scenario: Revised figures

- **WHEN** an engine has changed a figure for a day inside the last 10 days
- **THEN** the next run replaces the stored figure rather than adding to it

#### Scenario: Access removed

- **WHEN** a client removes the Open Waters account from their property
- **THEN** that night's pull from that engine fails with "No access", the
  property's status changes to "No access", earlier stored data is kept, and
  later runs skip that engine for the site until a check passes

#### Scenario: One source fails

- **WHEN** a site's Bing pull fails and its PostHog and Google pulls succeed
- **THEN** the run history shows three results for that site, one failed

### Requirement: New and replacement sites

A user SHALL be able to mark a site as replacing an existing site. For a site so
marked, the first pull from each engine SHALL go back as far as that engine
keeps data, and reports SHALL label data from before the site's launch date as
"Previous site". For a site not so marked, the first pull SHALL cover only the
normal window, and reports SHALL NOT present data from before the launch date
as the site's history. A site with no launch date recorded SHALL be treated as
not launched, and its report SHALL say so.

#### Scenario: Replacement site

- **WHEN** a site marked as replacing an existing site, launched on 1 October
  2026, is pulled for the first time
- **THEN** Google data back to 16 months earlier is stored, and the report's
  figures before 1 October 2026 are labelled "Previous site"

#### Scenario: New site

- **WHEN** a site not marked as replacing an existing site is pulled for the
  first time
- **THEN** only the normal 10-day window is pulled

#### Scenario: Marked later

- **WHEN** a user marks an already-pulled site as replacing an existing site
- **THEN** the next nightly run backfills it as a first pull would

#### Scenario: Replacement site with no search history

- **WHEN** a site replaces an existing one whose owner never set up Bing, and
  Bing returns nothing before the new site's property was added
- **THEN** the report shows Bing from the day its data begins, says there is no
  earlier Bing history, and compares before and after on Google alone

### Requirement: Weekly indexing check

Once a week the system SHALL read each Google property's submitted sitemaps,
fetch the page addresses they list, and inspect up to 500 of them per site with
Google's URL Inspection API, those never inspected first and then the least
recently inspected. It SHALL store, per page, whether Google has indexed it,
Google's coverage reason when it has not, the last crawl time and when it was
inspected. It SHALL NOT exceed Google's daily inspection quota for a property.
Page addresses SHALL be stored without query strings.

#### Scenario: A small site

- **WHEN** a readable property's sitemaps list 30 pages
- **THEN** all 30 are inspected that week and their results stored

#### Scenario: A page not indexed

- **WHEN** Google reports a listed page as not indexed because it redirects
- **THEN** the report lists the page with that reason

#### Scenario: No sitemap submitted

- **WHEN** a property has no submitted sitemap
- **THEN** no page is inspected, and the report says a sitemap needs submitting
  in Search Console

#### Scenario: Sitemap unreachable

- **WHEN** the client's sitemap file cannot be fetched
- **THEN** the site's indexing pass fails with a fixed reason, and earlier
  results are kept

### Requirement: What the search pull stores

For each site, engine and day the system SHALL store clicks, impressions and
position as the engine reports them: in total, by device where the engine
reports devices, and for up to 1,000 queries and 1,000 pages by impressions.
Position SHALL be stored so that it can be averaged correctly across days and
rows, weighted by impressions. Days SHALL be stored as each engine reports them,
and the report SHALL say which timezone that is. The system SHALL store
aggregates only: a query is stored as the engine returns it, and the system
SHALL NOT attempt to recover queries an engine withholds.

#### Scenario: Averaging position

- **WHEN** a page had 100 impressions at position 2 on one day and 300 at
  position 6 the next
- **THEN** its average position over the two days reads 5, not 4

#### Scenario: Long values

- **WHEN** a query or page address is longer than 200 characters
- **THEN** it is stored cut to 200 characters

#### Scenario: A day with no impressions

- **WHEN** an engine reports nothing for a site on a day after the first day it
  has data for
- **THEN** the day's totals are stored as zero, so a missing day means "not
  pulled" rather than "no search traffic"

#### Scenario: Before an engine's data begins

- **WHEN** a replacement site's backfill finds Bing data only from 3 March 2026
- **THEN** nothing is stored for Bing before 3 March 2026, and the report says
  Bing's history begins on that date rather than showing zero clicks before it

### Requirement: Brand terms

A user SHALL be able to record, per site, a list of brand terms of up to 20
entries of up to 50 characters each, which apply to both engines. A query SHALL
count as branded when it contains any brand term, ignoring case. The terms SHALL
apply to stored data as well as future data.

#### Scenario: Branded query

- **WHEN** the brand terms are `luxury gardens` and `lgd`, and a query is
  `luxury gardens kent`
- **THEN** its clicks count as branded

#### Scenario: Terms changed later

- **WHEN** a user adds a brand term after a month of data has been stored
- **THEN** the report's branded and non-branded split recalculates over the
  whole month

### Requirement: The search report on the client page

For each site with a readable property on either engine, the client page SHALL
show, for the last 28 full days against the 28 before:

- clicks, impressions, click-through rate and average position, for Google,
  for Bing and for both together
- branded and non-branded clicks when brand terms are set, with the share of
  total clicks that the split covers
- the top queries and top pages by clicks
- organic search clicks beside PostHog's organic search page views and
  enquiries with channel `organic_search`
- how many of the sitemap's pages Google has indexed, and the pages it has not,
  with Google's reason

When an engine has no data yet, the report SHALL say why: not configured, not
recorded, not checked, no access, or waiting for the first nightly run. It SHALL
NOT show a zero where the truth is "not pulled".

#### Scenario: A site with data

- **WHEN** a user opens a client whose site has two months of data from both
  engines
- **THEN** the page shows the headline figures per engine and combined, with the
  change against the previous 28 days, and the top queries and pages

#### Scenario: Partial coverage

- **WHEN** the query rows account for 320 of a period's 500 clicks
- **THEN** the branded split is labelled as based on 64% of clicks

#### Scenario: Awaiting the first pull

- **WHEN** a property passed its check today and the nightly run has not yet
  happened
- **THEN** the report says data arrives after the next nightly run, and shows no
  figures for that engine

#### Scenario: Narrow screen

- **WHEN** the client page is viewed 375px wide
- **THEN** the headline figures sit two to a row, and each top list shows its
  first 10 rows with the query or page, clicks and impressions, with no
  horizontal scrolling of the page
