/**
 * Railway configuration for the analytics service, as Infrastructure as Code.
 *
 * Replaces railway.json. Railway ignores railway.json for services created
 * after Config as Code was deprecated (this service was), and stops reading it
 * for older services on 1 December 2026. The first deploys here ran without
 * the migration step or health check because of that, with no error.
 *
 * NOT applied on push. After changing this file:
 *   railway config plan    # read-only preview
 *   railway config apply   # changes the live project
 *
 * `partial` scopes this file to the resources it declares. Without it, Railway
 * treats the file as the whole project and would delete anything missing from
 * it, including the Postgres service.
 */
import { defineRailway, github, preserve, project, service } from "railway/iac";

export const partial = "analytics";

export default defineRailway(() => {
  const analytics = service("analytics", {
    // Must be declared: anything this file does not declare, it removes. An
    // earlier plan without this would have disconnected the GitHub repo.
    source: github("Open-Waters-Digital/analytics", { branch: "main" }),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    // Bundled migration runner (scripts/migrate.ts). Runs after the build and
    // before the new container takes traffic; a failure stops the deploy.
    // Calls node directly: the runtime image has no pnpm.
    preDeploy: "node dist/migrate.mjs",
    start: "node server.js",
    healthcheck: "/api/health",
    healthcheckTimeout: 60,
    replicas: 1,
    // Values are set in the Railway dashboard and never committed. preserve()
    // keeps whatever is there; leaving a variable out of this list deletes it
    // on apply. Add every new variable here in the same change that adds it to
    // src/server/env.ts and .env.example.
    env: {
      DATABASE_URL: preserve(), // ${{Postgres.DATABASE_URL}}
      BETTER_AUTH_SECRET: preserve(),
      BETTER_AUTH_URL: preserve(),
      RESEND_API_KEY: preserve(),
      AUTH_EMAIL_FROM: preserve(),
      AUTH_ALLOWED_EMAILS: preserve(),
      CREDENTIALS_ENCRYPTION_KEY: preserve(),
    },
  });

  // The nightly snapshot (scripts/jobs/nightly-snapshot.ts), as its own cron
  // service built from the same repo and the same Dockerfile. Railway starts a
  // container on the schedule, runs the command, and expects it to exit.
  //
  // No preDeploy: migrations belong to one service, and two services racing to
  // migrate the same database gains nothing. No healthcheck: nothing is
  // listening. The restart policy is left at Railway's default, because setting
  // it explicitly produced a permanent diff last time.
  const jobs = service("analytics-jobs", {
    source: github("Open-Waters-Digital/analytics", { branch: "main" }),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "node dist/jobs/nightly-snapshot.mjs",
    // 03:20 UTC: after any ingestion lag, outside UK working hours.
    deploy: { cronSchedule: "20 3 * * *" },
    replicas: 1,
    // Set in the dashboard on this service, then held here. DATABASE_URL is the
    // same Postgres reference the web service uses; CREDENTIALS_ENCRYPTION_KEY
    // must be the identical value, or stored keys cannot be decrypted.
    env: {
      DATABASE_URL: preserve(),
      CREDENTIALS_ENCRYPTION_KEY: preserve(),
    },
  });

  return project("analytics.openwaters.digital", { resources: [analytics, jobs] });
});
