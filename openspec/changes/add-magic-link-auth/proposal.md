# Proposal

## Why

The app will hold every client's registry details and encrypted PostHog keys,
so nothing can be deployed until only the two Open Waters partners can reach
it. Sign-in has to exist before the client registry, and it must be cheap to
run for two people.

## What Changes

- Add passwordless sign-in: a partner enters their email address and receives
  a single-use link, sent through Resend, that signs them in.
- Only addresses on an allowlist can ever get a link or an account. There is no
  sign-up screen. Anyone else sees the same "check your email" message, so the
  form does not reveal who has access.
- Every page except the sign-in flow and the health check requires a session.
  The session check lives in the server-side data access layer, so a page or
  action cannot forget it.
- Removing an address from the allowlist revokes that person's access at their
  next request, without waiting for the session to expire.
- Add a signed-in app shell: header with the app name, navigation, the signed-in
  address and a sign-out button.
- `/design-system` moves behind sign-in with everything else.
- New tables for users, sessions and verification tokens (Better Auth's
  schema), created by a committed migration.
- New secrets and settings: auth secret, public app URL, Resend API key, sender
  address and the allowlist.
- New outbound call: Resend's API when a link is requested, with a timeout.

## Capabilities

### New Capabilities

- `access-control`: who can sign in, how a magic link behaves, what a session
  grants, what is reachable without one, and how access is revoked.

### Modified Capabilities

None. No specs exist yet.

## Impact

- **Dependencies:** `better-auth`, `resend`.
- **Database:** new `users`, `sessions`, `accounts` and `verifications` tables
  plus migration. No existing data.
- **Environment:** `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`,
  `AUTH_EMAIL_FROM`, `AUTH_ALLOWED_EMAILS`. All server-only, validated in
  `src/server/env.ts`, documented in `env.example`.
- **Routes:** `/sign-in`, `/sign-in/check-email`, `/api/auth/[...all]`;
  every other route becomes protected.
- **UI:** new app shell layout. No new primitives or tokens; the sign-in form
  uses `Field` and `Button`. Works at 375px: a single centred column.
- **Operations:** the Resend sending domain for `openwaters.digital` must be
  verified before first deploy, or links will not arrive.
