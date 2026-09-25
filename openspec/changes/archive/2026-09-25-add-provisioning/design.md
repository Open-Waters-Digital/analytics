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

Task 1.2 confirmed it on 25 September 2026 against Open Waters' own project
(277423): of 33 events in 30 days, none carried an IP address. The skill gets
the corrected advice: either accept that partners' own visits are counted,
which is negligible at client volumes, or use an ingestion-time transformation
that drops matching IPs before they are discarded.

The same project's filter was PostHog's default "Internal / Test users" cohort,
which matches person properties: an internal flag, or an email ending in the
agency's domain. Cookieless mode creates no person profiles, so that cohort
matches nobody. It hides nothing and filters nothing. Provisioning treats a
cohort condition as harmless, because a cohort cannot match a host.

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
  to its contract key through `posthog_provisioned_objects` (below)
- the dashboard, found the same way, and created if the table has no row for it

Afterwards the check runs again, and its result is what the partner sees.

- **Rejected: PUT-ing the whole project.** It would overwrite settings this app
  does not own.
- **Rejected: matching insights by title.** Titles are for people, and a
  partner may rename one.

**Matching by recorded id, not by tag.** The first draft matched insights by a
PostHog tag, `ow:<insight key>`. Task 1.1 found tags are a paid PostHog feature
that Open Waters' own organisation does not have, and client organisations on
the free allowance will not have it either. So the app records what it created:

```
posthog_provisioned_objects
  id                 uuid pk
  site_id            uuid fk sites, cascade
  project_id         integer          the PostHog project, from the connection
  kind               provisioned_kind enum: dashboard | insight
  contract_key       text             'baseline' for the dashboard, else the insight key
  posthog_id         integer          PostHog's own id
  created_at, updated_at
  unique (site_id, project_id, kind, contract_key)
```

Each object provisioning creates also carries a marker line in its PostHog
description, `ow:<contract key>`, as a fallback. On a check:

1. Each recorded id is read. If PostHog returns it, not deleted, it is matched.
2. For a key with no row, or whose recorded object is gone, the project's
   objects are searched for the description marker. A match is adopted and its
   id recorded, so a lost row or a moved database recovers without duplicates.
3. A key with neither is missing, and apply creates it and records it.

The project id is part of the key, so a site that moves to a new PostHog
project starts clean rather than pointing at the old project's ids.

- **Rejected: tags only.** Unavailable on the plans clients will be on.
- **Rejected: the description marker only.** A partner editing a description
  would silently cause a duplicate on the next apply. The table makes the app's
  record authoritative and the marker a recovery path.
- **Rejected: matching on the query body.** Two insights can share a query, and
  a contract change to the query would then look like a missing insight.

### D3. Comparing values

- **Authorised URLs** are compared as sets of origins.
- **The internal-traffic filter** is inspected, not replaced. It is a
  difference only if one of its conditions would match the production host: a
  host, URL or `$current_url` condition that the production origin satisfies.
  Cohort and person-property conditions are never a difference. Applying
  removes just the matching conditions and leaves others alone.
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
  proxy and defaults report. No `cohort:read`: a cohort in the internal-traffic
  filter cannot match a host, so provisioning never needs to see inside one.
- A 401 or 403 maps to one message that names those scopes.

### D5. Run records

`posthog_provisioning_runs` holds:

- `id`
- `site_id`, as a foreign key with an index
- `run_by`, the user id
- `kind`: `check` or `apply`
- `differences`: an integer
- `outcome`: `matched`, `differs` (a check that found something to change),
  `applied`, `partial` or `failed`
- `taxonomy_version`
- `created_at`

There are no values, because a setting's value is PostHog's and can be re-read.
The panel shows the latest row.

### D5a. The measurement tier and its guard

`sites.measurement_tier` decides the tier-dependent part of `desiredProject`.
Today that is one setting and its masking:

| Tier       | Session recording           | Consent banner |
| ---------- | --------------------------- | -------------- |
| Essentials | Off                         | No             |
| Insights   | Allowed, every input masked | Yes            |
| Growth     | Allowed, every input masked | Yes            |

Growth changes nothing further in PostHog. Its extra work is the ad platforms,
which live in the client's site and the platforms' own accounts. The panel
lists that work, and the readiness checklist will track it later.

Allowing recording at project level records nothing on its own. The package
starts with recording off and records only after the site calls
`startRecording()` on consent, so a project that allows recordings before the
banner ships is safe. The guard exists anyway, because a project setting that
says "recording allowed" is a statement a client's adviser may read, and it
should only become true once the conditions for it are.

`desiredProject(site)` returns recording as a held difference when the tier is
above Essentials and `tier_confirmed_for` does not equal the current tier. The
diff lists held differences separately, and apply skips them. The confirmation
is a separate server action with two required checkboxes, one per condition,
that writes `tier_confirmed_for`, `tier_confirmed_at` and `tier_confirmed_by`.
Saving the site with a different tier sets all three to null in the same
transaction.

The masking and retention fields are named in task 1.1, which confirms them
against PostHog's API before any code is written.

- **Rejected: refusing the whole apply until confirmed.** It would hold back
  settings that are right at every tier, such as cookieless mode, for a reason
  that has nothing to do with them.
- **Rejected: keeping the banner checkbox beside the tier.** Two controls for
  one fact would disagree, and the one that decides expected events would be
  the one nobody looks at.
- **Rejected: storing the tier's settings as editable data.** The tiers are
  defined by the contract package's documents and the law behind them, not per
  client. A client that needs something different gets it recorded in its
  site's `AGENTS.md` and a change here.

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

1. The migration for `posthog_provisioning_runs`, the tier columns and the
   tier enum is additive. It sets `insights` for any site already marked as
   having a consent banner and `essentials` for the rest.
2. Deploy.
3. Check Open Waters' own project first, and apply there. Confirm that the
   second apply reports nothing to change.
4. Then apply to each new client as it is set up, per the skill. The skill's
   setup steps 3 to 5 become "run provisioning", and the manual list shrinks to
   what the panel shows.

**Rollback:** revert the deploy. The table is inert, and whatever was applied
to PostHog stays correct.
