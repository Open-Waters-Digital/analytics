## Purpose

Bringing a client's PostHog project to the settings and the baseline dashboard
the Open Waters contract requires, checking later that it still matches, and
recording each check, without the app ever holding a write-capable key.

## ADDED Requirements

### Requirement: Check reports every difference and changes nothing

A signed-in partner SHALL be able to check a site's PostHog project. The check
SHALL list each required setting and baseline insight that differs from the
project, with its current and required value, and SHALL make no write.

The required settings are:

- cookieless server hash mode on
- the site's timezone
- client IP data discarded
- session recording off
- heatmaps matching the site's `uses_heatmaps` flag: off unless the site is
  marked as using aggregate heatmaps
- the authorised URLs equal to the site's production origin
- no internal-traffic filter matching the production host

#### Scenario: A site that uses heatmaps

- **WHEN** a partner checks the project of a site marked `uses_heatmaps`
  whose heatmaps setting is off
- **THEN** heatmaps are listed as a difference with "on" as the required
  value, and applying turns them on and changes nothing else

#### Scenario: A fresh project

- **WHEN** a partner checks a project created with PostHog's defaults
- **THEN** cookieless mode, IP discarding, the timezone, the authorised URL and
  every baseline insight are listed as differences, and PostHog receives only
  read requests

#### Scenario: A filter that hides everything

- **WHEN** the project's internal-traffic filter excludes the production host
- **THEN** the check lists it as a difference, explaining that it hides every
  event

### Requirement: Apply converges, and a second run changes nothing

Applying SHALL make each listed change, then run the check again and show its
result. Applying to a project with no differences SHALL make no write, and SHALL
report that there was nothing to change. Baseline insights SHALL be matched by
their stable key and updated in place. Insights without a baseline key SHALL be
left untouched.

#### Scenario: Two applies in a row

- **WHEN** a partner applies to a fresh project, then applies again
- **THEN** the second run reports nothing to change and sends no write request

#### Scenario: A partner's own insight

- **WHEN** the dashboard carries an insight a partner added by hand
- **THEN** applying neither changes nor removes it

#### Scenario: A newer taxonomy version

- **WHEN** a site's taxonomy version is raised from 2 to 3 and the project is
  checked
- **THEN** the two v3 insights are listed as missing, and applying adds them
  without duplicating the existing ones

### Requirement: The key is used once

The write-capable key SHALL be supplied by the partner for each check or apply,
and SHALL NOT be stored, logged, included in an error, or sent back to the
browser. A rejected key SHALL produce a fixed message naming the scopes
required.

#### Scenario: A key without dashboard access

- **WHEN** a partner applies using a key that lacks dashboard write access
- **THEN** the run stops with a message listing the required scopes, and the
  key appears in no log line and no stored row

#### Scenario: Signed out

- **WHEN** the check or apply action is called without a session
- **THEN** it is rejected before any request to PostHog

### Requirement: Failures are bounded and honest

Every request to PostHog SHALL time out after 10 seconds. A failure SHALL stop
the run, and SHALL show a fixed message and what had already been applied. The
next check SHALL list exactly what remains.

#### Scenario: PostHog times out mid-apply

- **WHEN** the dashboard request times out after the settings were written
- **THEN** the partner is told the settings were applied and the dashboard was
  not, and a check lists only the dashboard insights

### Requirement: Each run is recorded

Every check and apply SHALL be recorded with:

- the site, the partner and the time
- whether it was a check or an apply
- the number of differences found
- the outcome
- the taxonomy version it used

The record SHALL hold no setting values and no key. The site's panel SHALL show
the latest run.

#### Scenario: Reading the last check

- **WHEN** a partner opens a client page after a check last month
- **THEN** the panel shows when it ran, who ran it, and whether the project
  matched

### Requirement: Manual steps stay visible

For the steps provisioning does not perform, the panel SHALL list them and link
to the skill's setup order:

- the organisation
- billing
- the data processing agreement
- the proxy DNS record
- the Query Read key

Where the key can read it, the panel SHALL report whether the managed proxy for
the site's domain is live.

#### Scenario: Proxy not yet live

- **WHEN** the site's domain has no live managed proxy record
- **THEN** the panel says so, and does not count it as a difference to apply
