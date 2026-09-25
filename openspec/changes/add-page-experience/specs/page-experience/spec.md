# Spec Delta

## Purpose

Measures how fast and stable each client site is, for real Chrome visitors and
in a lab run, so a slowdown shows in the report before it shows in the site's
rankings.

## ADDED Requirements

### Requirement: One API key for page experience

The system SHALL read the Chrome UX Report and PageSpeed Insights with one Open
Waters API key. An unset key SHALL mean page experience is not configured: no
pull or lab run is attempted and the client page says so. The key SHALL NOT
appear in any log line, error message or stored URL.

#### Scenario: Not configured

- **WHEN** the key is unset
- **THEN** every client page's Page experience section says it is not
  configured, and the nightly run records each site's page experience pull as
  skipped with that reason

#### Scenario: Key rejected

- **WHEN** Google rejects the key
- **THEN** every site's pull fails with a configuration reason, and the log
  names the variable and never its value

### Requirement: Tracked pages

Each site SHALL track its home page, and a user SHALL be able to add up to nine
more paths. A path SHALL start with `/`, SHALL carry no query string or
fragment, and SHALL be unique for the site.

#### Scenario: Default

- **WHEN** a site is created
- **THEN** it tracks `/` and nothing else

#### Scenario: Too many

- **WHEN** a user adds an eleventh path
- **THEN** nothing is stored and the field says the limit is ten

#### Scenario: Query string

- **WHEN** a user enters `/contact?ref=footer`
- **THEN** nothing is stored and the field explains that paths carry no query
  string

### Requirement: Performance budget

A user SHALL be able to set, per site, optional targets for LCP in milliseconds,
INP in milliseconds, CLS, and the lab performance score. Each metric without a
target SHALL be judged against Google's "good" threshold: LCP at most 2,500 ms,
INP at most 200 ms, CLS at most 0.1, and a lab score of at least 90.

#### Scenario: Budget stricter than Google

- **WHEN** a site's LCP target is 2,000 ms and its field LCP is 2,300 ms
- **THEN** LCP shows as failing its budget, even though Google rates it good

#### Scenario: No budget

- **WHEN** a site has no targets and its field INP is 180 ms
- **THEN** INP shows as passing against Google's threshold

### Requirement: Field data every night

Once a day, as part of the nightly run, the system SHALL pull Chrome UX Report
field data for every site whose client is `onboarding`, `active` or `paused`,
for the site's origin and for each tracked page, for phones and for desktops. It
SHALL store the 75th percentile of LCP, INP, CLS, FCP and TTFB, and for each the
share of visits rated good, needs improvement and poor. When Chrome has too
little traffic to report for an origin, page or form factor, the system SHALL
record that as "not enough data", distinct from a failure. On the first pull of
a site marked as replacing an existing site, it SHALL also store the Chrome UX
Report's weekly history, and the report SHALL label figures from before the
launch date "Previous site". For a site not so marked it SHALL NOT fetch
history.

#### Scenario: A site with traffic

- **WHEN** the nightly run reaches a site Chrome has enough visitors for
- **THEN** that day's field values are stored for its origin and each tracked
  page with data, for both form factors

#### Scenario: A small site

- **WHEN** Chrome has too few visitors for a site's origin
- **THEN** the run records "not enough data" for it, the site's result is ok,
  and the report says so rather than showing a failure

#### Scenario: First pull of a replacement site

- **WHEN** a site marked as replacing an existing site is pulled for the first
  time and Chrome holds history for its origin
- **THEN** its weekly history is stored as well, labelled "Previous site" before
  the launch date

#### Scenario: First pull of a new site

- **WHEN** a site not marked as replacing an existing site is pulled for the
  first time
- **THEN** no history is requested

### Requirement: Lab runs weekly and on demand

The system SHALL run PageSpeed Insights on a phone for each tracked page once a
week, and SHALL store the performance score and the lab LCP, CLS, TBT, FCP and
Speed Index. A user SHALL be able to start a run for one site from the client
page. Only one run per site SHALL be in progress at a time.

#### Scenario: Weekly run

- **WHEN** the nightly run happens on a Monday
- **THEN** each active site's tracked pages are run once and their results
  stored

#### Scenario: Run now

- **WHEN** a signed-in user presses Run now for a site
- **THEN** its tracked pages are run and the section shows the new results when
  they arrive

#### Scenario: Run already in progress

- **WHEN** a user presses Run now while that site's run is in progress
- **THEN** no second run starts and the button says one is in progress

#### Scenario: Unauthenticated run

- **WHEN** a request to start a run arrives without a session
- **THEN** it is rejected and no call is made to Google

#### Scenario: A page that fails to load

- **WHEN** PageSpeed Insights cannot load one tracked page
- **THEN** that page's result is recorded as failed with a fixed reason, and the
  other pages' results are stored

### Requirement: The Page experience report

For each site, the client page SHALL show:

- a Core Web Vitals verdict for phones and one for desktops, passing only when
  LCP, INP and CLS all pass, from field data where there is enough of it
- each field metric's latest value, its verdict against the budget or Google's
  threshold, and its value for each of the last three months
- the latest lab result per tracked page, with its date
- that field data is a rolling 28 days, so a fix takes up to four weeks to show
  in full

Where there is not enough field data, the verdict SHALL say so and point to the
lab results. The report SHALL NOT show a verdict it has no data for.

#### Scenario: Passing site

- **WHEN** a site's phone field data has LCP 1,900 ms, INP 120 ms and CLS 0.02,
  and it has no budget
- **THEN** the phone verdict reads passing, with each metric marked good

#### Scenario: Not enough Chrome traffic

- **WHEN** a site has lab results but Chrome has too few visitors to report
- **THEN** both verdicts read "Not enough Chrome traffic to report yet" and the
  lab results are shown

#### Scenario: Narrow screen

- **WHEN** the client page is viewed 375px wide
- **THEN** the two verdicts stack, each metric is one row of name, value and
  verdict, the lab table shows the page and its score, and the page does not
  scroll sideways
