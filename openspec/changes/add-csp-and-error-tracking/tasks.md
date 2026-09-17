# Tasks

## 1. Unknowns first

- [ ] 1.1 Add `posthog-js`, `posthog-node` and `@posthog/nextjs-config` at exact versions; build with `withPostHogConfig` and throwaway values to confirm whether it works with Turbopack and `output: "standalone"`, what it does when upload fails, and that maps are deleted afterwards; record the result in design.md and switch to the CLI fallback if needed
- [ ] 1.2 Read the installed `posthog-node` types for `captureException`, flushing and shutdown, and the `posthog-js` types for `capture_exceptions`, `before_send` and `persistence`; adjust design.md if any option differs

## 2. Content-Security-Policy

- [ ] 2.1 Implement `buildContentSecurityPolicy(nonce, { dev })` in `src/lib/security-headers.ts`; verify unit tests for every directive in production and development
- [ ] 2.2 Generate a nonce in `src/proxy.ts` for every matched request and set the policy on forwarded request headers, the response and redirects; verify a test that two calls produce different nonces of at least 16 bytes
- [ ] 2.3 Make `/sign-in/check-email` render per request; verify in the build output that no page is prerendered static except `_not-found`
- [ ] 2.4 Verify in a production build with curl that `/sign-in`, `/sign-in/check-email` and a signed-in `/clients` carry the policy and all existing headers

## 3. Error scrubbing

- [ ] 3.1 Implement `src/lib/error-scrubbing.ts` (database query errors, email addresses, PostHog and Resend keys, long base64 runs, sensitive query parameters in messages, stacks and URLs); verify table-driven tests including a real `DrizzleQueryError` whose parameters contain an email address, and that ordinary messages pass through unchanged

## 4. Server reporting

- [ ] 4.1 Add `errorReportingEnv()` returning `null` when `NEXT_PUBLIC_POSTHOG_KEY` is unset; verify tests
- [ ] 4.2 Implement `reportError(error, context)` in `src/server/error-reporting.ts`: lazy client, production only, scrubbed, distinct id from the resolved session or `anonymous`, no person profile, never throws, 2-second cap; verify tests with a stubbed client for success, client throwing, timeout, development no-op and scrubbing
- [ ] 4.3 Add `src/instrumentation.ts` with `onRequestError` (Node.js runtime only); verify a test that it calls `reportError` with the route context
- [ ] 4.4 Call `reportError` from the registry actions' `attempt()` for unexpected errors only; verify tests that `UnauthorisedError` and validation results are not reported

## 5. Browser reporting

- [ ] 5.1 Add the `/ingest` rewrites and `skipTrailingSlashRedirect` to `next.config.ts`, and `/ingest` to the public paths in `src/lib/proxy-policy.ts`; verify proxy-policy tests and that `/ingest/...` is not redirected to sign-in
- [ ] 5.2 Add the production-only PostHog client initialiser to the root layout with the error-only options and a `before_send` that drops non-exception events and scrubs; verify unit tests for the `before_send` filter
- [ ] 5.3 Add `src/app/global-error.tsx` reporting to PostHog and showing a plain error page linking to `/clients`; verify it renders at 375px

## 6. Build and deploy wiring

- [ ] 6.1 Wire source maps per the result of 1.1, skipping upload when the variables are absent; verify a local production build without them succeeds and uploads nothing
- [ ] 6.2 Add the three `ARG`s to the Dockerfile build stage only; verify with `docker history` or an image inspection that the runtime image has no `POSTHOG_API_KEY`
- [ ] 6.3 Add the three variables to `.railway/railway.ts` with `preserve()`; verify `railway config plan` shows no destructive change once they exist on Railway
- [ ] 6.4 Update AGENTS.md: flip CSP and error tracking to ✅ in the first-deploy list, document the policy, the scrubber rule, the `/ingest` path, the variables table and how the Discord alert is configured; verify no stale references

## 7. Verification

- [ ] 7.1 In a local production build (Chromium): sign in, use the clients list, a client page and its forms, and `/design-system`; verify no CSP violations in the console and every interaction works
- [ ] 7.2 In that build, confirm with request interception that ordinary browsing sends nothing to `/ingest`, and a forced browser error sends one `$exception` request to `/ingest` with no email address or key in the body
- [ ] 7.3 After deploy (needs the user's PostHog project, variables and Discord alert): trigger a deliberate server error and a browser error in production, confirm both appear in PostHog with source-mapped stack traces and scrubbed contents, and that Discord received the alert; then remove the trigger
- [ ] 7.4 Run `pnpm run ci:quality` and report the real result
