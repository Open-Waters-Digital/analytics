# Spec Delta

## Purpose

Limits what a browser will run or load on any page of Open Waters Analytics, so
injected markup cannot execute, and keeps the existing protective headers on
every response.

## ADDED Requirements

### Requirement: Every page carries a strict Content-Security-Policy

Every HTML page response SHALL include a `Content-Security-Policy` header that:

- allows scripts only from this app's origin, and inline scripts only when they
  carry the nonce issued for that response;
- allows styles, images, fonts and network requests only from this app's origin
  (images may also use `data:` and `blob:` URLs);
- forbids plugins (`object-src 'none'`), restricts `<base>` to this origin,
  forbids the page being framed by any origin, and allows forms to submit only
  to this origin.

This SHALL apply to pages shown before sign-in as well as after.

#### Scenario: Sign-in page

- **WHEN** `/sign-in` is requested
- **THEN** the response has a `Content-Security-Policy` header meeting every
  rule above

#### Scenario: Check-email page

- **WHEN** `/sign-in/check-email` is requested
- **THEN** it carries the same policy with its own nonce

#### Scenario: Signed-in page

- **WHEN** a signed-in user requests `/clients`
- **THEN** the response carries the policy

#### Scenario: Injected inline script

- **WHEN** a page contains an inline `<script>` without the response's nonce
- **THEN** the browser does not run it

#### Scenario: Third-party script

- **WHEN** a page tries to load a script from any other origin
- **THEN** the browser blocks it

### Requirement: The nonce is unique per response

Each page response SHALL use a new, unpredictable nonce, at least 128 bits of
randomness, never reused across responses.

#### Scenario: Two requests

- **WHEN** the same page is requested twice
- **THEN** the two responses carry different nonces

### Requirement: The app works under the policy

Every page and interaction SHALL work with the policy enforced and SHALL produce
no Content-Security-Policy violation in the browser in production.

#### Scenario: Sign-in, registry and showcase

- **WHEN** a user signs in, uses the clients list, a client page with its forms,
  and `/design-system` in a production build
- **THEN** everything works and the browser reports no policy violations

### Requirement: Existing protective headers remain

Every response SHALL continue to carry `X-Robots-Tag: noindex, nofollow`,
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: same-origin`, the `Permissions-Policy` and
`Strict-Transport-Security`.

#### Scenario: Headers on a page

- **WHEN** any page is requested
- **THEN** all of these headers are present alongside the new policy
