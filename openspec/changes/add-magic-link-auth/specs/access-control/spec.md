# Spec Delta

## Purpose

Controls who can use Open Waters Analytics: passwordless sign-in for an
allowlisted set of email addresses, and a session required for everything else.

## ADDED Requirements

### Requirement: Only allowlisted addresses can sign in

The system SHALL send a sign-in link only to email addresses on the configured
allowlist. Matching SHALL ignore letter case and surrounding whitespace. The
system SHALL NOT create an account for any address that is not on the
allowlist, by any route.

#### Scenario: Allowlisted address requests a link

- **WHEN** someone submits an address that is on the allowlist
- **THEN** a single-use sign-in link is emailed to that address
- **AND** the person sees a "check your email" confirmation

#### Scenario: Address not on the allowlist requests a link

- **WHEN** someone submits an address that is not on the allowlist
- **THEN** no email is sent and no account is created
- **AND** the person sees the same "check your email" confirmation as an
  allowlisted address, so the response does not reveal who has access

#### Scenario: Address differs only in case

- **WHEN** the allowlist contains `alex@openwaters.digital` and someone submits
  `Alex@OpenWaters.digital`
- **THEN** it is treated as the allowlisted address

#### Scenario: Invalid email format

- **WHEN** someone submits text that is not an email address
- **THEN** the form shows a field error and nothing is sent

### Requirement: Sign-in links are single use and short lived

A sign-in link SHALL expire 15 minutes after it is issued and SHALL work at most
once. A used, expired or tampered link SHALL NOT create a session.

#### Scenario: Valid link

- **WHEN** an allowlisted person opens their link within 15 minutes
- **THEN** they are signed in and taken to the page they originally asked for,
  or the home page if there was none

#### Scenario: Link used twice

- **WHEN** a link that has already signed someone in is opened again
- **THEN** no session is created and the person is shown the sign-in page with a
  message that the link has already been used or has expired

#### Scenario: Expired link

- **WHEN** a link is opened more than 15 minutes after it was issued
- **THEN** no session is created and the same message is shown

#### Scenario: Redirect target outside the app

- **WHEN** a sign-in request asks to return to a URL on another origin
- **THEN** the person is taken to the home page instead

### Requirement: Link requests are rate limited

The system SHALL limit sign-in link requests so that one client cannot trigger
more than 5 requests in 10 minutes.

#### Scenario: Too many requests

- **WHEN** the same client requests a sixth link within 10 minutes
- **THEN** no email is sent and the form says to wait before trying again

### Requirement: Everything except sign-in requires a session

Every page, server action and data read SHALL require a valid session, except
the sign-in pages, the authentication endpoints and the health check. The check
SHALL be enforced where data is read and written, not only when a page is
requested.

#### Scenario: Signed-out visit to a page

- **WHEN** someone without a session requests any protected page, including
  `/design-system`
- **THEN** they are redirected to `/sign-in`, and after signing in they return
  to that page

#### Scenario: Signed-out call to a server action

- **WHEN** a server action is invoked without a valid session
- **THEN** it performs no read or write and returns an unauthorised error

#### Scenario: Health check without a session

- **WHEN** `/api/health` is requested without a session
- **THEN** it responds 200

#### Scenario: Session cannot be verified

- **WHEN** the session store is unreachable while checking a request
- **THEN** the request is treated as signed out and rejected

### Requirement: Removing an address revokes access

A session SHALL grant access only while its user's email address is still on
the allowlist.

#### Scenario: Address removed while signed in

- **WHEN** a signed-in person's address is removed from the allowlist and they
  make another request
- **THEN** the request is rejected as signed out

### Requirement: Sessions and sign-out

A session SHALL last 30 days from its last use. Signing out SHALL end the
session on the server, not only in the browser.

#### Scenario: Sign out

- **WHEN** a signed-in person chooses Sign out
- **THEN** their session is deleted, they land on `/sign-in`, and the old
  session cookie no longer grants access if replayed

#### Scenario: Idle for more than 30 days

- **WHEN** a session has not been used for 30 days
- **THEN** the next request is treated as signed out

### Requirement: Session cookies are protected

The session cookie SHALL be `HttpOnly`, `SameSite=Lax`, and `Secure` in
production.

#### Scenario: Cookie flags in production

- **WHEN** a person signs in on the production site
- **THEN** the session cookie is set with `HttpOnly`, `Secure` and
  `SameSite=Lax`

### Requirement: Sign-in secrets are never exposed

Sign-in tokens, links, session tokens and email addresses SHALL NOT be written
to application logs in production.

#### Scenario: Link sent in production

- **WHEN** a sign-in link is emailed in production
- **THEN** the logs record only that a link was sent, without the address or the
  link

#### Scenario: Local development without an email key

- **WHEN** the app runs in development with no Resend API key configured
- **THEN** the sign-in link for an allowlisted address is printed to the local
  terminal instead of being emailed
- **AND** this fallback is impossible when the app runs in production
