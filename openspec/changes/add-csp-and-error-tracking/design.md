# Design

## Context

Live app on Railway, Next.js 16 App Router, standalone output. `src/proxy.ts`
already runs on every non-static request (optimistic sign-in redirect, request
path header). `next.config.ts` sets the static security headers. Every page but
`/sign-in/check-email` is rendered per request. There is no third-party script,
font or style; the only `style=` attributes in the codebase are in the email
template, which is not a page. Registry actions catch unexpected errors in
`attempt()` and log the error name only. Motivation is in proposal.md.

Next 16's CSP guide
(`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`)
generates the nonce in Proxy and sets the policy on the request so Next applies
the nonce to its own scripts during rendering.

## Goals / Non-Goals

**Goals:**

- A policy with no `'unsafe-inline'` scripts and no third-party origins.
- One place that decides what an error report may contain.
- Stack traces that point at source, without serving source maps publicly.

**Non-Goals:**

- Product analytics, session replay or heatmaps of this app.
- Error tracking for client sites. The `openwaters-analytics` skill gains that
  once this has run in production for a while.
- CSP violation reporting (`report-to`). Worth adding once the policy is stable;
  it would need another public endpoint.
- Performance tracing. PostHog does not offer it; not needed for two users.

## Decisions

### Nonce CSP generated in `src/proxy.ts`

For every request the proxy matcher covers, the proxy creates a nonce from 16
random bytes (`crypto.getRandomValues`, base64), builds the policy, and sets it
on both the forwarded request headers (so Next extracts the nonce while
rendering) and the response. Redirects from the proxy carry the header too.

Policy (production):

```
default-src 'self';
script-src 'self' 'nonce-{nonce}' 'strict-dynamic';
style-src 'self' 'nonce-{nonce}';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self';
object-src 'none';
base-uri 'self';
frame-ancestors 'none';
form-action 'self';
upgrade-insecure-requests
```

Development adds `'unsafe-eval'` to `script-src` (React's dev tooling needs it)
and drops `upgrade-insecure-requests` (local HTTP). Building the policy string is
a pure function (`buildContentSecurityPolicy(nonce, { dev })`) with unit tests.

`/sign-in/check-email` gets `export const dynamic = "force-dynamic"`: a
prerendered page has no request, so no nonce, and its scripts would be blocked.

The existing static headers stay in `next.config.ts`; only CSP moves to the
proxy, because it must differ per request.

Alternatives: **static CSP in `next.config.ts` with `'unsafe-inline'`** (simpler,
but allows exactly the injected inline script CSP exists to stop); **hash-based
CSP** (Next's inline scripts change per build and per page, so hashes would need
generating at build time).

### PostHog project in an Open Waters organisation, EU Cloud

A new organisation ("Open Waters"), project "Open Waters Analytics app". Not a
client's organisation, so client billing and data stay separate, and it is the
organisation later used for anything Open Waters tracks for itself.

### Browser SDK: errors only, through `/ingest` on this app

`posthog-js` is initialised once in a small client component rendered by the
root layout, in production only, with:

- `api_host: "/ingest"`, `ui_host: "https://eu.posthog.com"`;
- `capture_exceptions: true`;
- `autocapture: false`, `capture_pageview: false`, `capture_pageleave: false`,
  `disable_session_recording: true`, `disable_surveys: true`,
  `persistence: "memory"`;
- a `before_send` that drops every event except `$exception` and scrubs it (see
  below).

`next.config.ts` rewrites `/ingest/static/:path*` and `/ingest/array/:path*` to
`https://eu-assets.i.posthog.com` and `/ingest/:path*` to
`https://eu.i.posthog.com`, with `skipTrailingSlashRedirect: true`, as PostHog's
Next.js proxy guide shows. `/ingest` is added to `PUBLIC_PREFIXES` in
`src/lib/proxy-policy.ts` so signed-out pages can report errors.

Because reports and any PostHog-loaded script come from this origin, the CSP
needs no PostHog domain, and ad blockers that match `*.posthog.com` do not drop
reports. `'strict-dynamic'` lets the nonce'd app bundle load the SDK.

`persistence: "memory"` keeps PostHog from writing cookies or local storage in
this app; errors are tied to a user by `identify`-free properties instead (see
next section).

Alternative: **PostHog's managed reverse proxy** on a subdomain. Works, but adds
DNS and a third-party origin to the CSP for no benefit on a two-user app.

### Server: `instrumentation.ts` plus explicit reports

- `src/instrumentation.ts` exports `onRequestError`, which calls
  `reportError(error, context)` in the Node.js runtime only. It covers errors
  thrown while rendering, in route handlers and in server actions that do not
  catch them.
- `src/app/global-error.tsx` reports errors that reach the root boundary in the
  browser via `posthog.captureException`, then shows a plain "Something went
  wrong" page with a link back to `/clients`.
- Registry actions already catch unexpected errors in `attempt()`, which is
  why `onRequestError` would never see them. `attempt()` calls
  `reportError(error, { label })` next to its existing log line.
- **Not reported:** `UnauthorisedError`, validation results, and connection
  check outcomes. None of those are failures of the app.

`src/server/error-reporting.ts` owns a single `posthog-node` client created on
first use (never at import, so builds need no key), and `reportError` is
fire-and-forget: it never throws, and it races the flush against a 2-second
timeout.

Each report sets `distinctId` to the signed-in user's internal id when a session
is already resolved for the request, otherwise `"anonymous"`, and
`$process_person_profile: false`, so no person profiles are created from it.

### One scrubber for every report

`src/lib/error-scrubbing.ts` (pure, shared by browser and server) turns any error
into a safe report:

- **Database errors:** Drizzle's `DrizzleQueryError` message is
  `Failed query: <sql> params: <values>`. It is replaced with
  `Database query failed (<postgres code>)`, using the code from the wrapped
  error, and the message line is removed from the stack.
- **Everywhere else:** email addresses, PostHog keys (`phx_`, `phc_`, `phs_`),
  Resend keys (`re_`), long base64 runs (ciphertext, tokens) and URL query
  values named `token`, `callbackURL`, `apiKey` are replaced with `[redacted]`
  in the message, the stack and any URL property.
- Exception event properties other than the exception list, URL, release and
  environment are dropped in the browser's `before_send`.

Table-driven tests feed it real error shapes from this codebase, including a
captured `DrizzleQueryError` carrying an email parameter.

### Source maps: `@posthog/nextjs-config`, uploaded at build, deleted after

`next.config.ts` is wrapped with `withPostHogConfig` when `POSTHOG_API_KEY` and
`POSTHOG_PROJECT_ID` are present (EU host, `deleteAfterUpload: true`, release
version from Railway's `RAILWAY_GIT_COMMIT_SHA`). Without them (local builds,
CI) the config is unwrapped and nothing uploads.

**To verify first, not assumed:** PostHog's page does not say whether the
wrapper supports Turbopack builds with `output: "standalone"`. The first
implementation task checks this with a real build. If it does not, the fallback
is the PostHog CLI in `scripts/build-scripts.mjs`'s step: inject and upload
`.next/static` then delete the maps, with the same variables.

The Dockerfile build stage declares `ARG NEXT_PUBLIC_POSTHOG_KEY`,
`ARG POSTHOG_API_KEY`, `ARG POSTHOG_PROJECT_ID` (Railway passes service variables
to declared build args). The runtime stage is a fresh `FROM`, so the personal
API key never reaches the running image.

### Discord alerts

Configured in PostHog: error tracking → Configuration → Alerting → New
notification → "Issue created or reopened" → Discord, using a webhook created in
the Discord channel's settings (Integrations → Webhooks) if PostHog asks for one.
Verified with PostHog's "Test function" and then with a deliberate error in
production (see tasks). Recorded in AGENTS.md so it can be recreated.

### Variables

| Variable                  | Where                 | Secret?                                        |
| ------------------------- | --------------------- | ---------------------------------------------- |
| `NEXT_PUBLIC_POSTHOG_KEY` | Build arg and runtime | No: project key, inlined in the browser bundle |
| `POSTHOG_API_KEY`         | Build arg only        | Yes: personal key with error tracking write    |
| `POSTHOG_PROJECT_ID`      | Build arg only        | No                                             |

All three are added to `.railway/railway.ts` with `preserve()` and to
`.env.example` (by the user). The server reads the project key through a new
`errorReportingEnv()` that returns `null` when unset rather than failing, so a
missing key disables reporting instead of breaking the app.

## Risks / Trade-offs

- [A Next.js inline script without the nonce breaks a page silently] → the
  verification task walks every screen in a production build and fails on any
  console violation.
- [`'strict-dynamic'` means any script the app bundle loads is trusted] →
  accepted; it is what makes nonces workable with Next's chunk loading, and the
  bundle only loads this origin's chunks and the PostHog SDK through `/ingest`.
- [`/ingest` lets anyone send events to the project through this domain] →
  they could already send them to PostHog directly with the public project key.
  Worst case is noise in the error list.
- [Scrubbing misses a new kind of sensitive value] → reports are reviewed after
  the first week; the scrubber is one tested module to extend.
- [Personal API key at build time] → build arg only, never in the runtime image,
  scoped to error tracking write.
- [Source map upload fails and breaks the build] → the wrapper's failure mode is
  checked in the first task; if it fails the build, upload errors are caught and
  logged instead, because a deploy is worth more than readable traces.

## Migration Plan

1. PostHog (manual): Open Waters organisation, EU project, personal API key with
   error tracking write, Discord alert.
2. Railway: set the three variables, add them to `.railway/railway.ts`, plan
   (expect no destructive changes), apply.
3. Push. The deploy builds with the upload; pre-deploy has no migrations.
4. Verify headers, reporting and Discord on the live app.
5. Rollback: revert the commit. CSP problems show up as broken pages, so check
   the live sign-in page immediately after deploy.
