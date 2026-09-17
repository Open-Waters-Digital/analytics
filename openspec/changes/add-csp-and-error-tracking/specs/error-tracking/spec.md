# Spec Delta

## Purpose

Makes sure Open Waters hears about failures in Open Waters Analytics quickly and
with enough context to fix them, without sending secrets or personal data to the
error tracker.

## ADDED Requirements

### Requirement: Production errors are reported

In production, the system SHALL report to the Open Waters PostHog project:

- errors thrown and not handled while rendering a page or running a route
  handler or server action;
- errors thrown and not handled in the browser, including those that reach the
  app's error boundary;
- unexpected failures that a registry action catches and turns into a
  "Something went wrong" message.

Each report SHALL include a stack trace that resolves to the original source
files, the release (the deployed commit) and the environment.

#### Scenario: Server error

- **WHEN** a server action throws an error that is not a validation problem
- **THEN** the user sees the existing failure message and an exception appears
  in PostHog with a stack trace pointing at the source file and line

#### Scenario: Browser error

- **WHEN** a script error happens in a signed-in page in the browser
- **THEN** an exception appears in PostHog with a readable stack trace

#### Scenario: Expected outcomes are not errors

- **WHEN** a request is signed out, a form has validation errors, or PostHog
  rejects a client's API key during a connection check
- **THEN** nothing is reported as an error

### Requirement: Only production reports

Development and test runs SHALL NOT send error reports.

#### Scenario: Local development

- **WHEN** an error happens under `next dev` or in the test suite
- **THEN** nothing is sent to PostHog

### Requirement: Reports contain no secrets or personal data

An error report SHALL NOT contain email addresses, API keys, ciphertext, session
tokens, sign-in tokens, cookies, or database query parameters. A report SHALL
identify the signed-in user, when there is one, by internal user id only.

#### Scenario: Database query failure

- **WHEN** a database query fails with an error whose message includes the
  query's parameters
- **THEN** the report contains the error type and database error code, and none
  of the parameters

#### Scenario: Error message containing an address or key

- **WHEN** an error's message or stack includes an email address or a PostHog
  API key
- **THEN** those values are replaced before the report is sent

#### Scenario: Sign-in link URL

- **WHEN** an error happens on a URL carrying a sign-in token
- **THEN** the token is not in the report

### Requirement: Reporting never breaks the app

A failure to send an error report SHALL NOT change the response the user gets,
and SHALL NOT delay a response by more than 2 seconds.

#### Scenario: PostHog unreachable

- **WHEN** PostHog cannot be reached while an error is being reported
- **THEN** the user still gets the same response, no new error is shown, and the
  failure is logged without the report's contents

### Requirement: Browser reports use the app's own origin

The browser SHALL send error reports to a path on this app's own origin, which
forwards them to PostHog, rather than to a PostHog domain. That path SHALL accept
reports without a session and SHALL expose no app data.

#### Scenario: Report from the sign-in page

- **WHEN** a browser error happens on `/sign-in`
- **THEN** the report is sent to this app's origin and reaches PostHog

### Requirement: The app itself is not tracked

The system SHALL NOT record page views, clicks or session recordings of this app
in PostHog. Only errors are sent.

#### Scenario: Normal browsing

- **WHEN** a user browses the app without any error
- **THEN** no events are sent to PostHog

### Requirement: New and reopened issues alert the team in Discord

When PostHog creates a new error issue, or reopens a resolved one, a message
SHALL be posted to the Open Waters Discord channel.

#### Scenario: New issue

- **WHEN** an error happens that PostHog has not seen before
- **THEN** a message naming the issue and linking to it appears in the Discord
  channel
