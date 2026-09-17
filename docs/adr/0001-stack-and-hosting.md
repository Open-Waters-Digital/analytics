# 0001. Stack and hosting

Date: 2026-09-17. Status: accepted.

## Context

Open Waters needs one internal place to see every client's analytics, check
that tracking is healthy, and later draft monthly reports. Two users. Low
traffic. Speed of change matters more than polish. The partners already run
Next.js (luxury-gardens, dj-events-planning), Astro (radara, open-waters),
Drizzle, Postgres and Railway.

## Decision

| Concern      | Choice                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------- |
| Framework    | Next.js 16 App Router, standalone output                                                  |
| Language     | TypeScript strict, `noUncheckedIndexedAccess`                                             |
| Data         | Postgres 17 on Railway, Drizzle ORM, drizzle-kit migrations                               |
| Migrations   | Bundled script run as Railway's pre-deploy command                                        |
| Nightly work | Railway cron service running a bundled script from the same image                         |
| Auth         | Better Auth, magic link sent through Resend, email allowlist                              |
| Validation   | Zod 4                                                                                     |
| Styling      | Tailwind v4 tokens based on the Open Waters marketing site                                |
| Tests        | Vitest; Playwright once there are screens worth driving                                   |
| Domain       | `analytics.openwaters.digital`, DNS at Porkbun (CNAME to Railway)                         |
| Secrets      | Open Waters secrets in Railway variables; each client's PostHog key encrypted in Postgres |

## Rejected

- **Astro.** Matches the marketing sites, but this is an interactive data app
  with forms, sessions and tables. Next's server components and actions fit it
  with less glue.
- **Supabase** (as dj-events-planning). Managed auth and Postgres together, but
  it adds a second platform beside Railway for two users.
- **In-process scheduler** (node-cron inside the web server). A restart or a
  second replica silently skips or doubles the nightly run.
- **One environment variable per client key.** Adding a client would need a
  redeploy, and there would be no record of when a key was added or last
  worked.
- **One unscoped PostHog key for every client.** Less setup, but a leak exposes
  every client. Each client gets a key scoped to one project with Query Read
  only.
- **Google sign-in or Cloudflare Access.** Google needs an OAuth client for two
  people; Cloudflare Access needs DNS on Cloudflare, and the domain is at
  Porkbun.
