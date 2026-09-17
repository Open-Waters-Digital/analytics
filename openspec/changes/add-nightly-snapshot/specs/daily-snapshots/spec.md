# Spec Delta

## Purpose

Turns each client site's day of behaviour into aggregate rows Open Waters owns,
every night, so reports and trends read from this app rather than from each
client's PostHog project.

## ADDED Requirements

### Requirement: A nightly pull for every connected site

Once a day the system SHALL pull the previous day's aggregate numbers from
PostHog for every site that has a PostHog connection whose last check succeeded
and whose client's status is `onboarding`, `active` or `paused`. It SHALL skip
sites with no connection, sites whose client is `offboarded`, and sites whose
connection last failed.

#### Scenario: Connected site

- **WHEN** the nightly job runs and a site has a working connection
- **THEN** the day's metrics for that site are stored

#### Scenario: Client-owned analytics

- **WHEN** a site's client has client-owned analytics and no connection
- **THEN** the site is skipped and recorded as skipped, not as a failure

#### Scenario: Offboarded client

- **WHEN** a client is offboarded
- **THEN** none of its sites are pulled

#### Scenario: Connection previously rejected

- **WHEN** a site's connection last check was `unauthorised`
- **THEN** the site is skipped with that reason, and no PostHog query is made

### Requirement: What is collected

For each site and day, the system SHALL store counts for the metrics of the
Attention, Intent, Action and Revenue stages, each with the dimension the event
list defines (for example `cta_clicked` by `cta_id`, `lead_submitted` by
`lead_type`, sessions by channel). It SHALL store **aggregate counts only**, and
SHALL NOT store identifiers, visitor-level rows, URLs with query strings
carrying personal data, or anything from a form's contents.

#### Scenario: A day of activity

- **WHEN** a site had 40 page views, 12 CTA clicks on two different CTAs and 1
  lead on a given day
- **THEN** the stored rows show page views 40, `cta_clicked` split by the two
  `cta_id` values, and `lead_submitted` 1 for its `lead_type`

#### Scenario: A quiet day

- **WHEN** a site had no activity on a day
- **THEN** the day is recorded as pulled with zero counts, not left missing, so
  a gap always means "not pulled"

#### Scenario: No visitor data

- **WHEN** any day's metrics are stored
- **THEN** no stored row contains a distinct id, session id, IP address or email
  address

#### Scenario: A page address carrying a query string

- **WHEN** a landing page is recorded
- **THEN** only its path is stored, without the query string or fragment

#### Scenario: A breakdown with very many values

- **WHEN** a site produces more distinct values for one breakdown in a day than
  the stored limit
- **THEN** the largest are kept, the rest are dropped, and the screen showing
  that breakdown says the list is capped

### Requirement: The first pull covers a longer window

When a site has no stored metrics at all, its first pull SHALL cover at least
the previous 30 days, so a newly connected site is worth looking at the morning
after it is connected.

#### Scenario: Newly connected site

- **WHEN** a site is pulled for the first time and its project has 30 days of
  events
- **THEN** 30 days of metrics are stored, not one

#### Scenario: Site already pulled

- **WHEN** a site already has stored metrics
- **THEN** the run pulls only the recent window

### Requirement: Late events are corrected

Each run SHALL re-pull a recent window of at least seven days and replace the
stored values for those days, so events that arrive late, or days missed while a
connection was broken, are corrected without manual work.

#### Scenario: Missed night

- **WHEN** a site's connection was broken on Monday and fixed on Tuesday
- **THEN** Tuesday's run stores Monday's numbers as well

#### Scenario: Re-running the same day

- **WHEN** the job runs twice for the same day
- **THEN** the stored values are replaced, not doubled

### Requirement: One site's failure does not stop the rest

The system SHALL pull each site independently. A failure for one site SHALL be
recorded with its reason and SHALL NOT prevent other sites being pulled. A pull
that cannot complete SHALL leave the previously stored values untouched.

#### Scenario: One site's key revoked

- **WHEN** one site's PostHog key has been revoked and three others work
- **THEN** the three others are stored, the failing site is recorded as failed
  with "key rejected", and its connection status is updated

#### Scenario: PostHog unreachable

- **WHEN** PostHog does not respond for a site
- **THEN** that site is recorded as failed and its existing stored days are
  unchanged

### Requirement: Every run is recorded

The system SHALL record each run: when it started and finished, and how many
sites succeeded, failed and were skipped, with the reason per site.

#### Scenario: After a run

- **WHEN** a run finishes
- **THEN** its start, finish and per-site outcomes can be read back

#### Scenario: The job never ran

- **WHEN** no run has happened for more than 48 hours
- **THEN** that is visible in the app rather than silently absent

### Requirement: The app shows what was collected

The client page SHALL show, per site, when the snapshot last ran, whether it
succeeded, and the last seven days of headline numbers (page views, sessions,
leads).

#### Scenario: Site with data

- **WHEN** a user views a client with a connected site that has been pulled
- **THEN** the page shows the last run time and the last seven days of headline
  numbers

#### Scenario: Site never pulled

- **WHEN** a connected site has never been pulled
- **THEN** the page says so plainly rather than showing zeroes

### Requirement: Secrets stay out of the job's output

The job SHALL NOT write API keys, decrypted values or query parameters to its
logs, and SHALL identify sites by slug and id only.

#### Scenario: Failure log

- **WHEN** a site fails because PostHog rejected its key
- **THEN** the log names the site slug and the reason, and contains no key
