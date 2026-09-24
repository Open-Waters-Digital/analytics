# Add provisioning

## Why

Every client's PostHog project has to be set up the same way by hand:

- project settings
- the Digital Dividend baseline dashboard
- a read-only key for this app

The skill lists the steps. Two of the settings fail silently when they are
wrong:

- Cookieless server hash mode switched off. PostHog still answers "Ok".
- An internal-traffic filter that matches the production host. Every event is
  hidden while still being stored.

Both cost an hour on the first install. The rest depend on a person following a
list, once per client, with no way to check later that the project still
matches.

The skill already says these steps "will become a re-runnable provisioning
script in the Open Waters internal analytics app". This is the third weakness
from the review recorded in `analytics-contract`'s `create-the-package`.

## What Changes

- **A "PostHog project" panel on each site**, with two actions:
  - **Check** reads the project and lists every setting and dashboard insight
    that differs from what the contract and the registry require, with the
    current and required value side by side. It changes nothing.
  - **Apply** makes the listed changes, then checks again. A run on an
    already-provisioned project reports "Nothing to change" and makes no write.
- **What it sets**, from the registry and the contract:
  - cookieless server hash mode on
  - the timezone from the site's timezone
  - client IP data discarded
  - session recording off
  - heatmaps off, unless the site is marked as using aggregate heatmaps, in
    which case on. That follows the site's own `heatmaps` setting in the
    package (1.1.0 and later), so provisioning never switches off a decision
    a site made
  - the authorised URL is the site's production origin only
  - the internal-traffic filter limited to local hosts
  - the baseline dashboard for the site's taxonomy version, from the package's
    `BASELINE_DASHBOARDS`

  Dashboard insights are matched by their stable key, so they are updated in
  place and never duplicated. An insight a partner added by hand is left alone.

- **What it only reports:**
  - whether the managed reverse proxy for the site's domain is live, where the
    key can read it
  - whether the organisation defaults to discarding IP data
- **The key is used once and never kept.**
  - Provisioning needs write access that the stored Query Read key does not
    have.
  - A partner pastes a personal API key, with the scopes listed on the panel,
    into the form for that request only.
  - It is not stored, logged or returned. The panel says to delete the key in
    PostHog afterwards.
- **A record of each run**:
  - when, by whom, check or apply
  - how many differences, the outcome
  - the taxonomy version it was checked against

  This makes "when was this project last checked" answerable. It is the basis
  for the yearly re-check of the legal conditions that the review recommended.

**Not in this change:**

- creating the organisation
- billing
- the data processing agreement
- the proxy's DNS record
- creating the Query Read key

PostHog does not expose the first four safely to an API key, and the fifth is a
human decision about access. They stay manual, and the panel links to the
skill's list.

**Nightly checking of settings is also not in this change.** It would need the
stored key to gain `project:read`. That is a follow-up, once this has run
against real projects.

## Capabilities

### New Capabilities

- `project-provisioning`: checking and applying a client's PostHog project
  settings and baseline dashboard, the one-use key, and the run record.

### Modified Capabilities

None. The registry specs are in the unarchived `add-client-registry`.

## Impact

- **Depends on:** `adopt-the-contract-package` (for `BASELINE_DASHBOARDS`).
- **Tables:** `posthog_provisioning_runs`, with a migration:
  - site id, indexed
  - who ran it, and when
  - whether it was a check or an apply
  - the difference count and the outcome
  - the taxonomy version
  - no settings values and no key
- **One column on `sites`:** `uses_heatmaps` (boolean, default false), with a
  checkbox on the site form. open-waters is marked true, since it turns
  heatmaps on deliberately.
- **Secrets:**
  - Nothing new is stored.
  - The one-use key travels in a server action's form data over HTTPS, is held
    in memory for the request, and is never logged. Errors are fixed strings,
    as in `src/server/posthog.ts`.
  - The action checks the session first, like every mutation.
- **Outbound calls:** reads and writes to PostHog's project, dashboard and
  insight endpoints in the connection's region. Each call has a 10-second
  timeout (`CHECK_TIMEOUT_MS`), because a person is waiting. A failure stops
  the run, records it, and shows a fixed message. Writes made before a failure
  stay, and the check that follows shows exactly what remains.
- **UI:**
  - A new panel on the client page, built from `Panel`, `Table`, `Field`,
    `Button` and `StatusDot`.
  - No new primitive or token.
  - At 375px the difference table stacks: each setting becomes a row with the
    current value above the required one.
