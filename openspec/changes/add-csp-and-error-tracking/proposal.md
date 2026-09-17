# Proposal

## Why

Two items stand between the live app and the "before first deploy" list being
closed. There is no Content-Security-Policy, so if anything ever let markup into
a page (a client name, a learning log entry), a browser would run whatever script
it contained, on a page that holds client API key forms. And nobody is told when
the app breaks: errors reach Railway's logs and stay there. Open Waters also
plans to offer PostHog error tracking to clients, so using it here first proves
the setup before it is sold.

## What Changes

- **A strict Content-Security-Policy on every page**, with a new random nonce per
  request. Only this app's own scripts, and inline scripts carrying that
  request's nonce, can run. No third-party origins at all, no framing, forms
  post only to this app. `/sign-in/check-email` becomes rendered per request so
  it can carry the nonce too.
- **Errors reported to PostHog**, in a new project in an Open Waters
  organisation (not a client's):
  - unhandled errors in pages, route handlers and server actions on the server;
  - unhandled errors in the browser;
  - the failures registry actions already catch and log.
- **Readable stack traces**: source maps uploaded to PostHog during the
  production build, then removed from the build output so they are never served.
- **Nothing sensitive leaves the app**: reports carry the user's internal id
  only, never an email address, API key, ciphertext, session token or database
  query parameters.
- **Browser reports go through this app's own domain** (`/ingest`), so the CSP
  can stay free of third-party origins and ad blockers on the partners'
  browsers do not drop them.
- **No analytics or recordings of the app itself**: error tracking only.
- **Alerts in Discord**: PostHog posts to the Open Waters Discord channel when an
  error issue is created or reopened. Configured in PostHog, verified by a test
  alert.
- **New variables**: `NEXT_PUBLIC_POSTHOG_KEY` (build and runtime),
  `POSTHOG_API_KEY` and `POSTHOG_PROJECT_ID` (build only, for source maps).
- **New outbound calls**: PostHog ingestion from the server (with a timeout) and
  source map upload from the build.

## Capabilities

### New Capabilities

- `security-headers`: the Content-Security-Policy every page carries, the
  per-request nonce, and the headers that already exist.
- `error-tracking`: what is reported, from where, what a report may and may not
  contain, where alerts go, and that reporting never breaks a request.

### Modified Capabilities

None. `access-control` is unchanged: `/ingest` accepts error reports without a
session, the same as `/api/health` accepts health checks, and it reaches no app
data.

## Impact

- **Dependencies:** `posthog-js`, `posthog-node`, `@posthog/nextjs-config`.
- **Code:** `src/proxy.ts` (nonce and CSP), `src/lib/proxy-policy.ts` (public
  `/ingest`), `next.config.ts` (rewrites, source maps), new
  `src/instrumentation.ts`, `src/instrumentation-client.ts` or a client
  provider, `src/app/global-error.tsx`, `src/server/error-reporting.ts`, the
  registry actions' error path.
- **Build:** the Dockerfile's build stage gains `ARG`s for the three PostHog
  variables. Builds without `POSTHOG_API_KEY` (local, CI) skip the upload.
- **Railway:** the three variables set on the service and added to
  `.railway/railway.ts` with `preserve()`.
- **PostHog (manual):** an Open Waters organisation and project on EU Cloud, a
  personal API key with error tracking write access for uploads, and a Discord
  alert destination.
- **UI:** none beyond a plain error page from `global-error.tsx`. No new tokens
  or primitives. Works at 375px.
- **No database changes.**
