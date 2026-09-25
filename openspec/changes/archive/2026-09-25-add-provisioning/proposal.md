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

The contract package now describes three measurement tiers: Essentials,
Insights and Growth. Moving a client up a tier changes their PostHog project as
well as their site, and the project half is exactly what provisioning does. So
the tier is recorded here, on the site, and provisioning reads it. Added on 25
September 2026, before any of this change was applied.

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
  - session recording off for Essentials, and allowed for Insights and Growth
    once the tier is confirmed, with every input masked
  - heatmaps off, unless the site is marked as using aggregate heatmaps, in
    which case on. That follows the site's own `heatmaps` setting in the
    package (1.1.0 and later), so provisioning never switches off a decision
    a site made
  - the authorised URL is the site's production origin only
  - the internal-traffic filter limited to local hosts
  - the baseline dashboard for the site's taxonomy version, from the package's
    `BASELINE_DASHBOARDS`

  Dashboard insights are matched by their stable key, so they are updated in
  place and never duplicated. The app records the PostHog id of each dashboard
  and insight it creates, because PostHog's tags, the first plan for this, are a
  paid feature client organisations will not have. An insight a partner added by
  hand is left alone.

- **A measurement tier on each site**: Essentials, Insights or Growth, set on
  the site form and defaulting to Essentials.
  - It decides the tier-dependent settings above.
  - It replaces the "has a consent banner" checkbox. Insights and Growth mean a
    banner; Essentials means none. The existing rule that the banner adds or
    removes `consent_updated` from the expected events still applies, now
    triggered by a change of tier.
  - Heatmaps stay a separate choice, because aggregate heatmaps are allowed at
    Essentials.
- **A guard on moving up a tier.** Setting Insights or Growth records the
  intention. Before Apply will allow session recording, a partner must confirm,
  for that tier, that the consent banner is live on the production site and
  that the privacy page names the tools the tier adds. The app cannot check
  either, and they are what make the higher tiers lawful.
  - Until confirmed, Check lists recording as "held until the tier is
    confirmed", and Apply converges everything else and leaves recording off.
  - The confirmation records who confirmed, when, and for which tier. Changing
    the tier clears it.
  - Moving down a tier needs no confirmation, since it only ever switches
    things off.
  - The panel lists the site-side work each tier needs, because provisioning
    changes PostHog and never the client's site: the banner, the
    `startRecording()` call on consent, and for Growth the ad platform loaders
    and Consent Mode.
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

**Tier-specific dashboard insights are not in this change.** The baseline
dashboard comes from the contract package's `BASELINE_DASHBOARDS`, so insights
for consent coverage or paid channels belong in a package release first. When
the package exports them per tier, provisioning adds them with the same
matching by stable key.

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
- **Tables:** `posthog_provisioned_objects` (design D2): the site, the PostHog
  project, whether it is the dashboard or an insight, its contract key and
  PostHog's id. No settings values. And `posthog_provisioning_runs`, with a
  migration:
  - site id, indexed
  - who ran it, and when
  - whether it was a check or an apply
  - the difference count and the outcome
  - the taxonomy version
  - no settings values and no key
- **Columns on `sites`:**
  - `uses_heatmaps` (boolean, default false), with a checkbox on the site form.
    open-waters is marked true, since it turns heatmaps on deliberately.
  - `measurement_tier` (enum `essentials`, `insights`, `growth`, default
    `essentials`). The migration sets `insights` for any site already marked as
    having a consent banner, and a partner corrects it to `growth` where that
    is right.
  - `tier_confirmed_for`, `tier_confirmed_at` and `tier_confirmed_by`, all
    nullable: the tier the guard was last confirmed for, and by whom.
  - `has_consent_banner` stays, for the expected-events rule and the snapshot,
    but is written from the tier rather than from a checkbox. Removing the
    column would need expand and contract, and nothing gains from it.
- **Modified behaviour outside this change's spec:** `adopt-the-contract-package`
  has the "Expected events follow the consent banner" requirement. It holds
  unchanged: the banner flag still drives it, and only the way the flag is set
  moves from a checkbox to the tier.
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
