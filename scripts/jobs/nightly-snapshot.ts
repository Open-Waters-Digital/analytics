/**
 * The nightly PostHog snapshot. Bundled to dist/jobs/nightly-snapshot.mjs and
 * run by the `analytics-jobs` Railway cron service, which starts a container,
 * runs this, and exits.
 *
 * Exit codes are what Railway's run history shows, so they mean:
 *   0  the run completed, even if some sites failed. A failed site is data, and
 *      the client page says so; it is not a broken job.
 *   1  the run could not complete at all (no database, no encryption key).
 *
 * Logs name a site by client slug and id, and a failure by the app's own fixed
 * message. No API key, no decrypted value and no query text is ever logged.
 */
import { getDb } from "@/db/client";
import { runNightlySnapshot } from "@/server/snapshots/collect";

const startedAt = Date.now();

try {
  const summary = await runNightlySnapshot();

  for (const result of summary.results) {
    console.info(
      JSON.stringify({
        event: "snapshot_site",
        site: result.clientSlug,
        site_id: result.siteId,
        outcome: result.outcome,
        reason: result.reason,
        days: result.daysWritten,
        ms: result.durationMs,
      }),
    );
  }

  for (const result of summary.searchResults) {
    console.info(
      JSON.stringify({
        event: "search_site",
        source: result.source,
        site: result.clientSlug,
        site_id: result.siteId,
        outcome: result.outcome,
        reason: result.reason,
        days: result.daysWritten,
        ms: result.durationMs,
      }),
    );
  }
  for (const pass of summary.indexing) {
    console.info(
      JSON.stringify({
        event: "indexing_site",
        site_id: pass.siteId,
        inspected: pass.inspected,
        failed: pass.failed,
      }),
    );
  }

  console.info(
    JSON.stringify({
      event: "snapshot_run",
      run: summary.runId,
      ok: summary.results.filter(result => result.outcome === "ok").length,
      failed: summary.results.filter(result => result.outcome === "failed").length,
      skipped: summary.results.filter(result => result.outcome === "skipped").length,
      ms: Date.now() - startedAt,
    }),
  );
} catch (error) {
  // The name only: a database error's message can carry the connection string.
  console.error(
    JSON.stringify({
      event: "snapshot_run_failed",
      name: error instanceof Error ? error.name : "unknown",
      ms: Date.now() - startedAt,
    }),
  );
  process.exitCode = 1;
} finally {
  // Postgres keeps the event loop alive, and a cron container must exit.
  await getDb().$client.end({ timeout: 5 });
}
