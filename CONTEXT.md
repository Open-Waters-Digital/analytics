# Context

The vocabulary of this project. Specs, code and UI copy use these terms and
mean exactly this by them.

## Terms

**Client**
A business Open Waters builds or runs a site for. The unit of ownership and of
reporting. Identified by a **slug** (`radara`) that matches `SITE_SLUG` in the
client's site code.

**Site**
One production website belonging to a client. A client can have several.
Tracking, connections and snapshots belong to a site, not to a client.

**Analytics ownership**
Who controls a site's PostHog organisation. `open_waters`: set up and read by
Open Waters. `client_owned`: the client runs PostHog themselves (Agency Tap);
the site stays in the registry for its learning log and case study but is read
only if the client shares a key.

**Connection**
Stored access to one external data source for one site: a PostHog project or a
Search Console property. Carries its own last-check result.

**Check**
A live, read-only call that proves a connection works right now. Runs when a
connection is saved, on demand, and before every nightly pull.

**Event list** (taxonomy)
The shared set of event names and properties every Open Waters site sends,
versioned (`taxonomy_version`). Defined in the contract package,
`@open-waters-digital/analytics` (repo `analytics-contract`), never in this app.

**Expected events**
The subset of the event list a particular site should send. A site with no
downloads does not expect `file_downloaded`.

**Measurement tier**
How much a site measures, from the contract package's three tiers. **Essentials**:
cookieless PostHog under the statistical purposes exception, with no banner.
**Insights**: adds session recordings, behind consent. **Growth**: adds advertising
pixels, behind consent. Set per site; it decides the consent banner and the
PostHog settings provisioning requires.

**Tier confirmation**
A partner's statement, for a site's current tier, that the consent banner is
live on the production site and the privacy page names the tools the tier adds.
Until it is given, provisioning holds recording off. Changing the tier clears it.

**Consent banner** (`has_consent_banner`)
Whether a site runs a consent banner for ads or replay, derived from the
measurement tier: Insights and Growth have one, Essentials does not. Only such a
site is expected to send `consent_updated`, and only its page views are worth
reading by `ad_consent`.

**Provisioning**
Bringing a site's PostHog project to the settings and baseline dashboard the
contract and the registry require. A **provisioning check** lists the
differences and changes nothing; an **apply** makes them, and a second apply
changes nothing. Uses a partner's personal key for that one request, never
stored.

**Held** (difference)
A difference provisioning reports but will not apply until the tier is
confirmed: today, session recording at Insights and Growth.

**Provisioned object**
A PostHog dashboard or insight provisioning created, recorded here by its
contract key and PostHog id, and marked `ow:<key>` in its PostHog description
so it can be found again if the record is lost.

**(not recorded)**
A breakdown value meaning the event was sent at a taxonomy version older than
the property, so the site could not have sent it. Not the same as `(none)`,
which means it could have and the value was empty.

**Drift**
A difference between the event list and what a site actually sent: an event
name not on the list, or an expected event that stopped arriving.

**Snapshot**
The day's aggregate numbers for one site, stored here so reports and trends do
not re-query PostHog. Never contains an individual visitor's data.

**Learning log** (site change)
A dated record of something that changed on a site or around it: a launch, a
new proposition, a campaign. Reports use it to connect a change to what
followed.

**Commercial context**
Figures that turn activity into money: average lead value, lead-to-customer
rate, and whether each is client-confirmed or an Open Waters estimate.

**Report**
The monthly, human-reviewed write-up for a client, structured Attention →
Intent → Action → Revenue → Intelligence. Not built yet.

## Decisions

Recorded as ADRs in `docs/adr/`.
