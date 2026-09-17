# Spec Delta

## Purpose

Stores and verifies access to each site's external data sources, starting with
PostHog, so later pulls can rely on a connection that is known to work and
client API keys stay protected.

## ADDED Requirements

### Requirement: Add a PostHog connection

A user SHALL be able to add one PostHog connection per site with a region (`eu`
or `us`), a project ID (a positive whole number) and an API key. Before storing
anything, the system SHALL run a check against PostHog with those details, and
SHALL store the connection only if the check succeeds.

#### Scenario: Working key

- **WHEN** a user enters region `eu`, a valid project ID and a key with Query
  Read access to that project
- **THEN** the check succeeds, the connection is stored with status `ok` and the
  check time, and the site shows "Connected"

#### Scenario: Rejected key

- **WHEN** PostHog rejects the key as unauthorised or forbidden
- **THEN** nothing is stored and the form says the key was rejected and to check
  it has Query Read access to this project

#### Scenario: Wrong project

- **WHEN** PostHog reports the project does not exist for this key
- **THEN** nothing is stored and the form says the project was not found in that
  region

#### Scenario: PostHog does not respond

- **WHEN** PostHog has not responded after 10 seconds, or returns a server error
- **THEN** nothing is stored and the form says PostHog could not be reached and
  to try again

#### Scenario: Site already connected

- **WHEN** a user adds a PostHog connection to a site that already has one
- **THEN** the request is treated as replacing the key (see below)

### Requirement: Replace a PostHog key

A user SHALL be able to replace a site's PostHog key, region or project ID. The
new details SHALL be checked first. If the check fails, the existing connection
SHALL remain unchanged.

#### Scenario: Replacement fails its check

- **WHEN** a user submits a new key that PostHog rejects
- **THEN** the old key, status and last check are unchanged and the form shows
  the rejection

### Requirement: Remove a PostHog connection

A user SHALL be able to remove a site's PostHog connection after an explicit
confirmation. Removal SHALL delete the stored key.

#### Scenario: Remove

- **WHEN** a user confirms removal
- **THEN** the stored key is gone and the site shows "Not connected"

### Requirement: API keys are protected

The system SHALL encrypt every PostHog API key before storing it and SHALL NOT
store it in plain text anywhere. After saving, the system SHALL show only the
key's last four characters. A key SHALL NOT be included in any page, response
to the browser, error message or log line.

#### Scenario: Viewing a connection

- **WHEN** a user views a connected site
- **THEN** the key is shown as its last four characters only, e.g. `•••• a1b2`

#### Scenario: Database read

- **WHEN** someone reads the connections table directly
- **THEN** the key column contains ciphertext, not the key

#### Scenario: Ciphertext moved to another connection

- **WHEN** the stored ciphertext from one connection is copied onto another
  connection's row
- **THEN** decryption fails for that row instead of yielding the first
  connection's key

#### Scenario: Stored key cannot be decrypted

- **WHEN** a stored key cannot be decrypted (for example the master key changed)
- **THEN** a check on that connection records status `error` with the message
  "Stored key cannot be read. Enter the key again." and nothing is sent to
  PostHog

### Requirement: Test a connection on demand

A user SHALL be able to re-run the check for a stored PostHog connection. Every
check SHALL record its time, a status (`ok`, `unauthorised`,
`project_not_found` or `error`) and, when not `ok`, a short explanation.

#### Scenario: Key revoked in PostHog

- **WHEN** a user tests a connection whose key has since been revoked
- **THEN** the status becomes `unauthorised` with the check time, and the site
  shows the problem in text as well as colour

#### Scenario: Recovery

- **WHEN** a later test on the same connection succeeds
- **THEN** the status returns to `ok` and the previous explanation is cleared

### Requirement: Checks read no visitor data

A check SHALL be a read-only aggregate query that confirms access, and SHALL NOT
store anything returned by PostHog other than the check result.

#### Scenario: What is stored after a check

- **WHEN** a check succeeds
- **THEN** only the status, time and project reference are stored

### Requirement: Connections reflect analytics ownership

A site whose client has `client_owned` analytics SHALL NOT require a PostHog
connection, and SHALL show that its analytics are client-owned rather than a
connection problem.

#### Scenario: Agency Tap's site

- **WHEN** a user views a site belonging to a `client_owned` client with no
  connection
- **THEN** it shows "Client-owned analytics" rather than "Not connected"

### Requirement: Search Console property

A user SHALL be able to record one Search Console property per site, either a
domain property (`sc-domain:` followed by a hostname) or a URL-prefix property
(an `https` URL ending in `/`). The property SHALL be shown as "Not checked"
until a later change adds the check.

#### Scenario: Domain property

- **WHEN** a user enters `sc-domain:radarahealth.com`
- **THEN** it is stored and shown as "Not checked"

#### Scenario: Invalid property

- **WHEN** a user enters `radarahealth.com`
- **THEN** nothing is stored and the field explains both accepted formats
