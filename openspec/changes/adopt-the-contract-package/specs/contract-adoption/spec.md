## Purpose

How the analytics app reads the Open Waters event contract from the shared
package, decides which events each site is expected to send, and stores the
metrics that the v2 and v3 events add.

## ADDED Requirements

### Requirement: One source for the contract

The app SHALL read event lists, taxonomy versions and the channel
classification only from `@open-waters-digital/analytics/contract`. No event
list SHALL be defined in this repository.

#### Scenario: A new taxonomy version released

- **WHEN** the package is updated to a release that adds taxonomy version 4
- **THEN** a site can be registered at version 4 with no change to this app's
  event list code

### Requirement: Versions 1 to 3 are known

A site SHALL be registrable at taxonomy version 1, 2 or 3. Registering a site
at a version the package does not contain SHALL be a field error.

#### Scenario: An unknown version

- **WHEN** a partner saves a site at taxonomy version 9
- **THEN** the form shows a field error on the version, and nothing is saved

### Requirement: Expected events follow the consent banner

When a site is created or its version is adopted, its expected events SHALL
default to every event in its version's list. `consent_updated` SHALL be
included only when the site is marked as having a consent banner. Marking or
unmarking the banner SHALL add or remove `consent_updated` from its expected
events, and change nothing else.

#### Scenario: A v2 site without a banner

- **WHEN** a site is created at version 2 with no consent banner
- **THEN** its expected events are the v2 list without `consent_updated`

#### Scenario: A banner added later

- **WHEN** a partner marks an existing v2 site as having a consent banner
- **THEN** `consent_updated` is added to its expected events, and any events
  removed by hand earlier stay removed

### Requirement: Metrics for consent and channel

The nightly snapshot SHALL store:

- `consent_updated` by `advertising`
- page views by `ad_consent`
- `lead_submitted` by `channel`
- `lead_submitted` by `heard_about`

A lead with no `channel` property SHALL be stored under `(not recorded)`. So
SHALL a lead with no `heard_about` from a site below version 3. A v3 lead with
an empty `heard_about` SHALL be stored under `(none)`.

#### Scenario: Leads from a v2 site

- **WHEN** a v2 site sends three `lead_submitted` events in a day
- **THEN** `leads_by_channel` for that day holds 3 under `(not recorded)`

#### Scenario: Leads from a v3 site

- **WHEN** a v3 site sends two leads with `channel: "paid_social"` and one with
  `channel: "unknown"`
- **THEN** `leads_by_channel` holds 2 under `paid_social` and 1 under `unknown`

### Requirement: Every listed event has a metric

A test SHALL fail when any event in any known taxonomy version has no snapshot
metric counting it.

#### Scenario: An event without a metric

- **WHEN** the package adds an event that this app has no metric for
- **THEN** this app's test suite fails, naming the event, on the Renovate pull
  request that brings the release
