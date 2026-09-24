# Design: add provisioning

## Context

- `src/server/posthog.ts` owns the host per region, the auth header, the
  timeouts and the fixed error messages. Every PostHog call goes through it.
- The registry holds everything provisioning needs:
  - `sites.productionUrl`, `sites.timezone` and `sites.taxonomyVersion`
  - `posthog_connections.region` and `projectId`
- After `adopt-the-contract-package`, the baseline dashboard per version comes
  from `@open-waters-digital/analytics/contract` as data: insights with a
  stable key, a kind, events and a breakdown.
- PostHog's canonical project endpoint is `/api/projects/:id/`
  (`/api/environments/` is a deprecated alias). Its settings include
  `cookieless_server_hash_mode`, `anonymize_ips`, `session_recording_opt_in`,
  `app_urls`, `test_account_filters` and `timezone`. The exact allowed values,
  such as which hash-mode value means "on", are confirmed against the live
  API in the tasks, not assumed here.

### A finding in the skill

**"Discard client IP data" and "filter internal traffic by IP" cannot both
work.** With IP discarding on, PostHog does not store IP addresses with
events. The internal-traffic filter is applied when a query runs, so an `$ip`
filter has nothing to match.

The skill currently recommends both. Provisioning therefore:

- does not set an IP filter
- requires only that no filter matches the production host, which is the
  failure that hides everything

Task 1.2 confirms this against a real project. The skill gets the corrected
advice: either accept that partners' own visits are counted, which is
negligible at client volumes, or use an ingestion-time transformation that
drops matching IPs before they are discarded.

## Goals / Non-Goals

**Goals:**

- One click from a fresh project to the contract's configuration.
- A second run is provably a no-op.
- Nothing write-capable is ever stored.

**Non-Goals:**

- Creating organisations or projects.
- The proxy's DNS.
- Nightly checks of settings. That is a follow-up, and needs `project:read` on
  the stored key.
- Deleting anything in PostHog.

## Decisions

### D1. A panel with server actions, not a CLI

`checkProvisioning(siteId, key)` and `applyProvisioning(siteId, key)` are
server actions in `src/server/provisioning/`. Each checks the session first.
The panel's form posts the key as a password field.

The partner types or pastes the key once. The browser keeps it in the form
between check and apply. The server receives it for each request and forgets it
at the end.

- **Rejected: a CLI script.** It would need the production database's
  credentials on a partner's machine to read the registry. The key would also
  pass through a shell's history or environment.
- **Rejected: storing a second, write-capable key.** It turns a leaked database
  row into write access to every client's analytics.

### D2. Desired state as data, diff, then apply

`desiredProject(site)` returns the settings, with the heatmaps setting taken
from the site's `uses_heatmaps` flag. That mirrors the site's own
`heatmaps: true` in the package (`add-heatmaps-option`), whose client option
already decides in the browser; the project setting is kept in step so the
project does not contradict the site. `desiredInsights(version)`
maps the contract's dashboard to PostHog insight bodies. Trends and breakdowns
become `TrendsQuery`, and funnels become `FunnelsQuery`, each inside an
`InsightVizNode`.

`diff(current, desired)` returns typed differences, and apply sends only
those:

- one `PATCH` of the project with just the changed fields
- a `POST` for a missing insight, or a `PATCH` for a changed one, each matched
  by a stable key tag of the form `ow:<insight key>`
- the dashboard, found or created by the tag `ow:baseline`, never by name

Afterwards the check runs again, and its result is what the partner sees.

- **Rejected: PUT-ing the whole project.** It would overwrite settings this app
  does not own.
- **Rejected: matching insights by title.** Titles are for people, and a
  partner may rename one.

### D3. Comparing values

- **Authorised URLs** are compared as sets of origins.
- **The internal-traffic filter** is inspected, not replaced. It is a
  difference only if one of its conditions would match the production host.
  Applying removes just those conditions and leaves others alone.
- **Insights** are compared on their query body, after normalising key order
  and PostHog's added defaults. An insight that differs only in PostHog's own
  fields is not a difference.

### D4. The one-use key

- The key is a password input with `autocomplete="off"`.
- It is never put into a returned value or a stored row. Errors use fixed
  strings, as `CHECK_MESSAGES` does.
- The action's logs record the site id, the step and the outcome, never
  request bodies.
- The required scopes are listed on the panel: `project:write`,
  `dashboard:write`, `insight:write` and `organization:read`, the last for the
  proxy and defaults report.
- A 401 or 403 maps to one message that names those scopes.

### D5. Run records

`posthog_provisioning_runs` holds:

- `id`
- `site_id`, as a foreign key with an index
- `run_by`, the user id
- `kind`: `check` or `apply`
- `differences`: an integer
- `outcome`: `matched`, `applied`, `partial` or `failed`
- `taxonomy_version`
- `created_at`

There are no values, because a setting's value is PostHog's and can be re-read.
The panel shows the latest row.

### D6. Timeouts and partial failure

Each call uses `CHECK_TIMEOUT_MS` (10 seconds), and apply's calls run in
sequence: project settings, then the dashboard, then each insight.

On a failure, the run stops. It records `partial` or `failed`, and returns the
steps that succeeded with a fixed message. The check that follows shows what is
left. There is no retry inside an apply, because a person is waiting and can
press the button again.

## Risks / Trade-offs

- **[PostHog changes a field's name or values.]** → The fields and values are
  confirmed in the tasks and recorded in one module. A mismatch fails as an
  unexpected response with a fixed message. It never writes a wrong value
  silently, because the next check would show the difference.
- **[A partner applies to the wrong project.]** → The project id comes from the
  site's stored connection, never from the form. The panel shows the project id
  and region before apply.
- **[The key is pasted into the wrong site's panel.]** → PostHog rejects a key
  outside its scope, and the run records a failure.

## Migration Plan

1. The migration for `posthog_provisioning_runs` is additive.
2. Deploy.
3. Check Open Waters' own project first, and apply there. Confirm that the
   second apply reports nothing to change.
4. Then apply to each new client as it is set up, per the skill. The skill's
   setup steps 3 to 5 become "run provisioning", and the manual list shrinks to
   what the panel shows.

**Rollback:** revert the deploy. The table is inert, and whatever was applied
to PostHog stays correct.
