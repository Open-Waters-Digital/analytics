# Spec Delta

## Purpose

Records who Open Waters works for and what they run: clients, their sites, who
receives their reports, which events each site should send, the figures that
turn activity into money, and a dated log of what changed.

## ADDED Requirements

### Requirement: Create a client

A signed-in user SHALL be able to create a client with a name, a slug, an
analytics ownership (`open_waters` or `client_owned`) and a regulated flag. The
slug SHALL be 2–40 characters of lowercase letters, digits and single hyphens,
starting with a letter, and unique across all clients. A new client's status
SHALL be `onboarding`.

#### Scenario: Valid client

- **WHEN** a user creates a client named "Radara Health" with slug `radara`,
  ownership `open_waters` and regulated ticked
- **THEN** the client is saved with status `onboarding` and the user lands on
  its detail page

#### Scenario: Duplicate slug

- **WHEN** a user creates a client with a slug that already exists
- **THEN** nothing is saved and the slug field says the slug is already in use

#### Scenario: Invalid slug

- **WHEN** a user enters `Radara Health` or `-radara` or `radara--health` as a
  slug
- **THEN** nothing is saved and the slug field explains the allowed format

#### Scenario: Missing name

- **WHEN** a user submits without a name
- **THEN** nothing is saved and the name field shows an error, with the other
  entered values kept in the form

### Requirement: Edit a client

A user SHALL be able to change a client's name, status, analytics ownership and
regulated flag. The slug SHALL NOT be editable after creation. Status SHALL be
one of `onboarding`, `active`, `paused` or `offboarded`, and any status can move
to any other.

#### Scenario: Change status

- **WHEN** a user changes a client's status from `onboarding` to `active`
- **THEN** the new status is saved and shown on the list and detail pages

#### Scenario: Attempt to change slug

- **WHEN** an edit request includes a different slug
- **THEN** the slug is unchanged

### Requirement: Clients are never hard deleted

The system SHALL NOT offer a way to delete a client. Ending a relationship SHALL
be recorded by setting status to `offboarded`, which keeps the client's sites,
log and history.

#### Scenario: Offboard

- **WHEN** a user sets a client to `offboarded`
- **THEN** the client and everything recorded against it remain viewable

### Requirement: List clients

The clients list SHALL show every client that is not offboarded, sorted by
name, with its status, analytics ownership, number of sites and a connection
summary (how many sites have a working PostHog connection out of how many
sites). The user SHALL be able to include offboarded clients.

#### Scenario: Default list

- **WHEN** a user opens the clients list
- **THEN** offboarded clients are hidden and the rest appear alphabetically
  with their status, ownership, site count and connection summary

#### Scenario: Show offboarded

- **WHEN** the user chooses to include offboarded clients
- **THEN** offboarded clients also appear, visibly marked

#### Scenario: No clients yet

- **WHEN** there are no clients
- **THEN** the list explains that no clients exist and links to create one

### Requirement: Sites

A user SHALL be able to add, edit and remove sites for a client. A site SHALL
have a production URL (`https`, no path beyond `/`, unique across all sites), a
framework (`astro`, `next` or `other`), an optional repository, an optional
launch date, an event list version (defaulting to the current version) and an
IANA timezone (defaulting to `Europe/London`). Removing a site SHALL also remove
its connections, expected events, commercial context and learning log, and
SHALL require an explicit confirmation.

#### Scenario: Add a site

- **WHEN** a user adds `https://radarahealth.com` as an Astro site for Radara
- **THEN** the site appears on the client's detail page with timezone
  `Europe/London` and the current event list version

#### Scenario: URL not https or already used

- **WHEN** a user enters `http://radarahealth.com`, or a URL another site
  already uses
- **THEN** nothing is saved and the URL field explains why

#### Scenario: Invalid timezone

- **WHEN** a user enters `London` as the timezone
- **THEN** nothing is saved and the field asks for an IANA name such as
  `Europe/London`

#### Scenario: Remove a site without confirming

- **WHEN** a remove request arrives without the confirmation
- **THEN** nothing is removed

### Requirement: Report recipients

A user SHALL be able to add and remove report recipients for a client, each with
a name and a valid email address. The same address SHALL NOT appear twice for
one client.

#### Scenario: Add a recipient

- **WHEN** a user adds "Jane Smith, jane@radarahealth.com" to Radara
- **THEN** she appears in the client's recipients

#### Scenario: Duplicate recipient

- **WHEN** a user adds an address already listed for that client, in any letter
  case
- **THEN** nothing is saved and the form says the address is already a
  recipient

### Requirement: Expected events

Each site SHALL have a set of expected events chosen from the event list for
the site's event list version. A new site SHALL expect every event on that
list. A user SHALL be able to untick events a site does not send and tick them
again. Names not on the event list SHALL be rejected.

#### Scenario: Defaults for a new site

- **WHEN** a site is added with event list version 1
- **THEN** every version 1 event is expected

#### Scenario: Site without downloads

- **WHEN** a user unticks `file_downloaded` for Radara's site and saves
- **THEN** `file_downloaded` is no longer expected for that site and every other
  event still is

#### Scenario: Unknown event name

- **WHEN** a save request includes an event name that is not on the event list
- **THEN** nothing is saved and an error is returned

### Requirement: Commercial context

Each site SHALL have optional commercial context: an average lead value (a
non-negative amount in GBP, EUR or USD, stored in minor units), a
lead-to-customer rate (between 0 and 1 inclusive) and a source for the figures
(`client_confirmed` or `open_waters_estimate`). A source SHALL be required once
either figure is entered.

#### Scenario: Estimated figures

- **WHEN** a user enters an average lead value of £2,500, a rate of 0.2 and
  source `open_waters_estimate`
- **THEN** the site stores 250000 GBP minor units, 0.2 and the source, and
  displays "£2,500 (Open Waters estimate)"

#### Scenario: Figure without a source

- **WHEN** a user enters a lead value but no source
- **THEN** nothing is saved and the source field is required

#### Scenario: Out-of-range rate

- **WHEN** a user enters a rate of 1.5 or -0.1
- **THEN** nothing is saved and the rate field explains the range

### Requirement: Learning log

A user SHALL be able to add, edit and delete learning log entries for a site.
An entry SHALL have a date, a kind (`launch`, `design`, `content`, `campaign`,
`experiment` or `tracking`), a title of at most 120 characters, and optional
detail and expected effect. Entries SHALL be listed newest date first.

#### Scenario: Add an entry

- **WHEN** a user logs "New hero proposition on Report page", kind `content`,
  dated 2026-10-03, expected effect "More Report CTA clicks"
- **THEN** the entry appears at the top of the site's log if it is the newest

#### Scenario: Title too long

- **WHEN** a user enters a title longer than 120 characters
- **THEN** nothing is saved and the title field shows the limit

### Requirement: Registry changes are atomic and validated on the server

Every registry change SHALL be validated on the server regardless of what the
browser sent, and SHALL either apply completely or not at all. Every registry
read and write SHALL require a signed-in session.

#### Scenario: Browser validation bypassed

- **WHEN** a request is sent directly to a registry action with invalid data
- **THEN** the server rejects it with field errors and nothing is written

#### Scenario: Failure part way through

- **WHEN** adding a site succeeds but creating its default expected events fails
- **THEN** the site is not saved either

#### Scenario: Signed out

- **WHEN** a registry action or page is requested without a session
- **THEN** it is rejected as described in `access-control`
