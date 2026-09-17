# Design

## Context

The app is a fresh bootstrap (see AGENTS.md): Next.js 16 App Router, Drizzle
on Postgres 17, a Zod-validated `env()` in `src/server/env.ts`, and an empty
schema. In Next 16 the old `middleware.ts` is `proxy.ts`, and the bundled docs
(`node_modules/next/dist/docs/01-app/02-guides/authentication.md`) say to use
it for optimistic redirects only, with the real check in a data access layer.
Motivation is in proposal.md.

## Goals / Non-Goals

**Goals:**

- One function every protected read and write calls first, so an unchecked data
  path is a visible omission in review.
- No passwords, no sign-up, no account management UI.
- Local development works without a Resend account.

**Non-Goals:**

- Roles or permissions. Both partners can do everything.
- Managing the allowlist from the UI. Two addresses change rarely; an
  environment variable and a redeploy are enough.
- Sign-in with Google or any other provider.

## Decisions

### Better Auth with the magic link plugin and the Drizzle adapter

Better Auth owns token generation, hashing, expiry, the verify endpoint, session
storage and cookie flags. The app supplies `sendMagicLink` and the allowlist.
Configured in `src/server/auth.ts` (imports `server-only`), mounted at
`src/app/api/auth/[...all]/route.ts` with `toNextJsHandler`, with the
`nextCookies()` plugin so server actions can set the session cookie.

- `expiresIn: 900` (15 minutes). The five-minute default is too short when an
  email is slow to arrive.
- `storeToken: "hashed"`, so a database read does not yield usable links.
- Sessions: `expiresIn` 30 days with `updateAge` of 1 day, giving the rolling
  30-day idle expiry in the spec.
- Table names via the adapter's `usePlural: true` and snake_case columns, in
  line with the schema conventions. The schema is generated with the Better
  Auth CLI into `src/db/auth-schema.ts`, re-exported from `src/db/schema.ts`,
  then `pnpm db:generate` produces the SQL.

Alternatives: **Auth.js** (its email provider needs more custom glue in the App
Router, and the project already leans on Better Auth in the ADR); **hand-rolled
signed tokens** (the bootstrap rules forbid hand-rolling session and token
code); **Lucia** (now a learning resource rather than a maintained library).

### The allowlist is enforced in three places

1. **Before sending.** `sendMagicLink` returns without sending when the address
   is not allowlisted. The endpoint's response is identical either way, so the
   form does not reveal membership.
2. **Before creating a user.** A `databaseHooks.user.create.before` hook rejects
   any address not on the list. This covers any future plugin or endpoint that
   could create users.
3. **On every request.** `requireSession()` checks the session's email against
   the current allowlist, which is what makes removal take effect immediately.

`AUTH_ALLOWED_EMAILS` is a comma-separated list, parsed once by `env()` into a
lower-cased, trimmed `Set`. `isAllowed(email)` is a pure function with its own
tests.

Alternative: `disableSignUp: true` with users seeded by a script. Rejected
because it adds a script to run on every environment and still needs the
per-request check for revocation.

### One session gate for the data access layer

`src/server/session.ts` exports:

- `getSession()`: `auth.api.getSession({ headers: await headers() })`, wrapped
  so that any thrown error (including a database outage) returns `null`. Fail
  closed.
- `requireSession()`: returns the session or throws `UnauthorisedError`, after
  the allowlist check.
- `requirePageSession(returnTo)`: for server components; redirects to
  `/sign-in?returnTo=...` instead of throwing.

Every function in `src/server/` that reads or writes app data calls
`requireSession()` first. Server actions catch `UnauthorisedError` and return a
typed `{ ok: false, error: "unauthorised" }`.

`src/proxy.ts` does an optimistic redirect: no Better Auth session cookie means
a redirect to `/sign-in` before rendering. It never grants access; it only saves
a render for obviously signed-out visitors. Its matcher excludes `/sign-in`,
`/api/auth`, `/api/health` and static assets.

Alternative: checks in each page. Rejected: that is the "check that has to be
remembered" the bootstrap skill warns about.

### Safe return URLs

`returnTo` is accepted only if it is a same-origin path beginning with a single
`/` (not `//`, not a URL with a scheme). Anything else becomes `/`. Pure
function, unit tested with the usual open-redirect payloads.

### Sending through Resend, with a timeout

`src/server/email.ts` sends with the Resend SDK, bounded by a 10-second
`AbortSignal.timeout` race. On failure it logs `auth: magic link send failed`
with the error code only, and the user still sees "check your email" (a failed
send is indistinguishable from a non-allowlisted address, which is acceptable
for two users and avoids an enumeration signal). The sender is
`AUTH_EMAIL_FROM`, e.g. `Open Waters Analytics <analytics@openwaters.digital>`.

In development only (`NODE_ENV !== "production"`) and only when
`RESEND_API_KEY` is unset, the link is printed with `console.info` instead.
`env()` makes `RESEND_API_KEY` required when `NODE_ENV` is `production`, so the
fallback cannot be reached in production.

### Rate limiting

Better Auth's built-in limiter with a custom rule for the magic link endpoint:
5 requests per 10 minutes. Storage in the database, not memory, so it survives
a restart and would still hold with a second replica. Railway sits behind a
proxy, so the client IP is read from `x-forwarded-for` via Better Auth's
`advanced.ipAddress.ipAddressHeaders`.

### Screens

- `/sign-in`: one `Field` (email), one `Button`, and an inline message area for
  expired links and rate limiting. Submits through a server action that calls
  `auth.api.signInMagicLink`. Single centred column at every width; no client
  component needed beyond the form's pending state, which uses
  `useFormStatus` in a small client `SubmitButton`.
- `/sign-in/check-email`: static confirmation, with a link back to try again.
- App shell: `src/app/(app)/layout.tsx` calls `requirePageSession`, renders a
  header (app name, Clients link placeholder, Design system link, signed-in
  address, Sign out). Sign out is a server action. At 375px the navigation
  collapses under the app name as a wrapped row; there are only three items, so
  no menu toggle.
- Routes move into the `(app)` group so the layout protects them all:
  `/`, `/design-system`.

### Environment

`env()` gains:

| Variable              | Rule                                            |
| --------------------- | ----------------------------------------------- |
| `BETTER_AUTH_SECRET`  | Required, at least 32 characters                |
| `BETTER_AUTH_URL`     | Required URL; `https` in production             |
| `RESEND_API_KEY`      | Required in production, optional in development |
| `AUTH_EMAIL_FROM`     | Required                                        |
| `AUTH_ALLOWED_EMAILS` | Required, at least one valid address            |

## Risks / Trade-offs

- [Resend domain not verified, links go to spam] → listed as a 🧱 item in
  AGENTS.md; the first deploy checklist includes signing in on the real domain.
- [Allowlist typo locks both partners out] → the app logs at startup how many
  allowlisted addresses were parsed (the count, not the addresses); a redeploy
  with the fix restores access.
- [Better Auth schema or API changes in a minor release] → versions pinned
  exactly; the generated schema is committed and reviewed like any migration.
- [Per-request allowlist check adds work] → it is an in-memory `Set` lookup on a
  session Better Auth already loads.
- [Timing difference between allowlisted and non-allowlisted requests reveals
  membership] → accepted. Two known users; the rate limit bounds probing.

## Migration Plan

1. Add dependencies, generate the auth schema, generate and review the
   migration, apply locally.
2. Ship with the registry change or before it. Nothing is deployed yet, so
   there is no data to migrate and no rollback beyond reverting the commit.
3. Before first deploy: set the five variables in Railway, verify the Resend
   domain, sign in on the real URL, sign out, replay the old cookie and confirm
   it is rejected.
