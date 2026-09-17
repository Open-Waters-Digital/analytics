# Tasks

## 1. Configuration and schema

- [ ] 1.1 Add `better-auth` and `resend` at exact versions; verify `pnpm install --frozen-lockfile` succeeds from the committed lockfile
- [ ] 1.2 Extend `src/server/env.ts` with the five auth variables and the production-only rule for `RESEND_API_KEY`; parse `AUTH_ALLOWED_EMAILS` into a lower-cased `Set`; verify with unit tests for missing, malformed and production-mode cases
- [ ] 1.3 Add the variables with placeholders and one-line explanations to `env.example`; verify every variable `env()` reads is listed
- [ ] 1.4 Create `src/server/auth.ts` (magic link plugin, Drizzle adapter, `nextCookies`, 15-minute hashed tokens, 30-day rolling sessions, database-backed rate limit rule, forwarded-IP header); verify typecheck passes
- [ ] 1.5 Generate the Better Auth schema into `src/db/auth-schema.ts`, re-export it from `src/db/schema.ts`, run `pnpm db:generate`, read the SQL and commit it; verify `node dist/migrate.mjs` applies it to a fresh local database

## 2. Allowlist, return URLs and email

- [ ] 2.1 Implement `isAllowed(email)` and `safeReturnTo(value)` as pure functions; verify unit tests cover case and whitespace, and open-redirect inputs (`//evil.com`, `https://evil.com`, `/\evil.com`, empty)
- [ ] 2.2 Implement `sendMagicLink`: skip non-allowlisted addresses, send via Resend with a 10-second timeout, log without address or link; verify tests for allowlisted, non-allowlisted, Resend error and timeout, with the Resend client stubbed
- [ ] 2.3 Implement the development-only terminal fallback; verify a test that it prints in development without a key and that `env()` rejects a production config without a key
- [ ] 2.4 Add the `user.create.before` hook rejecting non-allowlisted addresses; verify a test that user creation for such an address fails

## 3. Session gate

- [ ] 3.1 Implement `getSession`, `requireSession` and `requirePageSession` in `src/server/session.ts`; verify tests for no session, valid session, session whose email was removed from the allowlist, and `getSession` throwing (treated as signed out)
- [ ] 3.2 Add `src/proxy.ts` with the optimistic cookie redirect and a matcher excluding `/sign-in`, `/api/auth`, `/api/health` and static assets; verify by requesting `/` signed out against a running build (302 to `/sign-in?returnTo=%2F`) and `/api/health` (200)
- [ ] 3.3 Mount `src/app/api/auth/[...all]/route.ts`; verify the verify endpoint rejects a made-up token without creating a session

## 4. Screens

- [ ] 4.1 Build `/sign-in` and `/sign-in/check-email` with `Field`, `Button` and a small client `SubmitButton` for pending state; verify at 375px, keyboard-only submission, and field error on invalid email
- [ ] 4.2 Show the expired/used-link and rate-limit messages on `/sign-in`; verify by opening a used link and by submitting six requests
- [ ] 4.3 Move `/` and `/design-system` into `src/app/(app)/` with a layout calling `requirePageSession` and rendering the header with Sign out; verify signed-out requests to both redirect and signed-in requests render
- [ ] 4.4 Implement Sign out as a server action deleting the server session; verify that replaying the old cookie after sign-out is rejected

## 5. End to end and docs

- [ ] 5.1 Sign in end to end locally against the compose database using the terminal fallback: request link, open it, land on the original page, sign out; record the result in the change
- [ ] 5.2 Confirm in a production build that the session cookie carries `HttpOnly`, `SameSite=Lax` and `Secure` (behind HTTPS or with the production flag), and that no log line contains an address, token or link
- [ ] 5.3 Update AGENTS.md: flip Access to ✅, add the auth files to the repo tree, add the variables to the first-deploy list; verify no stale reference to "proposed"
- [ ] 5.4 Run `pnpm run ci:quality` and report the real result
